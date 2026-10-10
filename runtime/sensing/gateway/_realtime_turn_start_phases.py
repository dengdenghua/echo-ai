"""Straight-line startup phases of ``realtime_turn_lifecycle._start_turn``.

Extracted verbatim (mechanical, dataflow-checked extraction). Each helper
receives exactly the locals it reads as keyword arguments and returns the
locals ``_start_turn`` reads afterwards. Names defined in or monkeypatched on
``realtime_turn_lifecycle`` (``_logger``, ``_build_intent``, module helpers and
constants) are passed in so they still resolve in that module at call time.
"""

# Verbatim extraction keeps the source names: module constants arrive as
# upper-case keyword arguments and a trailing assignment stays as written.
# ruff: noqa: N803, RET504

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any

from runtime.execution.engines import ExecutionPhase
from runtime.protocol import ItemStatus, ServerMethod, Turn, TurnStatus
from runtime.safety.approval.approval_gate import ApprovalProvider
from runtime.sensing.gateway._realtime_cerebrum_project_os import _is_project_os_command
from runtime.sensing.gateway._realtime_turn_lifecycle_helpers import (
    _inject_cowork_turn_plan,
    _persist_cowork_user_message,
    _resolve_cowork_responder_agent,
    _start_cowork_orchestration_run,
)
from runtime.sensing.gateway._realtime_turn_lifecycle_resume import _resume_checkpoint_metadata
from runtime.sensing.gateway.realtime_approval import GatewayApprovalProvider
from runtime.sensing.gateway.realtime_execution import TurnExecutionRequest
from runtime.sensing.gateway.realtime_turn_input import (
    _input_attachments,
    _should_default_planning_mode,
    _should_default_topology,
)


def _route_turn_input(*, text, validated, _logger):
    """Slash-command expansion plus default planning-mode / topology routing."""
    if text:
        from runtime.sensing.gateway.slash_command_expansion import (
            maybe_expand_slash_command,
        )

        text = maybe_expand_slash_command(text)
    if _should_default_planning_mode(text, validated):
        validated = validated.model_copy(update={"planning_mode": True})
    # Auto-dispatch to a built-in topology when the user message
    # clearly matches one of the multi-agent categories. Single-
    # agent ReAct stays the default; this only fires for
    # "调研 / 代码评审 / 重构 / 调试"-shaped messages without
    # an explicit topology_id.
    _auto_topology = _should_default_topology(text, validated)
    if _auto_topology is not None:
        validated = validated.model_copy(update={"topology_id": _auto_topology})
        _logger.info(
            "auto-dispatch to topology %r based on user message",
            _auto_topology,
        )

    # Retain the caller's choice: team routing is resolved after context
    # composition and may later select an external coordinator.
    requested_model_before_routing = validated.model
    return text, validated, requested_model_before_routing


async def _register_turn(*, runtime, thread_id, emitter, validated):
    """Reap stale watchers, bind the thread log, create and register the turn."""
    with contextlib.suppress(Exception):
        await runtime._reap_stale_background_tasks(thread_id)

    log = await runtime._ensure_thread(thread_id, emitter)
    runtime._require_thread_owner(
        log,
        getattr(emitter, "actor_id", None),
        access="write",
    )

    turn = Turn(thread_id=thread_id, params=validated)
    from runtime.memory.cowork.delivery import apply_delivery_context, current_delivery

    delivery = current_delivery()
    if delivery is not None:
        delivery["delivery"].bind_turn(delivery, turn.id)
    turn_created_at = time.perf_counter()
    # Every turn has an objective coordinate from its first emitted snapshot.
    # ReAct replaces this provisional id with its durable task id as soon as
    # ``react_started`` arrives; direct/reflection turns keep the turn id.
    turn.objective_id = turn.id
    # Bound before the try so the escape handler at the bottom can
    # attach the intent when the crash happens after PHASE 4 built it
    # (and pass None for earlier failures — both recorders accept it).
    intent = None
    # Register the turn id with the connection's interrupt
    # registry before emitting turn/started. This closes the race
    # where a client's turn/interrupt (matched by id, not sequence)
    # arrives before our first poll.
    emitter.register_turn(turn.id)
    emitter_registered_at = time.perf_counter()
    runtime._register_active_turn(turn, log)
    active_turn_registered_at = time.perf_counter()
    return (
        log,
        turn,
        apply_delivery_context,
        delivery,
        turn_created_at,
        intent,
        emitter_registered_at,
        active_turn_registered_at,
    )


