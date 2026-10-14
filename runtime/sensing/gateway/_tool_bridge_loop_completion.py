"""Bounded final checkpoint when the native tool-round loop is exhausted."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from ._tool_bridge_loop_context import _NativeLoopContext, _NativeLoopDirective


def _finish_round_budget(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    checkpoint_chunks: list[str] = []
    ctx.messages.append(
        bridge.Message(
            role="user",
            content=f"[SYSTEM CHECK - user decision required]\nThe tool loop reached its {ctx.max_tool_rounds}-round limit. Do not call more tools. Do not write the final report yet. Using only the observations and tool results above, write a concise checkpoint for the user:\n1. What has been completed.\n2. The key findings or evidence collected so far.\n3. What remains uncertain or worth checking next.\n4. Ask the user to choose: reply `继续` to spend another work budget, or reply `生成报告` / `就此生成报告` to synthesize the final report from the current evidence.",
        )
    )
    checkpoint_req = bridge.ModelRequest(
        model=ctx.effective_model, messages=ctx.messages, max_tokens=4096, temperature=0.7, tools=[]
    )
    checkpoint_visible = {"started": False}
    try:
        ctx.checkpoint_model_reservation = ctx._reserve_native_model_budget(checkpoint_req)
    except bridge.InsufficientBudget as exc:
        ctx._finalize_native_trajectory(success=False, disposition="failed")
        yield ("error", {"kind": "budget_exceeded", "message": str(exc)}, None)
        return _NativeLoopDirective.TERMINAL
    checkpoint_model_reservation_settled = False
    try:
        for event in bridge._iter_native_model_stream_with_deadline(
            ctx.router,
            checkpoint_req,
            ctx._native_model_round_timeout_s(),
            visible_started=lambda state=checkpoint_visible: state["started"],
        ):
            if event is bridge._NATIVE_STREAM_DEADLINE:
                bridge._logger.warning(
                    "agentic checkpoint synthesis exceeded %.1fs",
                    ctx._native_model_round_timeout_s(),
                )
                break
            etype = event.type
            if etype == "text_delta":
                checkpoint_chunks.append(event.delta)
                checkpoint_visible["started"] = True
                yield ("text", event.delta, None)
            elif etype == "thinking_delta":
                ctx.accumulated_reasoning += event.delta
                yield ("reasoning", event.delta, None)
            elif etype == "done":
                fin = getattr(event, "final", None)
                checkpoint_model_reservation_settled = True
                ctx._settle_native_model_response(ctx.checkpoint_model_reservation, fin)
                if fin is not None and (not checkpoint_chunks):
                    checkpoint_text = getattr(fin, "text", "") or ""
                    if checkpoint_text:
                        checkpoint_chunks.append(checkpoint_text)
                        yield ("text", checkpoint_text, None)
                break
    except (ConnectionError, TimeoutError, OSError) as exc:
        bridge._logger.warning("agentic checkpoint synthesis failed: %s", exc)
    finally:
        if not checkpoint_model_reservation_settled:
            checkpoint_model_reservation_settled = True
            ctx._settle_native_model_response(ctx.checkpoint_model_reservation, None)
    if ctx._native_trajectory_budget.status != "active":
        ctx._finalize_native_trajectory(success=False, disposition="failed")
        yield (
            "error",
            {
                "kind": "budget_exceeded",
                "message": "checkpoint synthesis exhausted the native turn budget",
            },
            None,
        )
        return _NativeLoopDirective.TERMINAL
    checkpoint_text = "".join(checkpoint_chunks).strip()
    final_text = (
        checkpoint_text
        or "已达到本轮工具调用上限。回复 `继续` 我会继续搜索/执行；回复 `生成报告` 我会基于目前已收集的信息整理最终报告。"
    )
    _final_duration = int((bridge.time.monotonic() - ctx._started_at) * 1000)
    ctx._finalize_native_trajectory(success=False, disposition="blocked_on_user")
    yield (
        "stats",
        {
            "input_tokens": ctx._total_in_tokens,
            "output_tokens": ctx._total_out_tokens,
            "duration_ms": _final_duration,
            "rounds": ctx.max_tool_rounds,
        },
        None,
    )
    bridge._record_score_safe(
        agent=ctx.agent,
        intent=ctx.intent,
        has_final_reply=bool(checkpoint_text),
        tool_error_count=ctx._tool_error_count,
        rounds_used=ctx.max_tool_rounds,
        duration_ms=_final_duration,
    )
    yield ("done", "", final_text)
    return _NativeLoopDirective.PROCEED
