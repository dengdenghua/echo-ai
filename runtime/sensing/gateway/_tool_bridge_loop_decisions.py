"""Native call guards, public action handoff and terminal evidence acceptance."""

from __future__ import annotations

from collections.abc import Generator
from functools import partial
from typing import Any

from ._tool_bridge_loop_context import _NativeLoopContext, _NativeLoopDirective


def _take_action_narration(ctx: _NativeLoopContext, *, wait_for_completion: bool = False) -> str:
    """Collect one in-flight action update without delaying tool start."""
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    future = ctx._action_narration_future
    if future is None or (not wait_for_completion and (not future.done())):
        return ""
    try:
        checkpoint, checkpoint_cost = future.result()
        ctx._accumulate_native_model_cost(checkpoint_cost)
    except Exception as exc:
        bridge._logger.warning("public action narration failed: %s", exc)
        checkpoint = ""
    finally:
        if ctx._action_narration_pool is not None:
            ctx._action_narration_pool.shutdown(wait=False, cancel_futures=True)
        ctx._action_narration_future = None
        ctx._action_narration_pool = None
    if checkpoint:
        ctx._round_commentary_emitted = True
        ctx._last_public_checkpoint_at = bridge.time.monotonic()
    return checkpoint


def _guard_native_calls(ctx: _NativeLoopContext) -> _NativeLoopDirective:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    _duplicate_native_calls = 0
    ctx._current_native_batch_fingerprint = ""
    ctx._structured_public_checkpoint = ""
    if ctx.round_tool_calls:
        ctx.round_tool_calls, ctx._structured_public_checkpoint = (
            bridge._native_calls_with_public_checkpoint(ctx.round_tool_calls)
        )
        ctx.round_tool_calls, _duplicate_native_calls = bridge._deduplicate_native_tool_calls(
            ctx.round_tool_calls
        )
        suppressed_targets = [
            target
            for call in ctx.round_tool_calls
            if (target := bridge._native_definitive_failure_target(call))
            in ctx._definitive_failed_native_targets
        ]
        if suppressed_targets:
            ctx.round_tool_calls = [
                call
                for call in ctx.round_tool_calls
                if bridge._native_definitive_failure_target(call)
                not in ctx._definitive_failed_native_targets
            ]
            ctx._repeated_failure_guard_hits += 1
            ctx.messages.append(
                bridge.Message(
                    role="user",
                    content="[SYSTEM CHECK - definitive missing target suppressed]\nThe runtime did not repeat a read against a path already confirmed missing. Pagination or range changes cannot make that target exist. Correct the path, inspect its parent directory, use a different source, or finish from existing evidence. Do not request the same missing target again.",
                )
            )
            if not ctx.round_tool_calls:
                if ctx._repeated_failure_guard_hits >= 2:
                    ctx._force_convergence_next = True
                return _NativeLoopDirective.NEXT
        repeated_successes = [
            bridge._native_tool_call_fingerprint(call)
            for call in ctx.round_tool_calls
            if bridge._native_tool_call_fingerprint(call) in ctx._successful_native_read_calls
        ]
        if repeated_successes:
            ctx.round_tool_calls = [
                call
                for call in ctx.round_tool_calls
                if bridge._native_tool_call_fingerprint(call)
                not in ctx._successful_native_read_calls
            ]
            ctx._repeated_failure_guard_hits += 1
            ctx.messages.append(
                bridge.Message(
                    role="user",
                    content="[SYSTEM CHECK - redundant successful read suppressed]\nThe identical read/search/list call already succeeded in this turn. Reuse its existing result instead of executing it again. Choose a genuinely new evidence source only if the user's request still has a specific unmet gap; otherwise finalize now.",
                )
            )
            if not ctx.round_tool_calls:
                ctx._force_convergence_next = True
                return _NativeLoopDirective.NEXT
        ctx._current_native_batch_fingerprint = bridge._native_tool_batch_fingerprint(
            ctx.round_tool_calls
        )
        failed_count, definitive_failure = ctx._failed_native_batches.get(
            ctx._current_native_batch_fingerprint, (0, False)
        )
        retry_limit = 1 if definitive_failure else 2
        if failed_count >= retry_limit:
            ctx._repeated_failure_guard_hits += 1
            ctx.messages.append(
                bridge.Message(
                    role="user",
                    content="[SYSTEM CHECK - repeated failed tool call suppressed]\nThe runtime did not execute the identical tool call or ordered batch again because the same arguments already produced a definitive failure. Treat that result as evidence. Correct the path or arguments, choose a different evidence source, or finish from the evidence already collected. Do not repeat the same call.",
                )
            )
            if ctx._repeated_failure_guard_hits >= 2:
                ctx._force_convergence_next = True
            return _NativeLoopDirective.NEXT
    return _NativeLoopDirective.PROCEED


