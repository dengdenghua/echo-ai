"""Bounded browser screen frames, sent only to an explicitly receiving device."""

from __future__ import annotations

import asyncio
import base64
import binascii
import secrets
import time
from typing import Any

from fastapi import HTTPException

from .mobile.screen_relay import FrameType, encode_frame_header


class CastSessions:
    def __init__(self) -> None:
        self.sessions: dict[str, dict[str, Any]] = {}

    async def invoke(
        self, coordinator: Any, device_id: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        now = time.monotonic()
        self.sessions = {
            key: value for key, value in self.sessions.items() if value["expires"] > now
        }
        operation = args.get("operation")
        session = self.sessions.get(device_id)
        server = coordinator.ws_server if coordinator else None
        socket = server._connections.get(device_id) if server else None
        subscribed = bool(server and "jpeg" in server.pc_screen_subscribers.get(device_id, ()))
        if operation == "status":
            return {"receiving": bool(socket and subscribed), "casting": bool(session)}
        if operation == "start":
            device = coordinator.pool.get(device_id) if coordinator else None
            if not device or not device.is_online or not socket or not subscribed:
                raise HTTPException(409, "请先在目标手机打开电脑远程桌面接收页，并更新手机应用")
            if session:
                raise HTTPException(409, "该设备正在接收投屏，请先停止原会话")
            session = {
                "id": secrets.token_urlsafe(24),
                "socket": socket,
                "expires": now + 15,
                "last": 0.0,
            }
            self.sessions[device_id] = session
            return {"sessionId": session["id"], "started": True}
        if not session or not secrets.compare_digest(str(args.get("sessionId", "")), session["id"]):
            raise HTTPException(409, "投屏会话已失效，请重新开始")
        if operation == "stop":
            self.sessions.pop(device_id, None)
            return {"stopped": True}
        if operation != "frame":
            raise HTTPException(422, "未知投屏操作")
        if socket is not session["socket"] or not subscribed:
            self.sessions.pop(device_id, None)
            raise HTTPException(409, "目标设备已停止接收")
        if now - session["last"] < 0.15:
            raise HTTPException(429, "投屏帧率过高")
        try:
            jpeg = base64.b64decode(args.get("jpeg", ""), validate=True)
            if (
                not 4 <= len(jpeg) <= 350_000
                or not jpeg.startswith(b"\xff\xd8")
                or not jpeg.endswith(b"\xff\xd9")
            ):
                raise ValueError("invalid jpeg")
        except (ValueError, TypeError, binascii.Error) as exc:
            raise HTTPException(422, "投屏画面无效或过大") from exc
        session["last"] = now
        try:
            await asyncio.wait_for(
                socket.send(encode_frame_header("pc-host", FrameType.JPEG, 1) + jpeg), timeout=3
            )
        except (TimeoutError, OSError, RuntimeError) as exc:
            self.sessions.pop(device_id, None)
            raise HTTPException(409, "目标设备未接收画面") from exc
        session["expires"] = time.monotonic() + 15
        return {"delivered": True}
