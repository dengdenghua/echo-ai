"""Collect and deliver live steering at cooperative native-loop boundaries."""

from __future__ import annotations

from ._tool_bridge_loop_context import _NativeLoopContext


def _capture_steering(ctx: _NativeLoopContext, *, force: bool = False) -> bool:
    """Collect live user input without exposing it to two rounds.

    Native provider streams and tools are synchronous from this
    generator's point of view. Polling here gives them a cooperative
    redirect boundary while the durable queue remains the single source
    of delivery and idempotency.
    """
    from runtime.sensing.gateway import _tool_bridge_loop as bridge

    if ctx.steering_drain is None:
        return False
    now = bridge.time.monotonic()
    if not force and now - ctx._last_steering_probe_at < 0.1:
        return False
    ctx._last_steering_probe_at = now
    try:
        captured = [str(text).strip() for text in ctx.steering_drain()]
    except Exception:
        bridge._logger.warning("live steering poll failed", exc_info=True)
        return False
    captured = [text for text in captured if text]
    if not captured:
        return False
    ctx._pending_steering.extend(captured)
    return True


def _append_pending_steering(ctx: _NativeLoopContext) -> None:
    if not ctx._pending_steering:
        return
    from runtime.core.cerebrum.live_steering import append_live_steering_messages

    append_live_steering_messages(ctx.messages, ctx._pending_steering)
    ctx._pending_steering.clear()