def _announce_native_action(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    _prior_result_handoff = bool(ctx.round_tool_calls and ctx._result_handoff_ready)
    if _prior_result_handoff:
        ctx._round_commentary_emitted = True
    if ctx.round_tool_calls and (not ctx._round_commentary_emitted):
        if ctx._round_text_streamed > 0:
            checkpoint = ctx._structured_public_checkpoint
            if not checkpoint:
                ctx._round_commentary_emitted = True
                ctx._last_public_checkpoint_at = bridge.time.monotonic()
        else:
            checkpoint = ctx._structured_public_checkpoint or bridge._native_public_checkpoint(
                ctx.round_text
            )
        if checkpoint:
            yield ("commentary", checkpoint, None)
            ctx._round_commentary_emitted = True
            ctx._last_public_checkpoint_at = bridge.time.monotonic()
    ctx._action_narration_pool = None
    ctx._action_narration_future = None
    if (
        ctx.round_tool_calls
        and (not ctx._round_commentary_emitted)
        and (not ctx._round_redirected)
        and (ctx._realtime_public_narrative or ctx._ordered_read_handoffs)
        and any(
            call.name not in {"todo_write", "write_todos", "exit_plan_mode"}
            for call in ctx.round_tool_calls
        )
        and (
            ctx._completed_tool_count == 0
            or bridge.time.monotonic() - ctx._last_public_checkpoint_at
            >= ctx._public_narrative_interval
        )
    ):
        ctx._action_narration_pool = bridge.ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="tool-bridge-public-action"
        )
        ctx._action_narration_future = ctx._action_narration_pool.submit(
            bridge.contextvars.copy_context().run,
            bridge._generate_native_action_checkpoint,
            ctx.router,
            model=ctx.effective_model,
            messages=ctx.messages,
            calls=ctx.round_tool_calls,
            budget=ctx._native_trajectory_budget,
        )
    ctx._take_action_narration = partial(_take_action_narration, ctx)
    if ctx.round_tool_calls:
        ctx._result_handoff_ready = False
    checkpoint = ctx._take_action_narration(wait_for_completion=True)
    if checkpoint:
        yield ("commentary", checkpoint, None)
    return _NativeLoopDirective.PROCEED


