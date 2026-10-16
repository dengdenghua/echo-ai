"""Admission and supervision of a ``call_subagent`` dispatch.

Spawn announcement, parent-cancellation linking, the cost ceiling, the
in-process and durable concurrency caps, the governance lease, and the
monitored worker (timeout / redirect fencing).
"""

from __future__ import annotations

import concurrent.futures
import logging
import os
import threading
import time
import uuid
from typing import Any

from runtime.protocol.text_limits import MAX_SUBAGENT_MISSION_CHARS

from ._bridge_trace import (
    _attach_trace_fields,
    _publish_bus_lifecycle,
    _safe_emit,
    _safe_journal_emit,
)
from .execution_context import child_timeout_seconds

_log = logging.getLogger("runtime.execution.subagents")


class _SubagentRunMixin:
    """Lifecycle of one dispatch around the worker (``_SubagentCall``)."""

    def _announce_spawn(self) -> None:
        """Emit the ``subagent_spawned`` lifecycle event and the start hook."""
        # Emit lifecycle: spawn. Caller's emitter (typically the realtime
        # gateway) forwards this onto the WS so the frontend sees a new
        # sub-agent card the moment we start. Best-effort — emitter
        # exceptions never block the run.
        _spawn_event = {
            "type": "subagent_spawned",
            "agent_id": self.agent_id,
            "requested_agent_id": self._requested_agent_id,
            "parent_tool_use_id": self._parent_tool_use_id or None,
            "role": self._role_label,
            "codename": self._codename,
            "avatar": self._avatar,
            "role_display_name": self._role_display_name,
            "role_description": self._role_description,
            "avatar_url": self._market_avatar_url,
            "identity_source": self._identity_source,
            "prompt_preview": (
                self.prompt[:MAX_SUBAGENT_MISSION_CHARS] if isinstance(self.prompt, str) else ""
            ),
            "use_cheap_model": bool(self.use_cheap_model),
            "started_at": self._spawn_started_at,
        }
        _attach_trace_fields(_spawn_event, self._trace_context)
        _safe_emit(self.event_emitter, _spawn_event)
        # Mirror onto the genome journal so frontend timeline can render
        # a sub-agent tile from the spawn moment, independent of the
        # in-memory emitter being wired through to the realtime gateway.
        _safe_journal_emit(_spawn_event)
        _publish_bus_lifecycle("subagent_spawned", _spawn_event, self.session)
        try:
            from runtime.safety.hooks import dispatch_subagent_start

            dispatch_subagent_start(
                thread_id=self._memory_thread_id,
                agent_id=self.agent_id,
                subagent_type=self._role_label or self.agent_id,
                prompt_preview=(self.prompt[:500] if isinstance(self.prompt, str) else ""),
                session_id=str(self._active_session.get("session_id") or ""),
            )
        except Exception:  # noqa: BLE001 — hooks are best-effort, never break the call
            pass

    def run(self) -> dict[str, Any]:
        """Announce the child, admit it under the caps, run it and finish it."""
        # Bridge caps and slot accounting are read on the bridge module at use
        # time, like the original globals, so replacements made there apply.
        from . import bridge as _bridge

        self._announce_spawn()

        # Cancellation propagation.
        #
        # A subagent runs inside the caller's turn, so if the user
        # interrupts the parent turn (or the parent's token gets cancelled
        # for any reason), the subagent's ReAct loop should stop too.
        # We create a linked child source and install it on the worker
        # thread via ``scoped_cancellation`` so every ``current_cancellation_token()``
        # call inside the subagent sees the inherited signal.
        from runtime.safety.approval.cancellation import (
            CancellationSource,
            CancellationToken,
            current_cancellation_token,
            scoped_cancellation,
        )

        # The worker methods enter this context manager; bind it per call as
        # the original closures did.
        self.scoped_cancellation = scoped_cancellation

        _parent_token = current_cancellation_token()
        self._child_source = CancellationSource()
        self.timeout_seconds = child_timeout_seconds(self.session, self.timeout_seconds)
        # Parent cancel → cancel child. If the parent is the never-token
        # (no ambient handler), ``on_cancelled`` is a no-op.
        _unlink_parent = _parent_token.on_cancelled(self._cancel_child)

        # Auto-retry wrapper. When the first call hits the round cap with
        # partial output, give it ONE more shot with a continuation prompt
        # that includes the partial work so the agent can finish from where
        # it left off rather than restart. This recovers ~80% of "almost
        # done" scenarios that previously surfaced as a bare 400 to the user.
        #
        # We do NOT retry generic failures (router error / tool exception)
        # because those are likely deterministic — retrying would just burn
        # more budget without changing the outcome.
        self._retry_disabled = (
            self.isolate
            or self.handoff is not None
            or bool((self.context or {}).get("disable_auto_retry", False))
        )

        # Cost ceiling gate: when ECHO_MAX_COST_USD is set, refuse to spawn once
        # the process-level ledger (UsagePricing) reports the ceiling is breached.
        # Import failure is non-fatal — missing budget module never blocks spawning.
        try:
            from runtime.platform.budget import UsagePricing

            _pricing = UsagePricing.get()
            if _pricing.is_over_budget():
                _cost_reject: dict[str, Any] = {
                    "status": "rejected",
                    "error": (
                        f"subagent spawn refused: cumulative cost ceiling reached "
                        f"(${_pricing.total_cost_usd:.4f} ≥ "
                        f"${_pricing.config.budget_usd:.2f}) — "
                        "raise ECHO_MAX_COST_USD or unset to disable"
                    ),
                    "agent_id": self.agent_id,
                    "role": self._role_label,
                    "codename": self._codename,
                    "avatar": self._avatar,
                    "output": "",
                    "success": False,
                    "rounds_completed": 0,
                    "iteration_count": 0,
                    "files_touched": [],
                }
                _log.warning(
                    "subagent spawn refused (cost ceiling $%.2f reached, spent $%.4f) · agent_id=%s",
                    _pricing.config.budget_usd or 0,
                    _pricing.total_cost_usd,
                    self.agent_id,
                )
                return self._augment(_cost_reject)
        except Exception:  # noqa: BLE001
            pass  # budget check failure is non-fatal

        # Concurrency guard: hold both an in-process slot and a durable SQLite
        # lease. The durable gate applies the same root/global limits across app
        # workers and survives a restart; stale process leases expire safely.
        if not _bridge._acquire_subagent_slot(self._subagent_root_id):
            _reject = {
                "status": "rejected",
                "error": (
                    f"subagent concurrency cap reached "
                    f"(global {_bridge.MAX_ACTIVE_SUBAGENTS}, subtree "
                    f"{_bridge.MAX_ACTIVE_SUBAGENTS_PER_ROOT}) — refused to spawn '{self.agent_id}'"
                ),
                "agent_id": self.agent_id,
                "role": self._role_label,
                "codename": self._codename,
                "avatar": self._avatar,
                "output": "",
                "success": False,
                "rounds_completed": 0,
                "iteration_count": 0,
                "files_touched": [],
                "governance_error": "concurrency_exhausted",
                "subagent_depth": self._child_depth,
                "subagent_root_id": self._subagent_root_id,
            }
            _log.warning(
                "subagent spawn refused (cap %d reached) · agent_id=%s role=%s",
                _bridge.MAX_ACTIVE_SUBAGENTS,
                self.agent_id,
                self._role_label,
            )
            return self._augment(_reject)

        _governance_lease: dict[str, Any] | None = None
        try:
            from runtime.execution.subagents.governance import governance_store

            _governance_lease = governance_store().acquire(
                self._subagent_root_id,
                depth=self._child_depth,
                global_limit=_bridge.MAX_ACTIVE_SUBAGENTS,
                root_limit=_bridge.MAX_ACTIVE_SUBAGENTS_PER_ROOT,
                owner_id=f"{os.getpid()}:{uuid.uuid4().hex}",
            )
        except Exception as exc:  # noqa: BLE001 — governance failure must not widen access
            _bridge._release_subagent_slot(self._subagent_root_id)
            return self._augment(
                {
                    "status": "rejected",
                    "error": f"durable subagent governance unavailable: {type(exc).__name__}",
                    "agent_id": self.agent_id,
                    "role": self._role_label,
                    "codename": self._codename,
                    "avatar": self._avatar,
                    "output": "",
                    "success": False,
                    "rounds_completed": 0,
                    "iteration_count": 0,
                    "files_touched": [],
                    "governance_error": "governance_unavailable",
                }
            )
        if _governance_lease is None:
            _bridge._release_subagent_slot(self._subagent_root_id)
            try:
                _governance_snapshot = governance_store().snapshot(self._subagent_root_id)
            except Exception:  # noqa: BLE001
                _governance_snapshot = {}
            _governance_reason = str(
                _governance_snapshot.get("trip_reason") or "concurrency_exhausted"
            )
            return self._augment(
                {
                    "status": "rejected",
                    "error": f"durable subagent governance refused spawn: {_governance_reason}",
                    "agent_id": self.agent_id,
                    "role": self._role_label,
                    "codename": self._codename,
                    "avatar": self._avatar,
                    "output": "",
                    "success": False,
                    "rounds_completed": 0,
                    "iteration_count": 0,
                    "files_touched": [],
                    "governance_error": _governance_reason,
                    "governance": _governance_snapshot,
                }
            )

        _lease_id = str(_governance_lease["lease_id"])
        _lease_stop = threading.Event()
        _capacity_release_lock = threading.Lock()
        _capacity_released = False

        def _release_subagent_capacity() -> None:
            nonlocal _capacity_released
            with _capacity_release_lock:
                if _capacity_released:
                    return
                _capacity_released = True
            _lease_stop.set()
            _bridge._release_subagent_slot(self._subagent_root_id)
            try:
                from runtime.execution.subagents.governance import governance_store

                governance_store().release(_lease_id)
            except Exception as exc:  # noqa: BLE001
                _log.error("subagent governance lease release failed: %s", exc)

        def _renew_governance_lease() -> None:
            try:
                from runtime.execution.subagents.governance import (
                    governance_store,
                    lease_seconds,
                )

                interval = max(0.25, min(30.0, float(lease_seconds()) / 3.0))
                while not _lease_stop.wait(interval):
                    if not governance_store().renew(_lease_id):
                        _log.error("subagent governance lease expired · lease_id=%s", _lease_id)
                        self._child_source.cancel(reason="subagent governance lease expired")
                        return
            except Exception as exc:  # noqa: BLE001
                _log.error("subagent governance lease renewal failed: %s", exc)
                self._child_source.cancel(reason="subagent governance unavailable")

        threading.Thread(
            target=_renew_governance_lease,
            name=f"subagent-governance-{_lease_id[:8]}",
            daemon=True,
        ).start()
        try:
            slot_release_deferred = False
            # Preserve the direct-call path for non-request callers that have no
            # cancellable parent. Live turns use a worker even without an explicit
            # timeout, allowing the caller to return promptly when the user
            # redirects while a non-cooperative child is still unwinding.
            monitor_parent = _parent_token is not CancellationToken.none()
            if self.timeout_seconds is None and not monitor_parent:
                return self._augment(self._execute_worker())

            # Monitored path: run in a thread so we can enforce both a wall-clock
            # limit and parent cancellation.
            # We use shutdown(wait=False) to avoid blocking forever if the worker
            # thread is stuck (Python threads cannot be killed cleanly).
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            future = executor.submit(self._execute_worker)

            def _defer_slot_until_worker_finishes() -> None:
                """Keep the global slot occupied while a timed-out thread unwinds.

                ``future.cancel()`` cannot stop a thread that already started.
                Releasing the slot in that case lets a retry spawn alongside the
                old worker, so two generations can write the same workspace.
                The callback is safe when the future has already completed:
                ``add_done_callback`` invokes it synchronously in that case.
                """
                nonlocal slot_release_deferred
                if self.handoff is not None:
                    # Cancellation cannot reclaim files from a still-running
                    # worker. The callback also runs if it just finished.
                    future.add_done_callback(lambda _future: self._reconcile_handoff())
                if slot_release_deferred or future.done():
                    return
                slot_release_deferred = True
                future.add_done_callback(lambda _future: _release_subagent_capacity())

            deadline = (
                time.monotonic() + self.timeout_seconds
                if self.timeout_seconds is not None
                else None
            )
            try:
                while True:
                    # Cancellation wins over a simultaneously arriving success:
                    # this is the generation fence that keeps late child output
                    # out of the redirected parent turn.
                    if self._child_source.is_cancelled:
                        future.cancel()
                        _defer_slot_until_worker_finishes()
                        reason = self._child_source.token.reason or "parent cancelled"
                        elapsed = max(0.0, time.time() - self._spawn_started_at)
                        _cancel_event = {
                            "type": "subagent_finished",
                            "agent_id": self.agent_id,
                            "requested_agent_id": self._requested_agent_id,
                            "parent_tool_use_id": self._parent_tool_use_id or None,
                            "role": self._role_label,
                            "codename": self._codename,
                            "avatar": self._avatar,
                            "avatar_url": self._market_avatar_url,
                            "identity_source": self._identity_source,
                            "ok": False,
                            "duration_s": round(elapsed, 2),
                            "iteration_count": self._rounds_state["max_round"],
                            "files_touched": list(self._files_touched),
                            "error": f"subagent cancelled: {reason}",
                            "status": "cancelled",
                            "cancelled": True,
                            "cancellation_reason": reason,
                        }
                        _attach_trace_fields(_cancel_event, self._trace_context)
                        _safe_emit(self.event_emitter, _cancel_event)
                        _safe_journal_emit(_cancel_event)
                        _publish_bus_lifecycle("subagent_finished", _cancel_event, self.session)
                        return _attach_trace_fields(
                            {
                                "status": "cancelled",
                                **(
                                    {"retry_allowed": False}
                                    if self.isolate or self.handoff is not None
                                    else {}
                                ),
                                "error": f"subagent cancelled: {reason}",
                                "cancelled": True,
                                "cancellation_reason": reason,
                                "agent_id": self.agent_id,
                                "role": self._role_label,
                                "codename": self._codename,
                                "avatar": self._avatar,
                                "output": "",
                                "success": False,
                                "rounds_completed": self._rounds_state["max_round"],
                                "iteration_count": self._rounds_state["max_round"],
                                "files_touched": list(self._files_touched),
                            },
                            self._trace_context,
                        )

                    remaining = None if deadline is None else deadline - time.monotonic()
                    if remaining is not None and remaining <= 0:
                        raise concurrent.futures.TimeoutError
                    wait_for = 0.05 if remaining is None else min(0.05, remaining)
                    try:
                        result = future.result(timeout=wait_for)
                    except concurrent.futures.TimeoutError:
                        continue
                    if self._child_source.is_cancelled:
                        continue
                    return self._augment(result)
            except concurrent.futures.TimeoutError:
                # Signal cancellation to the subagent so any poll-aware loop
                # (ReAct, subprocess waits) unwinds gracefully. ``future.cancel``
                # only works if the task hasn't started — the token gives us
                # co-operative shutdown even on running tasks.
                self._child_source.cancel(reason="subagent timeout")
                future.cancel()
                _defer_slot_until_worker_finishes()
                rounds = self._rounds_state["max_round"]
                _log.warning(
                    "subagent %s timed out after %ss (rounds_completed=%d)",
                    self.agent_id,
                    self.timeout_seconds,
                    rounds,
                )
                # Emit the subagent_finished lifecycle event for the timeout
                # path too — frontend needs to mark the tile as failed.
                elapsed = max(0.0, time.time() - self._spawn_started_at)
                _timeout_event = {
                    "type": "subagent_finished",
                    "agent_id": self.agent_id,
                    "requested_agent_id": self._requested_agent_id,
                    "parent_tool_use_id": self._parent_tool_use_id or None,
                    "role": self._role_label,
                    "codename": self._codename,
                    "avatar": self._avatar,
                    "ok": False,
                    "duration_s": round(elapsed, 2),
                    "iteration_count": rounds,
                    "files_touched": list(self._files_touched),
                    "error": f"subagent timed out after {self.timeout_seconds}s",
                    "status": "timeout",
                }
                _attach_trace_fields(_timeout_event, self._trace_context)
                _safe_emit(self.event_emitter, _timeout_event)
                _safe_journal_emit(_timeout_event)
                _publish_bus_lifecycle("subagent_finished", _timeout_event, self.session)
                return _attach_trace_fields(
                    {
                        "status": "timeout",
                        **(
                            {"retry_allowed": False}
                            if self.isolate or self.handoff is not None
                            else {}
                        ),
                        "error": f"subagent timed out after {self.timeout_seconds}s",
                        "agent_id": self.agent_id,
                        "role": self._role_label,
                        "codename": self._codename,
                        "avatar": self._avatar,
                        "output": "",
                        "success": False,
                        "rounds_completed": rounds,
                        "iteration_count": rounds,
                        "files_touched": list(self._files_touched),
                    },
                    self._trace_context,
                )
            finally:
                executor.shutdown(wait=False)
        finally:
            _unlink_parent()
            self._reconcile_handoff()
            # A monitored worker that timed out/cancelled while already running
            # owns the slot until its thread actually exits.  This prevents a
            # retry from running concurrently with the old generation.
            if not slot_release_deferred:
                _release_subagent_capacity()

    def _cancel_child(self, reason: str) -> None:
        self._child_source.cancel(reason=reason or "parent cancelled")
