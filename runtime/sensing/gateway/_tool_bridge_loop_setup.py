"""Native-loop prompt contracts, tracking setup and callback registration."""

from __future__ import annotations

from collections.abc import Callable
from functools import partial
from typing import Any

from runtime.platform.models import ParsedIntent

from ._tool_bridge_loop_context import _NativeLoopContext
from ._tool_bridge_loop_steering import _append_pending_steering, _capture_steering
from ._tool_bridge_loop_tracking import (
    _accumulate_native_model_cost,
    _finalize_native_trajectory,
    _observe_code_tool_result,
    _record_unexecuted_native_attempts,
    _reserve_native_model_budget,
    _settle_native_model_response,
)


def _prepare_prompt(
    stack: Any,
    intent: ParsedIntent,
    agent: Any,
    *,
    model: str | None = None,
    sub_event_queue: Any = None,
    steering_drain: Callable[[], list[str]] | None = None,
    _register_native_finalizer: Callable[[Callable[..., bool]], None] | None = None,
) -> _NativeLoopContext | None:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    ctx = _NativeLoopContext(
        stack=stack,
        intent=intent,
        agent=agent,
        model=model,
        sub_event_queue=sub_event_queue,
        steering_drain=steering_drain,
        _register_native_finalizer=_register_native_finalizer,
    )
    from runtime.sensing.gateway import tool_bridge as _tb

    ctx.max_tool_rounds = _tb.MAX_TOOL_ROUNDS
    ctx._native_model_round_timeout_s = _tb._native_model_round_timeout_s
    ctx.router = getattr(ctx.stack.planner, "router", None)
    if ctx.router is None:
        return None
    _profile_memories_payload, ctx.messages = bridge._base_conversation_messages(
        intent=ctx.intent, agent=ctx.agent, __file__=bridge.__file__
    )
    bridge._insert_capability_assertions(messages=ctx.messages, stack=ctx.stack)
    bridge._insert_profile_and_memory_sections(
        _profile_memories_payload=_profile_memories_payload,
        intent=ctx.intent,
        messages=ctx.messages,
        agent=ctx.agent,
        stack=ctx.stack,
        _logger=bridge._logger,
    )
    ctx._intent_user_context, ctx._browser_required_evidence = (
        bridge._insert_turn_contract_sections(
            intent=ctx.intent, stack=ctx.stack, agent=ctx.agent, messages=ctx.messages
        )
    )
    ctx._code_change_task, ctx._evidence_task, ctx._todo_protocol_required, ctx._has_todo_write = (
        bridge._insert_task_contract_sections(
            intent=ctx.intent,
            messages=ctx.messages,
            _intent_user_context=ctx._intent_user_context,
            stack=ctx.stack,
        )
    )
    ctx._session_obj = bridge._build_native_session(
        _intent_user_context=ctx._intent_user_context,
        intent=ctx.intent,
        stack=ctx.stack,
        agent=ctx.agent,
        sub_event_queue=ctx.sub_event_queue,
    )
    ctx.effective_model, ctx.tool_specs, ctx.evidence_tool_specs, ctx._tool_round_budget = (
        bridge._resolve_native_tool_specs(
            model=ctx.model,
            stack=ctx.stack,
            agent=ctx.agent,
            _intent_user_context=ctx._intent_user_context,
            intent=ctx.intent,
            _code_change_task=ctx._code_change_task,
            max_tool_rounds=ctx.max_tool_rounds,
            messages=ctx.messages,
        )
    )
    if not ctx.tool_specs:
        bridge._logger.warning("agentic · no tool specs available · degrading to direct")
        return None
    return ctx


