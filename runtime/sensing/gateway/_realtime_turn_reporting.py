"""Terminal notifications, item closure and parked subagent report scheduling."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from runtime.protocol import ServerMethod, Turn
from runtime.sensing.gateway.realtime_gateway import EventEmitter

if TYPE_CHECKING:
    from runtime.sensing.gateway.realtime_cerebrum import CerebrumRuntime


async def _notify_terminal(
    emitter: EventEmitter,
    method: ServerMethod,
    params: dict[str, Any],
) -> None:
    """Send a terminal event through the emitter's convergence path.

    Detached resident turns expose ``notify_terminal`` so an exception or
    cancellation reaches sibling tabs while the owner is still alive.  The
    fallback preserves the public EventEmitter contract for standalone
    runtimes that only implement ``notify``.
    """

    terminal = getattr(emitter, "notify_terminal", None)
    if callable(terminal):
        await terminal(method, params)
    else:
        await emitter.notify(method, params)


def _item_outlives_turn(item: Any) -> bool:
    """True when this item is *meant* to still be running at turn end.

    ``background_exec`` hands work to a task that deliberately outlives the
    turn; a watcher completes the item minutes later. Sweeping it would
    overwrite a real result that is still coming.
    """

    preview = getattr(item, "input_preview", None) or getattr(item, "inputPreview", None)
    if isinstance(preview, dict) and preview.get("background") is True:
        return True
    return bool(getattr(item, "task_id", None))


def _close_turn(
    log: Any,
    thread_id: str,
    turn: Any,
    *,
    error: dict[str, Any] | None = None,
) -> None:
    """Terminate any still-running item, then log the turn as completed.

    Every path out of a turn goes through here so no path can forget. An item
    left at ``inProgress`` spins in the UI forever: in thread
    teD7hPf9dkGOExwO0dIiBE an interrupted turn stranded three ``bb_read``
    calls and one ``call_agent_parallel``, and the interrupt path logged
    ``turn_completed`` without touching them.

    The sweep runs *before* ``turn_completed`` so the journal keeps its
    chronology -- a completion appended after the turn closed would replay out
    of order.
    """
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    # Settle governed canary evidence before writing the terminal journal
    # record. Completed and failed turns are gradable; user-driven pause,
    # cancellation, and interruption are explicitly discarded.
    try:
        from runtime.safety.evolution.runtime_outcomes import (
            settle_runtime_candidate_outcomes,
        )

        candidate_success: bool | None
        if getattr(turn, "status", None) is lifecycle.TurnStatus.COMPLETED:
            candidate_success = True
        elif getattr(turn, "status", None) is lifecycle.TurnStatus.FAILED:
            turn_error = turn.error if isinstance(getattr(turn, "error", None), dict) else None
            candidate_success = (
                None if turn_error and turn_error.get("disposition") == "blocked_on_user" else False
            )
        else:
            candidate_success = None
        settle_runtime_candidate_outcomes(
            str(getattr(turn, "id", "") or ""),
            success=candidate_success,
        )
    except Exception:  # noqa: BLE001 — evolution telemetry must not break the turn
        lifecycle._logger.debug("candidate outcome settlement skipped", exc_info=True)

    for item in getattr(turn, "items", None) or []:
        if getattr(item, "status", None) is not lifecycle.ItemStatus.IN_PROGRESS:
            continue
        if str(getattr(item, "tool", "") or "") in lifecycle._UNPAIRED_ITEM_MARKERS:
            continue
        if lifecycle._item_outlives_turn(item):
            continue
        item.status = lifecycle.ItemStatus.FAILED
        # Say why it stopped rather than leaving a bare failure: the turn's own
        # outcome is the cause, and without it the item looks like the command
        # itself broke. Item models carry a message in different fields and
        # ``CommandExecutionItem`` -- the type that actually leaked here -- has
        # no ``error`` at all, so route by declared field. Assigning to a field
        # a pydantic model does not declare raises ValueError, not
        # AttributeError, so ask the model rather than catching.
        detail = f"turn ended while this was still running ({turn.status.value})"
        fields = getattr(type(item), "model_fields", {})
        if "error" in fields and not getattr(item, "error", None):
            item.error = detail
        elif "aggregated_output" in fields:
            existing = getattr(item, "aggregated_output", None) or ""
            item.aggregated_output = f"{existing}\n[{detail}]".lstrip()
        with lifecycle.contextlib.suppress(Exception):
            log.item_completed(thread_id, turn.id, item)
    log.turn_completed(thread_id, turn.id, turn.status, error)

    # Codex owns its inner loop, so it cannot use the native tool bridge's
    # per-round scoring hook. Record the same coarse quality signal at the
    # shared lifecycle boundary instead. Keeping this here (rather than in
    # the Codex adapter) also guarantees one score for a turn that receives a
    # late steering continuation or is closed through an interrupt path.
    if str(getattr(turn, "execution_engine", "") or "").strip().lower() == "codex":
        try:
            from runtime.sensing.gateway._tool_bridge_scoring import (
                _record_codex_turn_score_safe,
            )

            _record_codex_turn_score_safe(turn=turn)
        except Exception:  # noqa: BLE001 — learning must never block closure
            lifecycle._logger.debug("codex lifecycle score skipped", exc_info=True)

    # dsh ``Stop``: fired when a full agent turn completes, successfully or
    # not (notification-type hook — post-hoc audit / metrics). Every path
    # out of a turn funnels through this helper, so a single dispatch here
    # covers normal, error, cancel, and interrupt endings. Best-effort:
    # hook failures must never break the turn lifecycle.
    try:
        from runtime.platform.process.session import current_session
        from runtime.safety.hooks.runner import dispatch_stop

        dispatch_stop(
            thread_id=thread_id,
            success=getattr(turn, "status", None) is lifecycle.TurnStatus.COMPLETED,
            step_count=len(getattr(turn, "items", None) or []),
            session=current_session(),
        )
    except Exception:  # noqa: BLE001 — notification is best-effort
        lifecycle._logger.debug("dispatch_stop skipped", exc_info=True)


def _finish_startup_interrupt(
    runtime: CerebrumRuntime,
    turn: Turn,
    log: Any,
    emitter: EventEmitter,
    *,
    intent: Any | None,
) -> bool:
    """Close an explicit Stop before an execution driver owns the turn.

    ReAct, topology, reflection, and partner drivers each have their own
    cancellation boundary. Startup work happens before any of those drivers
    exist, so relying on their pollers lets an already-acknowledged Stop drift
    through report discovery, intent construction, and agent resolution.
    Preserve the durable user-message anchor, then terminate the turn here.
    """
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    if not emitter.is_turn_interrupted(turn.id):
        return False
    runtime._set_turn_steering_accepting(turn, False)
    turn.status = lifecycle.TurnStatus.CANCELLED
    turn.outcome_reason = "user_cancelled"
    if not turn.interrupt_reason:
        with lifecycle.contextlib.suppress(Exception):
            turn.interrupt_reason = emitter.get_interrupt_reason(turn.id)
    log.turn_updated(
        turn.thread_id,
        turn.id,
        objective_id=turn.objective_id,
        task_id=turn.task_id,
        outcome_reason=turn.outcome_reason,
    )
    lifecycle._close_turn(log, turn.thread_id, turn)
    runtime._snapshot_to_thread_store(turn.thread_id, log, intent)
    return True


def _resolve_session_reference_mentions(
    text: str,
    thread_id: str,
) -> tuple[str, str | None]:
    """Resolve session aliases and canonical Echo mentions in a user prompt.

    Both current ``echo-session:`` references and historical
    ``dsh-session:`` references are accepted.

    Returns ``(clean_text, frame)`` — mention tokens replaced by their
    readable labels plus the rendered referenced-sessions frame when any
    mention resolved (``None`` otherwise). Best-effort: a missing store,
    read failure, or budget error leaves the prompt untouched so mention
    resolution can never break a turn.
    """
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    if not text:
        return text, None
    if (
        "@session:" not in text
        and "@subagent:" not in text
        and not any(scheme in text for scheme in lifecycle.SUPPORTED_SESSION_REFERENCE_SCHEMES)
    ):
        return text, None
    try:
        from runtime.execution.subagents.sessions import (
            get_subagent_session_store,
        )

        store = get_subagent_session_store()
        if store is None:
            return text, None
        resolved = store.resolve_session_mentions(
            text,
            target_id=thread_id,
            strip_mentions=True,
        )
        clean = resolved.content
        if isinstance(clean, str) and clean.strip():
            text = clean
        frame: str | None = None
        if resolved.additional_context is not None:
            content = resolved.additional_context.get("content")
            if isinstance(content, list) and content and isinstance(content[0], dict):
                frame_text = content[0].get("text")
                if isinstance(frame_text, str) and frame_text.strip():
                    frame = frame_text
        return text, frame
    except Exception:  # noqa: BLE001 — mention resolution is best-effort
        lifecycle._logger.debug("session-reference mention resolution skipped", exc_info=True)
        return text, None


async def _surface_pending_subagent_reports(
    thread_id: str,
) -> tuple[int, int]:
    """Claim parked subagent reports without blocking realtime delivery.

    Durable session discovery can parse every session JSON while holding the
    store's main lock.  It used to run before ``turn_started`` and therefore
    made an unrelated cold scan or lock holder look like a failed Send.  Run
    the exact same claim/inject/ack sequence in a worker after the user anchor
    is visible.  ``inject_report_into_thread`` is explicitly worker-safe: it
    crosses into the active turn through the steering registry.

    Returns ``(pending_count, injected_count)`` for startup diagnostics.
    A report is still acknowledged only after successful injection, preserving
    the existing at-least-once durable / exactly-once steering boundary.
    """
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    def _surface() -> tuple[int, int]:
        from runtime.execution.subagents.sessions import (
            get_subagent_session_store,
            inject_report_into_thread,
        )

        store = get_subagent_session_store()
        if store is None:
            return 0, 0
        pending = store.pending_thread_reports(thread_id)
        injected = 0
        for session_id, index, report in pending:
            if inject_report_into_thread(thread_id, report.content):
                store.mark_reports_delivered(session_id, up_to_index=index)
                injected += 1
        return len(pending), injected

    try:
        return await lifecycle.asyncio.to_thread(_surface)
    except Exception:  # noqa: BLE001 — report surfacing is best-effort
        lifecycle._logger.debug("pending subagent report surfacing skipped", exc_info=True)
        return 0, 0


async def _refill_subagent_wake_budget(thread_id: str) -> None:
    """Best-effort human-turn wake-budget refill on the store worker lane."""
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    def _refill() -> None:
        from runtime.execution.subagents.sessions import get_subagent_session_store

        store = get_subagent_session_store()
        if store is not None:
            store.refill_thread_wake_budget(thread_id)

    try:
        await lifecycle.asyncio.to_thread(_refill)
    except Exception:  # noqa: BLE001 — budget refill is best-effort
        lifecycle._logger.debug("subagent wake-budget refill skipped", exc_info=True)


def _schedule_subagent_wake_budget_refill(
    runtime: CerebrumRuntime,
    thread_id: str,
) -> None:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    registry = getattr(runtime, "_pending_subagent_refill_tasks", None)
    if not isinstance(registry, dict):
        registry = {}
        runtime._pending_subagent_refill_tasks = registry
    existing = registry.get(thread_id)
    if existing is not None and not existing.done():
        return
    task = lifecycle.asyncio.create_task(
        lifecycle._refill_subagent_wake_budget(thread_id),
        name=f"subagent-wake-refill:{thread_id}",
    )
    registry[thread_id] = task

    def _discard(done: lifecycle.asyncio.Task[None]) -> None:
        if registry.get(thread_id) is done:
            registry.pop(thread_id, None)

    task.add_done_callback(_discard)


def _schedule_pending_subagent_reports(
    runtime: CerebrumRuntime,
    *,
    thread_id: str,
    turn_id: str,
) -> asyncio.Task[tuple[int, int]]:
    """Return the one live report-surfacing task for ``thread_id``."""
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    registry = getattr(runtime, "_pending_subagent_report_tasks", None)
    if not isinstance(registry, dict):
        registry = {}
        runtime._pending_subagent_report_tasks = registry
    existing = registry.get(thread_id)
    if existing is not None and not existing.done():
        return existing

    worker_started_at = lifecycle.time.perf_counter()
    task = lifecycle.asyncio.create_task(
        lifecycle._surface_pending_subagent_reports(thread_id),
        name=f"pending-subagent-reports:{thread_id}",
    )
    registry[thread_id] = task

    def _complete(done: lifecycle.asyncio.Task[tuple[int, int]]) -> None:
        if registry.get(thread_id) is done:
            registry.pop(thread_id, None)
        if done.cancelled():
            lifecycle._logger.debug(
                "pending subagent report worker cancelled thread_id=%s turn_id=%s",
                thread_id,
                turn_id,
            )
            return
        try:
            pending_count, injected_count = done.result()
        except Exception:  # noqa: BLE001 — diagnostics cannot break task cleanup
            lifecycle._logger.debug("pending subagent report worker failed", exc_info=True)
            return
        lifecycle._logger.info(
            "realtime pending reports worker completed thread_id=%s turn_id=%s "
            "pending_count=%d injected_count=%d worker_ms=%.3f",
            thread_id,
            turn_id,
            pending_count,
            injected_count,
            (lifecycle.time.perf_counter() - worker_started_at) * 1000,
        )

    task.add_done_callback(_complete)
    return task
