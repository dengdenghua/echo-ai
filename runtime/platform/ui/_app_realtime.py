"""Explicit shared collaboration transport and its application lifecycle."""

from __future__ import annotations

import asyncio

from runtime.memory.cowork.transient_presence import TransientPresence
from runtime.platform.config.schema import CollaborationRealtimeConfig
from runtime.platform.process.shared_pubsub import RedisPubSub

from ._app_context import AppContext


def configure_collaboration_realtime(ctx: AppContext) -> None:
    config = getattr(getattr(ctx.stack, "config", None), "collaboration_realtime", None)
    settings = config or CollaborationRealtimeConfig()
    bus = None
    if settings.backend == "redis":
        assert settings.redis_url is not None and settings.namespace is not None
        bus = RedisPubSub(
            settings.redis_url, settings.namespace, timeout=settings.connect_timeout_seconds
        )

        async def start() -> None:
            try:
                await asyncio.to_thread(bus.start)
            except BaseException:
                await asyncio.to_thread(bus.close)
                raise

        async def stop() -> None:
            await asyncio.to_thread(bus.close)

        ctx.app.router.add_event_handler("startup", start)
        ctx.app.router.add_event_handler("shutdown", stop)
    ctx.shared_realtime = bus
    ctx.live_presence = TransientPresence(bus)
    ctx.app.state.collaboration_realtime = bus
    ctx.app.state.live_presence = ctx.live_presence
