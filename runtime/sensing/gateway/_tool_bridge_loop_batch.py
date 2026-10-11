"""Execute native tool batches with original context and cancellation scope."""

from __future__ import annotations

from collections.abc import Generator
from functools import partial
from typing import Any

from runtime.sensing.model_router.models import ToolCall

from ._tool_bridge_loop_context import _NativeLoopContext, _NativeLoopDirective


def _execute_parallel_call(
    ctx: _NativeLoopContext, call: ToolCall, native_step_id: int, *, tool_batch_source: Any
) -> tuple[int, tuple[str, bool]]:
    from runtime.platform.process.session import _current_session, parent_tool_use_scope
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    _call_session_token = _current_session.set(ctx._session_obj)
    ctx._session_obj.metadata["_active_parent_tool_use_id"] = call.id
    try:
        with parent_tool_use_scope(call.id), ctx.scoped_cancellation(tool_batch_source.token):
            if tool_batch_source.is_cancelled:
                out, err = (f"(cancelled before execution: {tool_batch_source.token.reason})", True)
            else:
                out, err = bridge._execute_tool_call(
                    ctx.stack,
                    call,
                    task_id=ctx._native_trajectory_task_id,
                    step_id=native_step_id,
                    arm_id=ctx._native_trajectory_arm_id,
                    budget=ctx._native_trajectory_budget,
                )
    finally:
        _current_session.reset(_call_session_token)
    return (native_step_id, (out, err))


def _execute_serial_call(
    ctx: _NativeLoopContext, call: ToolCall, native_step_id: int, *, tool_batch_source: Any
) -> tuple[str, bool]:
    from runtime.platform.process.session import parent_tool_use_scope
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    _call_session_token = ctx._current_session.set(ctx._session_obj)
    ctx._session_obj.metadata["_active_parent_tool_use_id"] = call.id
    try:
        with parent_tool_use_scope(call.id), ctx.scoped_cancellation(tool_batch_source.token):
            if tool_batch_source.is_cancelled:
                return (f"(cancelled before execution: {tool_batch_source.token.reason})", True)
            return bridge._execute_tool_call(
                ctx.stack,
                call,
                task_id=ctx._native_trajectory_task_id,
                step_id=native_step_id,
                arm_id=ctx._native_trajectory_arm_id,
                budget=ctx._native_trajectory_budget,
            )
    finally:
        ctx._session_obj.metadata.pop("_active_parent_tool_use_id", None)
        ctx._current_session.reset(_call_session_token)


def _prepare_tool_batch(ctx: _NativeLoopContext) -> _NativeLoopDirective:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    if ctx._code_change_task:
        ctx._code_no_action_stops = 0
    assistant_blocks: list[dict[str, Any]] = []
    for call in ctx.round_tool_calls:
        assistant_blocks.append(
            {"type": "tool_use", "id": call.id, "name": call.name, "input": call.input}
        )
    if assistant_blocks:
        ctx.messages.append(bridge.Message(role="assistant", content=assistant_blocks))
    ctx.tool_result_blocks = []
    ctx._native_step_ids = [
        ctx._native_next_step_id + index for index in range(len(ctx.round_tool_calls))
    ]
    ctx._native_next_step_id += len(ctx.round_tool_calls)
    ctx._native_step_attempts.update(zip(ctx._native_step_ids, ctx.round_tool_calls, strict=True))
    ctx._parallel_enabled = (
        bridge.PARALLEL_TOOL_USE_DEFAULT
        and len(ctx.round_tool_calls) >= 2
        and (not any(c.name in bridge._SERIAL_BARRIER_TOOLS for c in ctx.round_tool_calls))
        and (not any(bridge._tool_uses_session_scope(ctx.stack, c) for c in ctx.round_tool_calls))
        and bool(getattr(ctx.stack, "metadata", {}).get("parallel_tool_use", True))
    )
    from runtime.safety.approval.cancellation import (
        CancellationSource,
        CancellationToken,
        current_cancellation_token,
        scoped_cancellation,
    )

    ctx.scoped_cancellation = scoped_cancellation
    _parent_cancellation = current_cancellation_token()
    ctx._tool_batch_source = (
        CancellationSource()
        if _parent_cancellation is CancellationToken.none()
        else _parent_cancellation.link()
    )
    ctx._tool_batch_redirected = ctx._round_redirected
    ctx._redirected_step_ids = set()
    if ctx._tool_batch_redirected:
        ctx._redirected_step_ids.update(ctx._native_step_ids)
        ctx._tool_batch_source.cancel(reason="user redirected before tool execution")
    return _NativeLoopDirective.PROCEED