async def _announce_turn_started(
    *,
    log,
    thread_id,
    turn,
    runtime,
    emitter,
    emitter_registered_at,
    turn_created_at,
    active_turn_registered_at,
    text,
    validated,
    _logger,
):
    """Persist + notify turn/started, log startup timing, run prompt hooks."""
    evt = log.turn_started(thread_id, turn)
    turn_started_persisted_at = time.perf_counter()
    runtime._active_turn_ids.add(turn.id)
    await emitter.notify(
        ServerMethod.TURN_STARTED,
        {
            "threadId": thread_id,
            "turn": turn.model_dump(by_alias=True, mode="json"),
            "eventId": evt.event_id,
        },
    )
    turn_started_visible_at = time.perf_counter()
    _logger.info(
        "realtime turn startup timing thread_id=%s turn_id=%s "
        "emitter_register_ms=%.3f active_register_ms=%.3f "
        "turn_started_persist_ms=%.3f turn_started_notify_ms=%.3f "
        "created_to_turn_started_ms=%.3f created_to_visible_ms=%.3f",
        thread_id,
        turn.id,
        (emitter_registered_at - turn_created_at) * 1000,
        (active_turn_registered_at - emitter_registered_at) * 1000,
        (turn_started_persisted_at - active_turn_registered_at) * 1000,
        (turn_started_visible_at - turn_started_persisted_at) * 1000,
        (turn_started_persisted_at - turn_created_at) * 1000,
        (turn_started_visible_at - turn_created_at) * 1000,
    )
    runtime._record_task_run_started(turn, text=text, params=validated)

    # ── PHASE 3 · prompt hooks + user message anchor ───────────
    from runtime.platform.process.session import current_session
    from runtime.safety.hooks.runner import (
        dispatch_session_start,
        dispatch_user_prompt,
    )

    # dsh ``SessionStart``: fired once per bound turn session, before
    # the prompt hook, so per-user context hooks load first. Best-effort
    # by contract — a failing hook degrades to pass_through and never
    # raises into the turn.
    dispatch_session_start(thread_id=thread_id, session=current_session())

    prompt_decision = dispatch_user_prompt(
        prompt_text=text,
        thread_id=thread_id,
        session=current_session(),
    )
    return turn_started_visible_at, prompt_decision


async def _anchor_user_message(
    *,
    text,
    thread_id,
    validated,
    delivery,
    turn,
    runtime,
    log,
    emitter,
    turn_started_visible_at,
    turn_created_at,
    _resolve_session_reference_mentions,
    _logger,
):
    """Resolve session-reference mentions and emit the user-message anchor."""
    text, session_reference_frame = _resolve_session_reference_mentions(
        text,
        thread_id,
    )

    # Record the user's message as a first-class turn item so
    # ``_flatten_turns_to_messages`` and the realtime adapter
    # both see a HumanMessage anchor. Without this the sidebar
    # title falls back to empty and the chat history starts
    # with the AI's reply only.
    user_item = None
    user_message_visible_at: float | None = None
    try:
        from runtime.protocol import UserMessageItem

        attachments = _input_attachments(validated.input)
        if delivery is not None:
            # This is a system continuation, never a fabricated human message.
            attachments = []
        elif validated.user_item_id is None:
            user_item = UserMessageItem(text=text, attachments=attachments)
        else:
            user_item = UserMessageItem(
                id=validated.user_item_id,
                text=text,
                attachments=attachments,
            )
        if user_item is not None:
            turn.items.append(user_item)
            await runtime._emit_item_started(turn, log, emitter, user_item)
            user_item.status = ItemStatus.COMPLETED
            await runtime._emit_item_completed(turn, log, emitter, user_item)
        user_message_visible_at = time.perf_counter()
        _logger.info(
            "realtime user message timing thread_id=%s turn_id=%s item_id=%s "
            "turn_started_to_user_visible_ms=%.3f created_to_user_visible_ms=%.3f",
            thread_id,
            turn.id,
            user_item.id if user_item else "auto-delivery",
            (user_message_visible_at - turn_started_visible_at) * 1000,
            (user_message_visible_at - turn_created_at) * 1000,
        )
    except Exception:  # noqa: BLE001
        # Non-fatal: react loop still runs without the anchor.
        _logger.debug("user-message anchor skipped", exc_info=True)
    return text, session_reference_frame, user_item, user_message_visible_at


