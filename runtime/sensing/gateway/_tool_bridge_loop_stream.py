"""Prepare, reserve, stream and recover one native model round."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from ._tool_bridge_context_budget import NativeContextBudgetError, fit_native_request
from ._tool_bridge_loop_context import _NativeLoopContext, _NativeLoopDirective


def _prepare_model_round(ctx: _NativeLoopContext) -> _NativeLoopDirective:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    ctx._capture_steering(force=True)
    ctx._append_pending_steering()
    if ctx.round_i > 0 and ctx.round_i % bridge.REFLECTION_INTERVAL == 0:
        ctx.messages.append(
            bridge.Message(
                role="user",
                content=bridge._reflection_checkpoint_message(ctx.round_i, ctx._tool_round_budget),
            )
        )
    _round_plan_bootstrap_mode = (
        ctx._todo_protocol_required
        and ctx._has_todo_write
        and (not ctx._todo_seen)
        and (ctx._completed_tool_count == 0)
    )
    _round_todo_only_mode = ctx._green_convergence_todo_only
    ctx._round_convergence_mode = ctx._force_convergence_next
    ctx._force_convergence_next = False
    _round_tool_specs = ctx.evidence_tool_specs if ctx._completed_tool_count > 0 else ctx.tool_specs
    if _round_plan_bootstrap_mode or _round_todo_only_mode:
        ctx._active_tool_specs = [spec for spec in _round_tool_specs if spec.name == "todo_write"]
    elif ctx._round_convergence_mode:
        ctx._active_tool_specs = []
    else:
        ctx._active_tool_specs = _round_tool_specs
    _native_wants_thinking = bridge.model_supports_thinking(ctx.effective_model)
    ctx.req = bridge.ModelRequest(
        model=ctx.effective_model,
        messages=ctx.messages,
        max_tokens=4096,
        temperature=1.0,
        enable_thinking=_native_wants_thinking,
        thinking_budget=bridge.thinking_budget_for_effort(
            ctx._intent_user_context.get("reasoning_effort"), 4096
        ),
        tools=ctx._active_tool_specs,
        require_tool_use=True
        if _round_plan_bootstrap_mode or _round_todo_only_mode
        else False
        if ctx._round_convergence_mode
        else ctx._code_change_task
        and (
            not ctx._code_mutation_seen
            or ctx._code_verification_state is not True
            or ctx._code_semantic_repair_required
        )
        or (ctx._evidence_task and ctx._completed_tool_count == 0)
        or bool(ctx._browser_required_evidence - ctx._browser_observed_evidence),
    )
    ctx.round_text_chunks = []
    ctx.round_tool_calls = []
    ctx._round_commentary_emitted = False
    ctx._round_timed_out = False
    ctx._round_redirected = False
    ctx._round_text_streamed = 0
    ctx._round_text_stream_suppressed = False
    ctx._round_prefix_decided = False
    ctx._round_stream_event_seen = False
    ctx._round_timeout_s = ctx._native_model_round_timeout_s()
    if ctx._completed_tool_count > 0:
        ctx._round_timeout_s = bridge._native_post_tool_timeout_s(ctx._round_timeout_s)
    if ctx._round_convergence_mode:
        ctx._round_timeout_s = bridge._native_model_recovery_timeout_s(ctx._round_timeout_s)
    return _NativeLoopDirective.PROCEED


def _reserve_model_round(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    try:
        ctx.req = fit_native_request(ctx.req)
    except NativeContextBudgetError as exc:
        ctx._finalize_native_trajectory(success=False, disposition="failed")
        yield ("error", {"kind": "context_budget_exceeded", "message": str(exc)}, None)
        return _NativeLoopDirective.TERMINAL

    try:
        ctx._round_model_reservation = ctx._reserve_native_model_budget(ctx.req)
    except bridge.InsufficientBudget as exc:
        ctx._finalize_native_trajectory(success=False, disposition="failed")
        yield ("error", {"kind": "budget_exceeded", "message": str(exc)}, None)
        return _NativeLoopDirective.TERMINAL
    ctx._round_model_reservation_settled = False
    ctx._round_model_budget_exceeded = False
    return _NativeLoopDirective.PROCEED


def _stream_model_round(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    try:
        for event in bridge._iter_native_model_stream_with_deadline(
            ctx.router,
            ctx.req,
            ctx._round_timeout_s,
            visible_started=lambda chunks=ctx.round_text_chunks: len(chunks),
            redirect_probe=ctx._capture_steering,
        ):
            if event is bridge._NATIVE_STREAM_DEADLINE:
                ctx._round_timed_out = True
                bridge._logger.warning(
                    "agentic round %d exceeded %.1fs; switching to convergence",
                    ctx.round_i + 1,
                    ctx._round_timeout_s,
                )
                break
            if event is bridge._NATIVE_STREAM_REDIRECTED:
                ctx._round_redirected = True
                break
            ctx._round_stream_event_seen = True
            etype = event.type
            if etype == "text_delta":
                ctx.round_text_chunks.append(event.delta)
                if not ctx._round_prefix_decided:
                    _joined_prefix_probe = "".join(ctx.round_text_chunks)
                    _prefix_match = bridge._NATIVE_ROUND_TEXT_PREFIX_RE.match(_joined_prefix_probe)
                    if _prefix_match:
                        ctx.round_text_chunks[:] = [_joined_prefix_probe[_prefix_match.end() :]]
                        ctx._round_prefix_decided = True
                    elif len(_joined_prefix_probe) >= len("Progress: "):
                        ctx._round_prefix_decided = True
                if (
                    ctx._completed_tool_count > 0
                    and (not ctx._round_text_stream_suppressed)
                    and event.delta
                ):
                    _joined_round = "".join(ctx.round_text_chunks)
                    _lowered_round = _joined_round.lower()
                    if any(
                        marker in _lowered_round
                        for marker in bridge._NATIVE_TEXT_STREAM_SUPPRESS_MARKERS
                    ):
                        ctx._round_text_stream_suppressed = True
                    else:
                        _safe_upto = max(
                            ctx._round_text_streamed,
                            len(_joined_round) - bridge._NATIVE_TEXT_STREAM_TAIL_MARGIN,
                        )
                        if _safe_upto > ctx._round_text_streamed:
                            yield (
                                "text",
                                _joined_round[ctx._round_text_streamed : _safe_upto],
                                None,
                            )
                            ctx._round_text_streamed = _safe_upto
            elif etype == "thinking_delta":
                ctx.accumulated_reasoning += event.delta
                yield ("reasoning", event.delta, None)
            elif etype == "tool_call_delta":
                yield (
                    "tool-call-delta",
                    {
                        "index": event.index,
                        "id": event.call_id,
                        "name": event.name,
                        "argumentsDelta": event.arguments_delta,
                    },
                    None,
                )
            elif etype == "tool_use":
                if event.tool_call is not None:
                    ctx.round_tool_calls.append(event.tool_call)
                    if ctx._round_text_streamed > 0 and (not ctx._round_commentary_emitted):
                        ctx._round_commentary_emitted = True
                        ctx._last_public_checkpoint_at = bridge.time.monotonic()
                    if not ctx._round_commentary_emitted:
                        checkpoint = bridge._native_public_checkpoint(
                            "".join(ctx.round_text_chunks)
                        )
                        if checkpoint:
                            yield ("commentary", checkpoint, None)
                            ctx._round_commentary_emitted = True
                            ctx._last_public_checkpoint_at = bridge.time.monotonic()
            elif etype == "done":
                fin = getattr(event, "final", None)
                if fin is not None:
                    response_model = str(getattr(fin, "model", "") or "").strip()
                    if response_model and response_model != ctx.effective_model:
                        ctx.effective_model = response_model
                        ctx._attempted_models.add(response_model)
                ctx._round_model_reservation_settled = True
                ctx._round_model_budget_exceeded = not ctx._settle_native_model_response(
                    ctx._round_model_reservation, fin
                )
                break
    except Exception as exc:
        _rescue_is_unavailable, _rescue_fallback = bridge._rescue_policy_names()
        if (
            not ctx._round_stream_event_seen
            and ctx._provider_failovers < 2
            and _rescue_is_unavailable(exc)
        ):
            fallback_model = _rescue_fallback(ctx.effective_model, ctx._attempted_models)
            if fallback_model:
                bridge._logger.warning(
                    "agentic provider unavailable for %s; retrying with %s",
                    ctx.effective_model,
                    fallback_model,
                )
                ctx.effective_model = fallback_model
                ctx._attempted_models.add(fallback_model)
                ctx._provider_failovers += 1
                return _NativeLoopDirective.NEXT
        if not isinstance(exc, (ConnectionError, TimeoutError, OSError)):
            ctx._finalize_native_trajectory(success=False, disposition="failed")
            raise
        bridge._logger.warning("agentic round %d stream failed: %s", ctx.round_i, exc)
        return _NativeLoopDirective.EXHAUSTED
    finally:
        if not ctx._round_model_reservation_settled:
            ctx._round_model_reservation_settled = True
            ctx._settle_native_model_response(ctx._round_model_reservation, None)
    return _NativeLoopDirective.PROCEED


def _guard_model_budget(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    if ctx._round_model_budget_exceeded:
        budget_attempts = ctx.round_tool_calls
        if not budget_attempts:
            budget_attempts = [
                bridge.ToolCall(
                    id=f"native-model-budget-{ctx.round_i}",
                    name="native_model_response",
                    input={"round": ctx.round_i + 1},
                )
            ]
        ctx._record_unexecuted_native_attempts(budget_attempts, failure_type="budget_exceeded")
        ctx._tool_error_count += len(budget_attempts)
        ctx._finalize_native_trajectory(success=False, disposition="failed")
        yield (
            "error",
            {
                "kind": "budget_exceeded",
                "message": "model response actual cost exceeded the native turn budget; returned tool calls were not executed",
            },
            None,
        )
        return _NativeLoopDirective.TERMINAL
    return _NativeLoopDirective.PROCEED


def _recover_model_round(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    ctx.round_text = "".join(ctx.round_text_chunks)
    if ctx._round_redirected and (not ctx.round_tool_calls):
        if ctx.round_text.strip():
            ctx.messages.append(bridge.Message(role="assistant", content=ctx.round_text))
        ctx._append_pending_steering()
        return _NativeLoopDirective.NEXT
    if ctx._round_timed_out and (not ctx.round_tool_calls):
        ctx._model_timeout_recoveries += 1
        if ctx._model_timeout_recoveries >= 2:
            stall_message = "模型连续两次未能在单轮时限内给出可用的下一步或最终答案。已经完成的工具结果仍保留在过程记录中，但这次无法可靠完成汇总；可以点击继续，从现有进度重新收敛。"
            ctx._finalize_native_trajectory(success=False, disposition="failed")
            yield ("error", {"kind": "model_stall", "message": stall_message}, None)
            return _NativeLoopDirective.TERMINAL
        partial_round_text = ctx.round_text.strip()
        if partial_round_text:
            ctx.messages.append(bridge.Message(role="assistant", content=partial_round_text))
        if ctx._completed_tool_count > 0 and ctx._stall_failovers < 1:
            _, _rescue_fallback = bridge._rescue_policy_names()
            fallback_model = _rescue_fallback(ctx.effective_model, ctx._attempted_models)
            if fallback_model:
                bridge._logger.warning(
                    "agentic model %s stayed silent after evidence; switching final synthesis to %s",
                    ctx.effective_model,
                    fallback_model,
                )
                ctx.effective_model = fallback_model
                ctx._attempted_models.add(fallback_model)
                ctx._stall_failovers += 1
                ctx._model_timeout_recoveries = 0
        recovery_update = "这一轮响应超过单轮时限；已保留前面的有效结果，现在会减少额外操作，直接收拢阶段结论或最终答案。"
        yield ("commentary_runtime", recovery_update, None)
        ctx.messages.append(
            bridge.Message(
                role="user",
                content="[SYSTEM CHECK - model round timeout]\nThe previous native-tool model stream exceeded its wall-clock deadline without a usable tool call or final answer. Preserve every completed tool result. Do not call more tools and do not deliberate at length. Return one complete final answer for the user, incorporating any partial assistant draft immediately above without assuming the user has seen it and without merely continuing mid-sentence. Use only the evidence already present; if evidence is insufficient, name the exact gap truthfully.",
            )
        )
        ctx._force_convergence_next = True
        return _NativeLoopDirective.NEXT
    if ctx.round_tool_calls:
        ctx._model_timeout_recoveries = 0
    if not ctx.round_tool_calls and (not ctx._round_convergence_mode):
        ctx.round_tool_calls = bridge._recover_named_xml_tool_calls(
            ctx.round_text, allowed_names={spec.name for spec in ctx._active_tool_specs}
        )
    return _NativeLoopDirective.PROCEED