def _execute_parallel_batch(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    ctx._session_obj.metadata.setdefault("_read_file_paths_this_turn", [])
    ctx._outputs = {}
    # The batch source is a callback default in the original loop: capture it
    # now, while all other shared cells remain live through ctx.
    _run_one = partial(_execute_parallel_call, ctx, tool_batch_source=ctx._tool_batch_source)
    if ctx._tool_batch_redirected:
        ctx._outputs.update(
            {
                native_step_id: ("(cancelled before execution: user redirected active work)", True)
                for native_step_id in ctx._native_step_ids
            }
        )
    else:
        with bridge.ThreadPoolExecutor(
            max_workers=min(bridge.PARALLEL_TOOL_USE_MAX_WORKERS, len(ctx.round_tool_calls)),
            thread_name_prefix="tool-bridge-parallel",
        ) as pool:
            future_calls = {
                pool.submit(
                    bridge.contextvars.copy_context().run, _run_one, call, native_step_id
                ): (call, native_step_id)
                for call, native_step_id in zip(
                    ctx.round_tool_calls, ctx._native_step_ids, strict=True
                )
            }
            pending = set(future_calls)
            while pending:
                done, pending = bridge.wait(
                    pending, timeout=0.1, return_when=bridge.FIRST_COMPLETED
                )
                for future in done:
                    call, native_step_id = future_calls[future]
                    try:
                        completed_step_id, (out, err) = future.result()
                    except Exception as exc:
                        completed_step_id, out, err = (
                            native_step_id,
                            f"(parallel exec error: {exc})",
                            True,
                        )
                        bridge._logger.warning("parallel tool exec future failed: %s", exc)
                    ctx._outputs[completed_step_id] = (out, err)
                if pending and ctx._capture_steering():
                    ctx._tool_batch_redirected = True
                    ctx._redirected_step_ids.update(future_calls[future][1] for future in pending)
                    ctx._tool_batch_source.cancel(reason="user redirected active tool batch")
                checkpoint = ctx._take_action_narration()
                if checkpoint:
                    yield ("commentary", checkpoint, None)
    checkpoint = ctx._take_action_narration(wait_for_completion=True)
    if checkpoint:
        yield ("commentary", checkpoint, None)
    ctx._session_obj.metadata.pop("_active_parent_tool_use_id", None)
    return _NativeLoopDirective.PROCEED


def _observe_parallel_batch(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    for call, native_step_id in zip(ctx.round_tool_calls, ctx._native_step_ids, strict=True):
        if call.name == "todo_write":
            ctx._todo_seen = True
            _tool_work_since_todo = False
        else:
            _tool_work_since_todo = True
        output, is_error = ctx._outputs.get(native_step_id, ("(no result)", True))
        _redirected_cancelled = native_step_id in ctx._redirected_step_ids
        _externally_cancelled = bool(
            is_error and ctx._tool_batch_source.is_cancelled and (not _redirected_cancelled)
        )
        _cancelled = _redirected_cancelled or _externally_cancelled
        if _cancelled:
            is_error = True
        if _externally_cancelled:
            ctx._external_cancellation_seen = True
        if is_error:
            ctx._native_step_failures[native_step_id] = (
                "cancelled" if _cancelled else bridge._native_tool_failure_type(output)
            )
        ctx._observe_code_tool_result(call, is_error, output, ctx.round_i + 1)
        if not is_error:
            ctx._browser_observed_evidence.update(bridge._browser_action_evidence(call))
        yield (
            "tool_end",
            {
                "id": call.id,
                "name": call.name,
                "output": output[:200],
                "is_error": is_error,
                **({"status": "cancelled"} if _cancelled else {}),
                "iteration": ctx.round_i + 1,
                "parallel": True,
            },
            None,
        )
        block: dict[str, Any] = {"type": "tool_result", "tool_use_id": call.id, "content": output}
        if is_error:
            block["is_error"] = True
            ctx._tool_error_count += 1
        ctx.tool_result_blocks.append(block)
    return _NativeLoopDirective.PROCEED


def _execute_serial_batch(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    # Capture the current batch source before a later round can replace it.
    _run_serial_one = partial(_execute_serial_call, ctx, tool_batch_source=ctx._tool_batch_source)
    serial_pool = (
        bridge.ThreadPoolExecutor(max_workers=1, thread_name_prefix="tool-bridge-steerable")
        if (ctx.steering_drain is not None or ctx._action_narration_future is not None)
        and (not ctx._tool_batch_redirected)
        else None
    )
    try:
        for call_index, (call, native_step_id) in enumerate(
            zip(ctx.round_tool_calls, ctx._native_step_ids, strict=True)
        ):
            if call.name == "todo_write":
                ctx._todo_seen = True
                _tool_work_since_todo = False
            else:
                _tool_work_since_todo = True
            if ctx._tool_batch_redirected:
                output, is_error = (
                    "(cancelled before execution: user redirected active work)",
                    True,
                )
            elif serial_pool is None:
                output, is_error = _run_serial_one(call, native_step_id)
            else:
                future = serial_pool.submit(
                    bridge.contextvars.copy_context().run, _run_serial_one, call, native_step_id
                )
                while not future.done():
                    bridge.wait((future,), timeout=0.1)
                    checkpoint = ctx._take_action_narration()
                    if checkpoint:
                        yield ("commentary", checkpoint, None)
                    if not future.done() and ctx._capture_steering():
                        ctx._tool_batch_redirected = True
                        ctx._redirected_step_ids.update(ctx._native_step_ids[call_index:])
                        ctx._tool_batch_source.cancel(reason="user redirected active tool batch")
                try:
                    output, is_error = future.result()
                except Exception as exc:
                    output, is_error = (f"(serial exec error: {exc})", True)
                    bridge._logger.warning("serial tool exec future failed: %s", exc)
            checkpoint = ctx._take_action_narration(wait_for_completion=True)
            if checkpoint:
                yield ("commentary", checkpoint, None)
            _redirected_cancelled = native_step_id in ctx._redirected_step_ids
            _externally_cancelled = bool(
                is_error and ctx._tool_batch_source.is_cancelled and (not _redirected_cancelled)
            )
            _cancelled = _redirected_cancelled or _externally_cancelled
            if _cancelled:
                is_error = True
            if _externally_cancelled:
                ctx._external_cancellation_seen = True
            if is_error:
                ctx._native_step_failures[native_step_id] = (
                    "cancelled" if _cancelled else bridge._native_tool_failure_type(output)
                )
            ctx._observe_code_tool_result(call, is_error, output, ctx.round_i + 1)
            if not is_error:
                ctx._browser_observed_evidence.update(bridge._browser_action_evidence(call))
            yield (
                "tool_end",
                {
                    "id": call.id,
                    "name": call.name,
                    "output": output[:200],
                    "is_error": is_error,
                    **({"status": "cancelled"} if _cancelled else {}),
                    "iteration": ctx.round_i + 1,
                },
                None,
            )
            block: dict[str, Any] = {
                "type": "tool_result",
                "tool_use_id": call.id,
                "content": output,
            }
            if is_error:
                block["is_error"] = True
                ctx._tool_error_count += 1
            ctx.tool_result_blocks.append(block)
    finally:
        if serial_pool is not None:
            serial_pool.shutdown(wait=True, cancel_futures=True)
    return _NativeLoopDirective.PROCEED
