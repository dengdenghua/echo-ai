"""Bounded HTTP project workers with durable, fenced task supervision."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor, wait
from contextlib import asynccontextmanager
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from runtime.platform.process.task_supervisor import (
    TERMINAL_TASK_STATUSES,
    TaskLeaseConflict,
    TaskRunStatus,
    TaskSupervisor,
    task_lease_health,
)
from runtime.projectos._claim_process import claim_owner_alive, current_claim_owner
from runtime.safety.approval.cancellation import (
    CancellationSource,
    OperationCancelled,
    scoped_cancellation,
)

_LOG = logging.getLogger(__name__)


class ProjectHTTPDispatcher:
    def __init__(
        self,
        supervisor: TaskSupervisor,
        *,
        max_workers: int = 2,
        max_queued: int = 8,
        on_change: Callable[[], None] | None = None,
    ):
        # A distinct holder fences other HTTP workers, including routers in the
        # same process. The shared task store already locks across processes.
        self.supervisor = TaskSupervisor(
            supervisor.store,
            holder_id=f"project-http:{uuid4().hex}",
            lease_ttl_seconds=15,
        )
        self._capacity = max_workers + max_queued
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="project-http"
        )
        self._lock = threading.RLock()
        self._futures: dict[str, Future] = {}
        self._sources: dict[str, CancellationSource] = {}
        self._closed = False
        self._stopped = threading.Event()
        self._monitor: threading.Thread | None = None
        self._on_change = on_change

    def _notify_change(self) -> None:
        if self._on_change is not None:
            try:
                self._on_change()
            except Exception:  # noqa: BLE001 -- a wake-up cannot change durable execution outcome
                _LOG.warning("project execution wake-up unavailable; HTTP catch-up retained")

    @staticmethod
    def task_id(project: Any) -> str:
        return str(
            uuid5(
                NAMESPACE_URL,
                f"echo-project-http:{project.tenant_id}:{project.owner_id}:{project.id}",
            )
        )

    def state(self, project: Any) -> dict[str, Any] | None:
        task = self.supervisor.store.get(self.task_id(project))
        if task is None:
            return None
        health = task_lease_health(task)
        expired = bool(task.lease and task.lease.expired)
        dead = claim_owner_alive(task.metadata.get("process_owner", "")) is False
        status = (
            "interrupted"
            if (expired or dead) and task.status not in TERMINAL_TASK_STATUSES
            else task.status.value
        )
        return {
            "task_id": task.task_id,
            "project_id": project.id,
            "request_id": task.metadata.get("http_request_id"),
            "status": status,
            "updated_at": task.updated_at,
            "completed_at": task.completed_at,
            "cancel_requested": bool(task.metadata.get("http_cancel_requested")),
            "result": task.metadata.get("http_result"),
            "can_takeover": bool(health.get("can_takeover")),
        }

    def submit(
        self,
        project: Any,
        worker: Callable[[], dict[str, Any]],
        *,
        thread_id: str = "",
        standing_grant_id: str = "",
    ) -> dict[str, Any]:
        task_id = self.task_id(project)
        with self._lock:
            if self._closed:
                raise RuntimeError("project worker is shutting down")
            if task_id in self._futures:
                raise TaskLeaseConflict(task_id, self.supervisor.holder_id)
            if len(self._futures) >= self._capacity:
                raise OverflowError("project execution queue is full")
            request_id = uuid4().hex
            self.supervisor.start_task(
                task_id=task_id,
                kind="project_http",
                owner_id=project.owner_id or None,
                thread_id=thread_id or None,
                title=project.name,
                goal=project.goal,
                status=TaskRunStatus.PENDING,
                metadata={
                    "project_id": project.id,
                    "tenant_id": project.tenant_id,
                    "http_request_id": request_id,
                    "http_cancel_requested": False,
                    "http_result": None,
                    "standing_grant_id": standing_grant_id,
                    "process_owner": current_claim_owner(),
                },
            )
            source = CancellationSource()
            self._sources[task_id] = source
            if self._monitor is None:
                self._monitor = threading.Thread(
                    target=self._heartbeat, name="project-http-heartbeat", daemon=True
                )
                self._monitor.start()
            try:
                future = self._executor.submit(self._run, task_id, source, worker)
            except RuntimeError:
                self._sources.pop(task_id, None)
                self.supervisor.transition(
                    task_id, TaskRunStatus.FAILED, reason="worker submission failed"
                )
                self._notify_change()
                raise
            self._futures[task_id] = future
            future.add_done_callback(lambda completed: self._forget(task_id, completed))
        self._notify_change()
        return {
            "accepted": True,
            "task_id": task_id,
            "project_id": project.id,
            "request_id": request_id,
            "status": "queued",
        }

    def cancel(
        self,
        project: Any,
        *,
        reason: str = "cancelled by operator",
        standing_grant_id: str = "",
    ) -> dict[str, Any] | None:
        task_id = self.task_id(project)
        task = self.supervisor.store.get(task_id)
        if task is None or task.status in TERMINAL_TASK_STATUSES:
            return self.state(project)

        def mark(current):
            if current.status in TERMINAL_TASK_STATUSES or current.metadata.get(
                "http_request_id"
            ) != task.metadata.get("http_request_id"):
                return current
            return current.model_copy(
                update={
                    "metadata": {
                        **current.metadata,
                        "http_cancel_requested": True,
                        "http_cancel_standing_grant_id": standing_grant_id,
                    }
                },
                deep=True,
            )

        # A cancellation request never takes ownership or changes a terminal
        # state. A foreign worker observes it on its next heartbeat.
        marked = self.supervisor.store.mutate(task_id, mark)
        with self._lock:
            source = self._sources.get(task_id)
            if source and marked.metadata.get("http_request_id") == task.metadata.get(
                "http_request_id"
            ):
                source.cancel(reason=reason)
        self._notify_change()
        return self.state(project)

    def _heartbeat(self) -> None:
        # Pending work renews its lease too: a long-running earlier job must
        # never make the accepted queue appear orphaned to another worker.
        while not self._stopped.wait(1):
            with self._lock:
                sources = list(self._sources.items())
            for task_id, source in sources:
                try:
                    record = self.supervisor.heartbeat(task_id)
                    if record.metadata.get("http_cancel_requested"):
                        source.cancel(reason="cancelled by operator")
                except (OSError, ValueError, RuntimeError):
                    source.cancel(reason="project execution lease lost")

    def _run(
        self, task_id: str, source: CancellationSource, worker: Callable[[], dict[str, Any]]
    ) -> None:
        try:
            record = self.supervisor.transition(task_id, TaskRunStatus.RUNNING)
            self._notify_change()
            if record.metadata.get("http_cancel_requested"):
                source.cancel(reason="cancelled by operator")
            with scoped_cancellation(source.token):
                source.token.throw_if_cancelled()
                result = worker()
                source.token.throw_if_cancelled()
            self.supervisor.transition(
                task_id, TaskRunStatus.COMPLETED, metadata_patch={"http_result": result}
            )
        except OperationCancelled as exc:
            self._terminal(task_id, TaskRunStatus.CANCELLED, exc.reason)
        except Exception:  # noqa: BLE001 — contain worker failures; preserve a truthful terminal receipt
            _LOG.exception("background project execution failed: %s", task_id)
            self._terminal(task_id, TaskRunStatus.FAILED, "project execution failed")

    def _terminal(self, task_id: str, status: TaskRunStatus, reason: str) -> None:
        try:
            self.supervisor.transition(task_id, status, reason=reason)
        except (OSError, ValueError, RuntimeError):
            # A stale worker must not overwrite the new holder's state.
            return

    def _forget(self, task_id: str, future: Future) -> None:
        with self._lock:
            self._futures.pop(task_id, None)
            self._sources.pop(task_id, None)
        if future.cancelled():
            self._terminal(
                task_id, TaskRunStatus.CANCELLED, "project worker closed before starting"
            )
        self._notify_change()

    def close(self) -> None:
        with self._lock:
            self._closed = True
            futures = list(self._futures.values())
            for source in self._sources.values():
                source.cancel(reason="project worker shutting down")
        self._executor.shutdown(wait=False, cancel_futures=True)
        wait(futures, timeout=5)
        self._stopped.set()
        if self._monitor is not None:
            self._monitor.join(timeout=2)

    @asynccontextmanager
    async def lifespan(self, _app):
        try:
            yield
        finally:
            import asyncio

            await asyncio.to_thread(self.close)
