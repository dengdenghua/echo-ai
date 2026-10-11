"""Admin-only lifecycle actions for configured channel transports."""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ._channels_models import _guess_platform, _normalize_channel_id


class ChannelRestartResponse(BaseModel):
    message: str
    restarted: list[str]


def create_channels_lifecycle_router(manager: Any, require_admin: Callable) -> APIRouter:
    router = APIRouter(tags=["channels"])
    lock = threading.Lock()

    @router.post("/api/channels/{channel_id}/restart", response_model=ChannelRestartResponse)
    def restart_channel(channel_id: str, request: Request) -> ChannelRestartResponse:
        require_admin(request)
        safe_id = _normalize_channel_id(channel_id)
        if safe_id is None:
            raise HTTPException(400, "invalid channel_id")
        with lock:
            ids = (
                [safe_id]
                if manager.has(safe_id)
                else [
                    cid
                    for cid in manager.channel_ids()
                    if _guess_platform(cid, type(manager.get(cid)).__name__) == safe_id
                ]
            )
            if not ids:
                raise HTTPException(404, "no configured transport for this channel")
            restarted = []
            for cid in ids:
                channel = manager.get(cid)
                try:
                    channel.stop()
                    channel.start()
                except Exception as exc:
                    raise HTTPException(
                        503, f"channel restart failed: {type(exc).__name__}"
                    ) from exc
                restarted.append(cid)
        return ChannelRestartResponse(message="Channel restarted", restarted=restarted)

    return router