def _announce_tool_requests(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    if ctx.round_tool_calls and ctx._native_trajectory_budget.status != "active":
        ctx._record_unexecuted_native_attempts(ctx.round_tool_calls, failure_type="budget_exceeded")
        ctx._tool_error_count += len(ctx.round_tool_calls)
        ctx._finalize_native_trajectory(success=False, disposition="failed")
        yield (
            "error",
            {
                "kind": "budget_exceeded",
                "message": "public narration actual cost exceeded the native turn budget; pending tool calls were not executed",
            },
            None,
        )
        return _NativeLoopDirective.TERMINAL
    for call in ctx.round_tool_calls:
        yield (
            "tool_start",
            {"id": call.id, "name": call.name, "input": call.input, "iteration": ctx.round_i + 1},
            None,
        )
    return _NativeLoopDirective.PROCEED


def _guard_terminal_evidence(ctx: _NativeLoopContext) -> _NativeLoopDirective:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    ctx._capture_steering(force=True)
    if ctx._pending_steering:
        if ctx.round_text.strip():
            ctx.messages.append(bridge.Message(role="assistant", content=ctx.round_text))
        ctx._append_pending_steering()
        return _NativeLoopDirective.NEXT
    _missing_browser_evidence = ctx._browser_required_evidence - ctx._browser_observed_evidence
    if (
        not ctx._round_convergence_mode
        and _missing_browser_evidence
        and (ctx._browser_guard_nudges < 3)
    ):
        ctx._browser_guard_nudges += 1
        ctx.accumulated_text = ""
        ctx.messages.append(
            bridge.Message(
                role="user",
                content="[SYSTEM CHECK - browser task incomplete]\nDo not finish yet. Continue through the browser UI. The current trajectory still lacks successful action evidence for: "
                + ", ".join(sorted(_missing_browser_evidence))
                + ". Use the persistent browser_* tools and verify the resulting page state before answering.",
            )
        )
        return _NativeLoopDirective.NEXT
    if not ctx._round_convergence_mode and ctx._code_change_task and (not ctx._code_mutation_seen):
        ctx._code_no_action_stops += 1
        if ctx._code_no_action_stops >= 2 and ctx._quality_failovers < 2:
            _, _rescue_fallback = bridge._rescue_policy_names()
            fallback_model = _rescue_fallback(ctx.effective_model, ctx._attempted_models)
            if fallback_model:
                bridge._logger.warning(
                    "code model %s stopped without acting; switching to %s",
                    ctx.effective_model,
                    fallback_model,
                )
                ctx.effective_model = fallback_model
                ctx._attempted_models.add(fallback_model)
                ctx._quality_failovers += 1
                ctx._code_no_action_stops = 0
                ctx._code_completion_nudges = 0
                _todo_guard_nudges = 0
                ctx.messages.append(
                    bridge.Message(
                        role="user",
                        content="[SYSTEM CHECK - execution model fallback]\nThe previous model route stopped twice without making the requested code change. Continue the task now: inspect the scoped workspace, modify the implementation and regression tests, and run real verification before answering.",
                    )
                )
                return _NativeLoopDirective.NEXT
    if (
        not ctx._round_convergence_mode
        and ctx._evidence_task
        and (ctx._completed_tool_count == 0)
        and (ctx._evidence_no_action_stops < 1)
    ):
        ctx._evidence_no_action_stops += 1
        ctx.accumulated_text = ""
        ctx.messages.append(
            bridge.Message(
                role="user",
                content="[SYSTEM CHECK - evidence required]\nNo workspace evidence was collected. Do not finish with a plan or a generic opinion. Call a real read, list, search, or browser inspection tool now; if the requested source is unavailable, verify that fact with a tool and report the concrete blocker.",
            )
        )
        return _NativeLoopDirective.NEXT
    if (
        not ctx._round_convergence_mode
        and ctx._code_change_task
        and ctx._code_semantic_repair_required
        and (ctx._code_semantic_guard_nudges < 4)
    ):
        ctx._code_semantic_guard_nudges += 1
        ctx.accumulated_text = ""
        ctx.messages.append(
            bridge.Message(
                role="user",
                content="[SYSTEM CHECK - concurrency semantic repair required]\n"
                + ctx._code_semantic_repair_message
                + " Do not finalize or rerun equivalent verification yet. Inspect and repair the affected production implementation first.",
            )
        )
        return _NativeLoopDirective.NEXT
    if (
        not ctx._round_convergence_mode
        and ctx._code_change_task
        and (not ctx._code_mutation_seen or ctx._code_verification_state is not True)
        and (ctx._code_completion_nudges < 2)
    ):
        ctx._code_completion_nudges += 1
        if not ctx._code_mutation_seen:
            state = "No successful source or regression-test mutation was observed."
        elif ctx._code_verification_state is False:
            state = "The latest verification failed."
        else:
            state = "The changed files have not been verified after the latest mutation."
        ctx.accumulated_text = ""
        ctx.messages.append(
            bridge.Message(
                role="user",
                content=f"[SYSTEM CHECK - implementation not verified]\n{state} Do not finalize or pause yet. Inspect the current files, repair the implementation or regression tests, then rerun a focused test/lint command. Only finish after that command succeeds, or clearly report a concrete external blocker that tools cannot resolve.",
            )
        )
        return _NativeLoopDirective.NEXT
    return _NativeLoopDirective.PROCEED


def _finish_native_synthesis(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    if ctx._completed_tool_count > 0:
        yield ("commentary_runtime", "证据已经收齐；我现在把关键信息收束成最终回答。", None)
    ctx.accumulated_text += ctx.round_text
    _final_duration = int((bridge.time.monotonic() - ctx._started_at) * 1000)
    ctx._finalize_native_trajectory(success=bool(ctx.accumulated_text), disposition="completed")
    if ctx._round_text_streamed < len(ctx.round_text):
        yield ("text", ctx.round_text[ctx._round_text_streamed :], None)
    yield (
        "stats",
        {
            "input_tokens": ctx._total_in_tokens,
            "output_tokens": ctx._total_out_tokens,
            "duration_ms": _final_duration,
            "rounds": ctx.round_i + 1,
        },
        None,
    )
    bridge._record_score_safe(
        agent=ctx.agent,
        intent=ctx.intent,
        has_final_reply=bool(ctx.accumulated_text),
        tool_error_count=ctx._tool_error_count,
        rounds_used=ctx.round_i + 1,
        duration_ms=_final_duration,
    )
    yield ("done", "", ctx.accumulated_text)
    return _NativeLoopDirective.TERMINAL