def _initialize_tracking(ctx: _NativeLoopContext) -> None:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    ctx.accumulated_text = ""
    ctx.accumulated_reasoning = ""
    ctx._started_at = bridge.time.monotonic()
    ctx._native_trajectory_task_id = bridge.TaskId(bridge.uuid4())
    ctx._native_trajectory_arm_id = bridge.ArmId("agentic")
    ctx._native_trajectory_budget = bridge.Budget(
        ctx._native_trajectory_task_id, bridge.BudgetLimits(tokens=100000, usd=10.0)
    )
    ctx._native_trajectory_started_at = bridge.now_utc()
    ctx._native_next_step_id = 0
    ctx._last_public_checkpoint_at = ctx._started_at
    ctx._realtime_public_narrative = bool(ctx._intent_user_context.get("realtime_public_narrative"))
    ctx._public_narrative_interval = bridge._public_narrative_silence_s(ctx._intent_user_context)
    ctx._ordered_read_handoffs = bridge._ordered_read_handoffs_requested(ctx.intent.normalized_goal)
    ctx._result_handoff_ready = False
    ctx._total_in_tokens = 0
    ctx._total_out_tokens = 0
    ctx._native_model_cost = bridge.CostEntry()
    ctx._accumulate_native_model_cost = partial(_accumulate_native_model_cost, ctx)
    ctx._reserve_native_model_budget = partial(_reserve_native_model_budget, ctx)
    ctx._settle_native_model_response = partial(_settle_native_model_response, ctx)
    ctx._todo_seen = False
    _tool_work_since_todo = False
    _todo_guard_nudges = 0
    ctx._tool_error_count = 0
    ctx._completed_tool_count = 0
    ctx._attempted_models = {ctx.effective_model}
    ctx._provider_failovers = 0
    ctx._stall_failovers = 0
    ctx._code_mutation_seen = False
    ctx._code_verification_state = None
    ctx._clean_code_verifier_rounds = 0
    ctx._green_verification_convergence_active = False
    ctx._green_convergence_todo_only = False
    ctx._code_semantic_steps = []
    ctx._code_semantic_repair_required = False
    ctx._code_semantic_repair_message = ""
    ctx._pending_code_semantic_nudge = ""
    ctx._code_semantic_guard_nudges = 0
    ctx._code_completion_nudges = 0
    ctx._code_no_action_stops = 0
    ctx._evidence_no_action_stops = 0
    ctx._quality_failovers = 0
    ctx._browser_observed_evidence = set()
    ctx._browser_guard_nudges = 0
    ctx._force_convergence_next = False
    ctx._model_timeout_recoveries = 0
    ctx._failed_native_batches = {}
    ctx._definitive_failed_native_targets = set()
    ctx._successful_native_read_calls = set()
    ctx._repeated_failure_guard_hits = 0
    ctx._pending_steering = []
    ctx._last_steering_probe_at = 0.0
    ctx._native_step_failures = {}
    ctx._native_step_attempts = {}
    ctx._external_cancellation_seen = False
    ctx._native_trajectory_finalized = False
    ctx._native_terminal_request = None
    ctx._native_terminal_completed_at = None
    ctx._native_terminal_model_cost = None
    ctx._native_prepared_event_cache = {}
    ctx._native_persistence_state = {}
    ctx._record_unexecuted_native_attempts = partial(_record_unexecuted_native_attempts, ctx)
    ctx._finalize_native_trajectory = partial(_finalize_native_trajectory, ctx)
    if ctx._register_native_finalizer is not None:
        ctx._register_native_finalizer(ctx._finalize_native_trajectory)
    if (ctx.intent.user_context or {}).get("live_steering"):
        from runtime.core.cerebrum.live_steering import insert_live_steering_protocol

        insert_live_steering_protocol(ctx.messages)


def _initialize_steering(ctx: _NativeLoopContext) -> None:
    ctx._capture_steering = partial(_capture_steering, ctx)
    ctx._append_pending_steering = partial(_append_pending_steering, ctx)
    ctx._observe_code_tool_result = partial(_observe_code_tool_result, ctx)
    from runtime.platform.process.session import _current_session

    ctx._current_session = _current_session
