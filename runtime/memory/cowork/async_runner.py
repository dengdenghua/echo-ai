"""The loop that makes async coworkers actually work.

Polls the thread's pending tasks, builds each one's context (history sliced by
the assignee's grant + the shared blackboard), runs the agent, posts the result
to the board, and records the outcome into competence memory. Can run once
(``drain``) or as a background daemon.

How an agent is *run* is injected (``execute``) — the production wiring passes a
bridge to the ephemeral sub-agent runner at bootstrap (same pattern as
``set_ephemeral_role_runner``); tests pass a stub. So this whole loop is testable
without an LLM and never touches the realtime streaming path.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from datetime import UTC, datetime
from typing import Any

from runtime.execution.claim_guard import ExecutionClaimGuard
from runtime.memory.cowork.async_work import AsyncTask, AsyncWorkStore
from runtime.memory.cowork.context_view import materialize_messages, resolve_view
from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.nominate import CompetenceStore, tokenize
from runtime.safety.approval.cancellation import current_cancellation_token

_LOG = logging.getLogger("echo.cowork.async_runner")

# Model/network waits dominate these tasks; keep the default independent of CPU count.
DEFAULT_MAX_CONCURRENCY = 16

# execute(task, context) -> result text. ``context`` carries the grant-sliced
# history, the shared blackboard, and the roster.
Executor = Callable[[AsyncTask, dict[str, Any]], str]
HistoryProvider = Callable[[str], list[Any]]
CompletionObserver = Callable[[AsyncTask, bool, str], None]


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class AsyncWorkRunner:
    """Drives pending async tasks to completion via an injected ``execute``."""

    def __init__(
        self,
        store: AsyncWorkStore,
        group_store: GroupStore,
        execute: Executor,
        *,
        competence: CompetenceStore | None = None,
        history_provider: HistoryProvider | None = None,
        completion_observer: CompletionObserver | None = None,
        admission: Callable[[AsyncTask], bool] | None = None,
        recover_stale_seconds: float = 900.0,
        max_attempts: int = 3,
        max_concurrency: int = DEFAULT_MAX_CONCURRENCY,
        max_tasks_per_tick: int = 64,
    ) -> None:
        self._store = store
        self._groups = group_store
        self._execute = execute
        self._competence = competence
        self._history = history_provider or (lambda _tid: [])
        self._completion_observer = completion_observer
        self._admission = admission
        self._recover_stale_seconds = max(0.0, float(recover_stale_seconds))
        self._max_attempts = max(1, int(max_attempts))
        self._max_concurrency = max(1, int(max_concurrency))
        self._max_tasks_per_tick = max(1, int(max_tasks_per_tick))
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._state_lock = threading.Lock()
        self._total_ticks = 0
        self._total_failures = 0
        self._consecutive_failures = 0
        self._last_tick_at: str | None = None
        self._last_success_at: str | None = None
        self._last_failure_at: str | None = None
        self._last_error: str | None = None
        self._last_recovered: dict[str, int] = {"requeued": 0, "failed": 0}
        self._last_ran_count = 0
        self._last_concurrency = 0

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def status(self) -> dict[str, Any]:
        """Operational health snapshot for UI/API diagnostics."""
        with self._state_lock:
            return {
                "running": self.running,
                "recover_stale_seconds": self._recover_stale_seconds,
                "max_attempts": self._max_attempts,
                "max_concurrency": self._max_concurrency,
                "max_tasks_per_tick": self._max_tasks_per_tick,
                "total_ticks": self._total_ticks,
                "total_failures": self._total_failures,
                "consecutive_failures": self._consecutive_failures,
                "last_tick_at": self._last_tick_at,
                "last_success_at": self._last_success_at,
                "last_failure_at": self._last_failure_at,
                "last_error": self._last_error,
                "last_recovered": dict(self._last_recovered),
                "last_ran_count": self._last_ran_count,
                "last_concurrency": self._last_concurrency,
            }

    def _record_tick_result(
        self,
        *,
        success: bool,
        recovered: dict[str, int] | None = None,
        ran_count: int = 0,
        concurrency: int = 0,
        error: str | None = None,
    ) -> None:
        now = _now_iso()
        with self._state_lock:
            self._total_ticks += 1
            self._last_tick_at = now
            self._last_recovered = dict(recovered or {"requeued": 0, "failed": 0})
            self._last_ran_count = int(ran_count)
            self._last_concurrency = max(0, int(concurrency))
            if success:
                self._consecutive_failures = 0
                self._last_error = None
                self._last_success_at = now
                return
            self._total_failures += 1
            self._consecutive_failures += 1
            self._last_error = error or "tick failed"
            self._last_failure_at = now

    def _build_context(self, task: AsyncTask) -> dict[str, Any]:
        state = self._groups.state(task.thread_id)
        msgs = self._history(task.thread_id)
        view = resolve_view(state, task.assignee, max(0, len(msgs) - 1))
        history = materialize_messages(view, msgs) if view else []
        return {
            "history": history,
            "blackboard": self._groups.blackboard_snapshot(task.thread_id),
            "roster": [m.id for m in state.roster],
            "grant_scope": view.scope if view else None,
        }

    def _record_competence(self, assignee: str, prompt: str, success: bool) -> None:
        if not self._competence:
            return
        for tag in list(tokenize(prompt))[:5]:
            self._competence.record(assignee, tag, success)

    def _notify_completion(self, task: AsyncTask, *, success: bool, result: str) -> None:
        if self._completion_observer is None:
            return
        try:
            self._completion_observer(task, success, result)
        except Exception as exc:  # noqa: BLE001 - durable task outcome remains authoritative
            _LOG.warning("async task %s completion observer failed: %s", task.task_id, exc)

    def run_one(self, task: AsyncTask) -> bool:
        """Claim → execute → complete (or fail) one task. False if not claimable."""
        parent = current_cancellation_token()
        if parent.is_cancelled:
            return False
        if self._admission is not None:
            try:
                if not self._admission(task):
                    return False
            except PermissionError:
                # Membership/permission revocation cannot turn into delayed work.
                self._store.cancel_batch(
                    [task.task_id], reason="group execution permission revoked"
                )
                return False
        claimed = self._store.claim_execution(task.task_id)
        if claimed is None:
            return False
        task = claimed
        guard = ExecutionClaimGuard(
            lambda: self._store.heartbeat(task.task_id, expected_attempt=task.attempts),
            interval_s=min(30.0, self._recover_stale_seconds / 3),
        )

        # Persist parent cancellation even if the provider ignores its token.
        # The attempt fence prevents a delayed callback cancelling a new worker.
        def cancel_claim(reason: str) -> None:
            self._store.cancel_claim(task.task_id, expected_attempt=task.attempts, reason=reason)

        unlink = parent.on_cancelled(cancel_claim)
        try:
            with guard.scope():
                return self._run_claimed(task, guard)
        finally:
            unlink()

    def _run_claimed(self, task: AsyncTask, guard: ExecutionClaimGuard) -> bool:
        try:
            guard.token.throw_if_cancelled()
            result = self._execute(task, self._build_context(task))
            guard.token.throw_if_cancelled()
        except Exception as exc:  # noqa: BLE001 — a failed task must not kill the loop
            if guard.claim_lost:
                return True
            if guard.token.is_cancelled:
                self._store.cancel_claim(
                    task.task_id, expected_attempt=task.attempts, reason=guard.token.reason
                )
                return True
            error = f"{type(exc).__name__}: {exc}"
            failed = self._store.fail(task.task_id, error, expected_attempt=task.attempts)
            if not failed:
                _LOG.info("discarded failure from obsolete async claim %s", task.task_id)
                return True
            self._record_competence(task.assignee, task.prompt, success=False)
            self._notify_completion(task, success=False, result=error)
            _LOG.warning("async task %s failed: %s", task.task_id, exc)
            return True
        if guard.claim_lost:
            return True
        completed = self._store.complete(task.task_id, result, expected_attempt=task.attempts)
        if not completed:
            _LOG.info("discarded result from obsolete async claim %s", task.task_id)
            return True
        self._record_competence(task.assignee, task.prompt, success=True)
        self._notify_completion(task, success=True, result=result)
        return True

    def drain(self, thread_id: str) -> int:
        """Run every currently-pending task in a thread. Returns how many ran."""
        ran = 0
        for task in self._store.pending(thread_id):
            if self.run_one(task):
                ran += 1
        return ran

    def _fair_pending(self, *, limit: int | None = None) -> list[AsyncTask]:
        """Interleave threads so one large room cannot starve smaller rooms."""

        queues = {
            thread_id: list(self._store.pending(thread_id))
            for thread_id in self._store.threads_with_pending()
        }
        selected: list[AsyncTask] = []
        while queues and (limit is None or len(selected) < limit):
            for thread_id in list(queues):
                queue = queues[thread_id]
                if queue:
                    selected.append(queue.pop(0))
                if not queue:
                    queues.pop(thread_id, None)
                if limit is not None and len(selected) >= limit:
                    break
        return selected

    def _adaptive_worker_count(self, task_count: int) -> int:
        """Use available I/O slots, bounded by the configured worker cap."""

        if task_count <= 0:
            return 0
        return min(self._max_concurrency, task_count)

    def _run_fair_pending(self, *, limit: int | None = None) -> tuple[int, int]:
        tasks = self._fair_pending(limit=limit)
        concurrency = self._adaptive_worker_count(len(tasks))
        if concurrency <= 1:
            return sum(1 for task in tasks if self.run_one(task)), concurrency
        with ThreadPoolExecutor(
            max_workers=concurrency,
            thread_name_prefix="cowork-task",
        ) as pool:
            futures = [pool.submit(copy_context().run, self.run_one, task) for task in tasks]
            ran = sum(1 for future in futures if future.result())
        return ran, concurrency

    def recover_stale(self) -> dict[str, int]:
        """Requeue abandoned working tasks before polling pending work."""
        staged = self._store.staged_older_than(
            max_age_seconds=self._recover_stale_seconds,
        )
        recovered = self._store.recover_stale_working(
            max_age_seconds=self._recover_stale_seconds,
            max_attempts=self._max_attempts,
        )
        for task in staged:
            current = self._store.get(task.task_id)
            if current is None or current.status != "failed":
                continue
            self._notify_completion(
                current,
                success=False,
                result=current.result or "task staging did not complete",
            )
        if recovered.get("requeued") or recovered.get("failed"):
            _LOG.warning("async runner recovered stale tasks: %s", recovered)
        return recovered

    def drain_all(self) -> int:
        self.recover_stale()
        ran, _concurrency = self._run_fair_pending()
        return ran

    def tick_once(self) -> int:
        """Run one recover+drain tick and record runner health."""
        try:
            recovered = self.recover_stale()
            ran, concurrency = self._run_fair_pending(limit=self._max_tasks_per_tick)
        except Exception as exc:  # noqa: BLE001 — tick health must capture store/context failures
            self._record_tick_result(
                success=False,
                error=f"{type(exc).__name__}: {exc}",
            )
            _LOG.warning("async runner tick error: %s", exc, exc_info=True)
            return 0
        self._record_tick_result(
            success=True,
            recovered=recovered,
            ran_count=ran,
            concurrency=concurrency,
        )
        return ran

    # ── background daemon ────────────────────────────────────────────────────
    def start(self, *, poll_seconds: float = 5.0) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._wake.clear()
        self._thread = threading.Thread(
            target=self._loop, args=(poll_seconds,), name="cowork-async-runner", daemon=True
        )
        self._thread.start()
        _LOG.info(
            "cowork async runner started: max_concurrency=%d, max_tasks_per_tick=%d",
            self._max_concurrency,
            self._max_tasks_per_tick,
        )

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            self._thread = None

    def wake(self) -> None:
        """Prompt the background loop after new work is queued."""

        self._wake.set()

    def _loop(self, poll_seconds: float) -> None:
        # A persistent pool admits arrivals while existing workers are busy.
        # tick_once/drain_all intentionally wait for a finite batch (CLI/tests);
        # using them here used to strand new work behind a 15-minute task even
        # with three vacant execution slots.
        pool = ThreadPoolExecutor(max_workers=self._max_concurrency, thread_name_prefix="cowork-task")
        active = {}

        def completed(future):
            # Admission-blocked tasks wait for a dependency completion/poll;
            # immediately waking on False would spin on the same blocked row.
            if not future.cancelled() and (future.exception() or future.result()):
                self._wake.set()

        try:
            while not self._stop.is_set():
                self._wake.wait(timeout=poll_seconds)
                self._wake.clear()
                if self._stop.is_set():
                    break
                try:
                    ran = 0
                    for task_id, future in list(active.items()):
                        if future.done():
                            active.pop(task_id)
                            ran += bool(future.result())
                    recovered = self.recover_stale()
                    for task in self._fair_pending(limit=self._max_tasks_per_tick):
                        if len(active) >= self._max_concurrency:
                            break
                        if task.task_id in active:
                            continue
                        future = pool.submit(copy_context().run, self.run_one, task)
                        active[task.task_id] = future
                        future.add_done_callback(completed)
                    self._record_tick_result(
                        success=True, recovered=recovered, ran_count=ran, concurrency=len(active),
                    )
                except Exception as exc:  # noqa: BLE001 — one worker must not kill dispatch
                    self._record_tick_result(success=False, error=f"{type(exc).__name__}: {exc}")
                    _LOG.warning("async runner dispatch error: %s", exc, exc_info=True)
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