async def _await_pending_subagent_reports(
    *,
    _auto_wake,
    runtime,
    thread_id,
    turn,
    emitter,
    user_message_visible_at,
    turn_started_visible_at,
    _schedule_subagent_wake_budget_refill,
    _schedule_pending_subagent_reports,
    _PENDING_REPORT_STARTUP_BUDGET_S,
    _STARTUP_INTERRUPT_POLL_S,
    _logger,
):
    """Refill wake budget and wait (bounded) for parked subagent reports."""
    pending_reports_started_at = time.perf_counter()
    if not _auto_wake:
        _schedule_subagent_wake_budget_refill(runtime, thread_id)
    pending_reports_task = _schedule_pending_subagent_reports(
        runtime,
        thread_id=thread_id,
        turn_id=turn.id,
    )
    reports_deadline = asyncio.get_running_loop().time() + _PENDING_REPORT_STARTUP_BUDGET_S
    reports_ready = pending_reports_task.done()
    while not reports_ready and not emitter.is_turn_interrupted(turn.id):
        remaining = reports_deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        completed_report_tasks, _ = await asyncio.wait(
            {pending_reports_task},
            timeout=min(_STARTUP_INTERRUPT_POLL_S, remaining),
        )
        reports_ready = pending_reports_task in completed_report_tasks
    pending_count: int | None = None
    injected_count: int | None = None
    if reports_ready:
        pending_count, injected_count = pending_reports_task.result()
    pending_reports_finished_at = time.perf_counter()
    _logger.info(
        "realtime pending reports timing thread_id=%s turn_id=%s "
        "pending_count=%s injected_count=%s deferred=%s "
        "pending_reports_ms=%.3f user_visible_to_reports_ready_ms=%.3f",
        thread_id,
        turn.id,
        pending_count if pending_count is not None else "pending",
        injected_count if injected_count is not None else "pending",
        str(not reports_ready).lower(),
        (pending_reports_finished_at - pending_reports_started_at) * 1000,
        (pending_reports_finished_at - (user_message_visible_at or turn_started_visible_at)) * 1000,
    )


async def _apply_cowork_turn_context(
    *, runtime, thread_id, text, intent, delivery, apply_delivery_context, user_item, emitter
):
    """Cowork plan / delivery context, persist the room message, team pattern."""
    _inject_cowork_turn_plan(
        runtime,
        thread_id=thread_id,
        text=text,
        intent=intent,
    )
    if delivery is not None:
        apply_delivery_context(intent, delivery)
    if user_item is not None:
        room_message = _persist_cowork_user_message(
            runtime,
            thread_id=thread_id,
            text=text,
            item_id=user_item.id,
            actor_id=getattr(emitter, "actor_id", None),
            intent=intent,
        )
        if room_message is not None:
            from .collaboration_events import broadcast_thread_update

            await broadcast_thread_update(
                getattr(runtime, "_team_rooms_router", None),
                room_id=str((intent.user_context or {}).get("cowork_room_id") or ""),
                thread_id=thread_id,
                reason="message",
            )
    explicit_project_command = _is_project_os_command(text)
    _planned_team_pattern = (intent.user_context or {}).get("team_pattern")
    _planned_pattern_execution = (
        str(_planned_team_pattern.get("execution") or "").strip()
        if isinstance(_planned_team_pattern, dict)
        else ""
    )
    return explicit_project_command, _planned_pattern_execution


