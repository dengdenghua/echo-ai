"""Native-loop budget receipts, code evidence and frozen terminal trajectory writes."""

from __future__ import annotations

from typing import Any

from runtime.platform.models import CostEntry
from runtime.sensing.model_router.models import ModelRequest, ToolCall

from ._tool_bridge_loop_context import _NativeLoopContext


def _accumulate_native_model_cost(ctx: _NativeLoopContext, actual: CostEntry) -> None:
    ctx._native_model_cost = ctx._native_model_cost + actual
    ctx._total_in_tokens += actual.tokens_in
    ctx._total_out_tokens += actual.tokens_out


def _reserve_native_model_budget(ctx: _NativeLoopContext, request: ModelRequest) -> Any:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    max_output_tokens = request.max_tokens or 2048
    return ctx._native_trajectory_budget.reserve(
        bridge.CostEntry(tokens_out=max(1, int(max_output_tokens)))
    )


def _settle_native_model_response(ctx: _NativeLoopContext, reservation_id: Any, final: Any) -> bool:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    actual = bridge._model_response_actual_cost(final) if final is not None else bridge.CostEntry()
    ctx._native_trajectory_budget.commit(reservation_id, actual)
    ctx._accumulate_native_model_cost(actual)
    return ctx._native_trajectory_budget.status == "active"


def _record_unexecuted_native_attempts(
    ctx: _NativeLoopContext, calls: list[ToolCall], *, failure_type: str
) -> list[int]:
    step_ids = [ctx._native_next_step_id + index for index in range(len(calls))]
    ctx._native_next_step_id += len(calls)
    ctx._native_step_attempts.update(zip(step_ids, calls, strict=True))
    ctx._native_step_failures.update({step_id: failure_type for step_id in step_ids})
    return step_ids


def _finalize_native_trajectory(
    ctx: _NativeLoopContext, *, success: bool, disposition: str
) -> bool:
    """Persist one frozen terminal payload, retrying transient failures."""
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    if ctx._native_trajectory_finalized:
        return False
    if ctx._native_terminal_request is None:
        if ctx._external_cancellation_seen:
            success = False
            disposition = "cancelled"
        ctx._native_terminal_request = (success, disposition)
        ctx._native_terminal_completed_at = bridge.now_utc()
        ctx._native_terminal_model_cost = ctx._native_model_cost.model_copy(
            update={
                "latency_ms": max(
                    ctx._native_model_cost.latency_ms,
                    max(0.0, (bridge.time.monotonic() - ctx._started_at) * 1000),
                )
            }
        )
    terminal_success, terminal_disposition = ctx._native_terminal_request
    inserted = bridge._persist_native_trajectory_safe(
        stack=ctx.stack,
        agent=ctx.agent,
        intent=ctx.intent,
        task_id=ctx._native_trajectory_task_id,
        success=terminal_success,
        disposition=terminal_disposition,
        step_failures=ctx._native_step_failures,
        step_attempts=ctx._native_step_attempts,
        model_cost=ctx._native_terminal_model_cost,
        started_at=ctx._native_trajectory_started_at,
        completed_at=ctx._native_terminal_completed_at,
        _prepared_event_cache=ctx._native_prepared_event_cache,
        _persistence_state=ctx._native_persistence_state,
    )
    if ctx._native_persistence_state.get("durable"):
        ctx._native_trajectory_finalized = True
    return inserted


def _observe_code_tool_result(
    ctx: _NativeLoopContext, call: ToolCall, is_error: bool, output: str, iteration: int
) -> None:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    if not ctx._code_change_task:
        return
    if (call.name in bridge._CODE_MUTATION_TOOLS or bridge._is_shell_mutation(call)) and (
        not is_error
    ):
        ctx._code_mutation_seen = True
        ctx._code_verification_state = None
        ctx._clean_code_verifier_rounds = 0
        ctx._green_verification_convergence_active = False
        ctx._green_convergence_todo_only = False
    if not is_error:
        from runtime.core.cerebrum.react_guards import _concurrency_semantic_followup_guard
        from runtime.core.cerebrum.react_types import ReActStep

        try:
            args_json = bridge.json.dumps(call.input or {}, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            args_json = "{}"
        ctx._code_semantic_steps.append(
            ReActStep(iteration=iteration, action=f"{call.name}({args_json})", observation=output)
        )
        if call.name in bridge._CODE_MUTATION_TOOLS or bridge._is_shell_mutation(call):
            semantic_message = _concurrency_semantic_followup_guard(
                ctx._code_semantic_steps, is_code_mode=True
            )
            ctx._code_semantic_repair_required = semantic_message is not None
            ctx._code_semantic_repair_message = semantic_message or ""
            if semantic_message:
                ctx._pending_code_semantic_nudge = semantic_message
                ctx._code_semantic_guard_nudges += 1
                ctx._code_verification_state = None
                ctx._clean_code_verifier_rounds = 0
                ctx._green_verification_convergence_active = False
                ctx._green_convergence_todo_only = False
            else:
                ctx._pending_code_semantic_nudge = ""
                ctx._code_semantic_guard_nudges = 0
    if call.name in bridge._CODE_VERIFICATION_TOOLS or bridge._is_shell_verification(call):
        ctx._code_verification_state = not is_error
    if call.name in bridge._CODE_TERMINAL_VERIFIER_TOOLS or bridge._is_shell_terminal_verifier(
        call
    ):
        if ctx._code_mutation_seen and (not is_error):
            ctx._clean_code_verifier_rounds += 1
        elif is_error:
            ctx._clean_code_verifier_rounds = 0
        if ctx._code_verification_state is True and ctx._clean_code_verifier_rounds >= 2:
            ctx._green_verification_convergence_active = True
