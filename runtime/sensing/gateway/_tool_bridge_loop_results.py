"""Commit native tool results, result handoff and code convergence nudges."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from ._tool_bridge_loop_context import _NativeLoopContext, _NativeLoopDirective


def _commit_tool_results(ctx: _NativeLoopContext) -> _NativeLoopDirective:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    ctx._tool_batch_source.cancel(reason="tool batch closed")
    ctx._completed_tool_count += len(ctx.round_tool_calls)
    if ctx._current_native_batch_fingerprint:
        batch_failed = bool(ctx.tool_result_blocks) and all(
            bool(block.get("is_error")) for block in ctx.tool_result_blocks
        )
        if batch_failed:
            previous_count, previous_definitive = ctx._failed_native_batches.get(
                ctx._current_native_batch_fingerprint, (0, False)
            )
            ctx._failed_native_batches[ctx._current_native_batch_fingerprint] = (
                previous_count + 1,
                previous_definitive
                or bridge._native_failure_is_definitive(
                    ctx.round_tool_calls, ctx.tool_result_blocks
                ),
            )
            for call, block in zip(ctx.round_tool_calls, ctx.tool_result_blocks, strict=True):
                if bridge._native_call_failure_is_definitive(call, block):
                    target = bridge._native_definitive_failure_target(call)
                    if target:
                        ctx._definitive_failed_native_targets.add(target)
        else:
            ctx._failed_native_batches.pop(ctx._current_native_batch_fingerprint, None)
            ctx._repeated_failure_guard_hits = 0
            repeatable_read_names = {
                "read_file",
                "read_text_file",
                "list_cwd",
                "glob_files",
                "grep_text",
            }
            for call, block in zip(ctx.round_tool_calls, ctx.tool_result_blocks, strict=True):
                if call.name in repeatable_read_names and (not block.get("is_error")):
                    ctx._successful_native_read_calls.add(
                        bridge._native_tool_call_fingerprint(call)
                    )
    ctx.messages.append(bridge.Message(role="user", content=ctx.tool_result_blocks))
    _plan_milestones = bridge._native_plan_reconciliation_milestones(
        ctx.round_tool_calls, ctx.tool_result_blocks
    )
    if ctx._tool_batch_redirected:
        ctx._append_pending_steering()
        return _NativeLoopDirective.NEXT
    return _NativeLoopDirective.PROCEED


def _announce_tool_results(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    meaningful_batch = any(
        call.name not in {"todo_write", "write_todos", "exit_plan_mode"}
        for call in ctx.round_tool_calls
    )
    result_handoff_required = bool(
        ctx._ordered_read_handoffs
        and meaningful_batch
        and any(
            call.name in {"read_file", "read_text_file", "read_file_range"}
            for call in ctx.round_tool_calls
        )
    )
    _result_commentary_emitted = False
    if (
        (not ctx._round_commentary_emitted or result_handoff_required)
        and (ctx._realtime_public_narrative or ctx._ordered_read_handoffs)
        and meaningful_batch
        and (
            result_handoff_required
            or bridge.time.monotonic() - ctx._last_public_checkpoint_at
            >= ctx._public_narrative_interval
        )
    ):
        try:
            checkpoint, checkpoint_cost = bridge._generate_native_evidence_checkpoint(
                ctx.router,
                model=ctx.effective_model,
                messages=ctx.messages,
                budget=ctx._native_trajectory_budget,
            )
            ctx._accumulate_native_model_cost(checkpoint_cost)
        except Exception as exc:
            bridge._logger.warning("public progress synthesis failed: %s", exc)
            checkpoint = ""
        if ctx._native_trajectory_budget.status != "active":
            ctx._finalize_native_trajectory(success=False, disposition="failed")
            yield (
                "error",
                {
                    "kind": "budget_exceeded",
                    "message": "public progress synthesis exhausted the native turn budget",
                },
                None,
            )
            return _NativeLoopDirective.TERMINAL
        if checkpoint:
            yield ("commentary", checkpoint, None)
            ctx._round_commentary_emitted = True
            _result_commentary_emitted = True
            if result_handoff_required:
                ctx._result_handoff_ready = True
            ctx._last_public_checkpoint_at = bridge.time.monotonic()
    if not ctx._round_commentary_emitted or (
        result_handoff_required and (not _result_commentary_emitted)
    ):
        checkpoint = bridge._native_result_checkpoint(
            ctx.round_tool_calls, ctx.tool_result_blocks, goal=ctx.intent.normalized_goal
        )
        if checkpoint:
            yield ("commentary_runtime", checkpoint, None)
            ctx._round_commentary_emitted = True
            if result_handoff_required:
                ctx._result_handoff_ready = True
    return _NativeLoopDirective.PROCEED


def _apply_round_convergence(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    (
        ctx._pending_code_semantic_nudge,
        ctx._green_convergence_todo_only,
        ctx._force_convergence_next,
    ) = bridge._apply_code_convergence_nudges(
        _pending_code_semantic_nudge=ctx._pending_code_semantic_nudge,
        messages=ctx.messages,
        _green_verification_convergence_active=ctx._green_verification_convergence_active,
        _code_semantic_repair_required=ctx._code_semantic_repair_required,
        _green_convergence_todo_only=ctx._green_convergence_todo_only,
        _force_convergence_next=ctx._force_convergence_next,
    )
    if ctx.round_i + 1 >= ctx._tool_round_budget and ctx._tool_round_budget < ctx.max_tool_rounds:
        yield (
            "commentary_runtime",
            "已达到本轮证据收集预算；现在停止扩展检索，直接用现有结果完成回答。",
            None,
        )
        ctx.messages.append(
            bridge.Message(
                role="user",
                content=f"[SYSTEM CHECK - evidence budget reached]\nThe task used its {ctx._tool_round_budget} tool rounds. Do not call, request, or describe any more tools. Using only the completed observations above, produce the best complete final answer now. Be concise and truthful about any remaining evidence gap.",
            )
        )
        ctx._force_convergence_next = True
    return _NativeLoopDirective.PROCEED