async def _attach_resume_context(*, runtime, thread_id, text, intent):
    """Attach a confirmed resume intent or the recent paused-task context."""
    confirmed_resume_intent = await runtime._consume_confirmed_resume_intent(thread_id, text)
    if confirmed_resume_intent is None:
        confirmed_resume_intent = await runtime._consume_paused_task_resume_intent(
            thread_id,
            text,
        )
    if confirmed_resume_intent is not None:
        intent.user_context["resume_intent"] = confirmed_resume_intent
    else:
        # Preserve enough durable context for status probes/amendments
        # without restoring raw model messages.  This prevents a paused
        # task followed by "?" or "怎么了" from becoming a context-free
        # greeting while keeping a new objective isolated from old drafts.
        from runtime.core.cerebrum.pause_control import get_pause_controller

        paused_requests = sorted(
            (
                request
                for request in get_pause_controller().list_paused()
                if request.thread_id == thread_id
            ),
            key=lambda request: request.requested_at,
            reverse=True,
        )[:5]
        paused_contexts: list[dict[str, Any]] = []
        for paused_request in paused_requests:
            checkpoint = _resume_checkpoint_metadata(runtime, paused_request.task_id) or {}
            paused_contexts.append(
                {
                    "task_id": paused_request.task_id,
                    "objective_id": paused_request.task_id,
                    "reason": paused_request.reason,
                    "note": paused_request.note,
                    "iteration": checkpoint.get("iteration", 0),
                    "phase": checkpoint.get("phase", ""),
                    "working_set": checkpoint.get("working_set", []),
                    "checkpoint_id": checkpoint.get("checkpoint_id", 0),
                    "resumable": True,
                }
            )
        if paused_contexts:
            intent.user_context["paused_tasks_context"] = paused_contexts
            if len(paused_contexts) == 1:
                intent.user_context["paused_task_context"] = paused_contexts[0]
    resume_intent = intent.user_context.get("resume_intent")
    return resume_intent


def _resolve_turn_provider_and_agent(*, runtime, thread_id, turn, intent, text, emitter, validated):
    """Start cowork orchestration, build the approval provider, pick the agent."""
    _start_cowork_orchestration_run(
        runtime,
        thread_id=thread_id,
        turn=turn,
        intent=intent,
        text=text,
    )

    # ── PHASE 5 · execution dispatch (topology/fast/react) ─────
    loop = asyncio.get_running_loop()
    gateway_provider = GatewayApprovalProvider(
        emitter,
        loop,
        thread_id=thread_id,
        turn_id=turn.id,
        trace_store=runtime._trace_store,
    )
    provider: ApprovalProvider = runtime._wrap_with_policy(gateway_provider)
    agent = runtime._resolve_agent(validated)
    agent = _resolve_cowork_responder_agent(
        runtime,
        intent=intent,
        fallback=agent,
    )
    return provider, agent


async def _drain_late_steering(*, turn, runtime, intent, execution, validated, turn_driver):
    """Consume steering accepted before intake closed, one round at a time."""
    while turn.status not in {
        TurnStatus.PAUSED,
        TurnStatus.CANCELLED,
        TurnStatus.INTERRUPTED,
        TurnStatus.FAILED,
    }:
        # Close intake before the last durable drain. Any steering RPC
        # acknowledged before this lease update is already in the log and
        # must be consumed; any later RPC is rejected instead of being
        # accepted after the final answer can no longer change.
        runtime._set_turn_steering_accepting(turn, False)
        late_steering = runtime._drain_turn_steering(turn.id)
        if not late_steering:
            break
        runtime._set_turn_steering_accepting(turn, True)
        correction = "\n\n".join(late_steering)
        steering_context = dict(intent.user_context or {})
        steering_context["live_steering"] = True
        steering_intent = intent.model_copy(
            update={
                "raw": correction,
                "normalized_goal": correction,
                "user_context": steering_context,
            }
        )
        turn_driver = execution.route.driver_for(ExecutionPhase.STEERING)
        await execution.execute(
            TurnExecutionRequest(steering_intent, correction, validated.model),
            phase=ExecutionPhase.STEERING,
        )
    return turn_driver
