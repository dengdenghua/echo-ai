"""Authenticated phone mirror/file bridge over the existing device socket."""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from .base import ToolCall

TOOLS = {
    "frame": "android.mirror_frame",
    "control": "android.mirror_control",
    "files": "android.exchange_files",
}


def create_mirror_router(coordinator_provider: Callable[[], Any]) -> APIRouter:
    # Authentication is supplied by the owning appliance/dashboard router.
    router = APIRouter()
    active: dict[str, int] = {}

    @router.post("/devices/{device_id}/mirror/{operation}")
    async def invoke(device_id: str, operation: str, request: Request) -> dict[str, Any]:
        if operation not in TOOLS and operation not in {"cast", "transfers"}:
            raise HTTPException(404, "Unknown phone operation")
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > (480_000 if operation == "cast" else 24_000):
                raise HTTPException(413, "Phone request exceeds chunk limit")
        try:
            args = json.loads(data or b"{}")
            if not isinstance(args, dict):
                raise ValueError("Expected an object")
        except (ValueError, UnicodeDecodeError) as exc:
            raise HTTPException(422, "Invalid phone request") from exc
        coordinator = coordinator_provider()
        if operation == "cast":
            from .cast_session import CastSessions

            if coordinator is None:
                raise HTTPException(409, "设备服务未连接")
            if not hasattr(coordinator, "_cast_sessions"):
                coordinator._cast_sessions = CastSessions()
            return await coordinator._cast_sessions.invoke(coordinator, device_id, args)
        from .transfer_journal import TransferJournal

        if coordinator is not None and not hasattr(coordinator, "_transfer_journal"):
            coordinator._transfer_journal = TransferJournal()
        journal = coordinator._transfer_journal if coordinator else None
        transfer_id = args.pop("_transferId", "")
        if not isinstance(transfer_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,80}", transfer_id):
            transfer_id = ""
        if operation == "transfers":
            if args.get("operation") == "report":
                return {
                    "recorded": bool(
                        journal and journal.report(device_id, transfer_id, args.get("state", ""))
                    )
                }
            return {"jobs": journal.snapshot() if journal else []}
        device = coordinator.pool.get(device_id) if coordinator else None
        if device is None or not device.is_online:
            raise HTTPException(409, "设备已离线，请重新连接")
        tool = TOOLS[operation]
        if getattr(device, "platform", "") != "android" or tool not in device.meta.get(
            "reported_capabilities", []
        ):
            raise HTTPException(409, "设备未启用此能力，请更新手机应用并检查工具权限后重连")
        if active.get(device_id, 0) >= 4:
            raise HTTPException(429, "设备请求过多，请稍后重试")
        active[device_id] = active.get(device_id, 0) + 1
        try:

            async def execute():
                return await asyncio.wait_for(
                    coordinator.ws_server.send_tool_execute(
                        device_id,
                        ToolCall(
                            call_id=f"mirror-{uuid.uuid4().hex}",
                            tentacle_id=device_id,
                            tool=tool,
                            args=args,
                        ),
                        timeout_ms=15_000,
                    ),
                    timeout=16,
                )

            if operation == "frame":
                from .mirror_frames import MirrorFrames

                if not hasattr(coordinator, "_mirror_frames"):
                    coordinator._mirror_frames = MirrorFrames()
                socket = getattr(coordinator.ws_server, "_connections", {}).get(device_id)
                result = await coordinator._mirror_frames.capture(device_id, socket, args, execute)
            else:
                result = await execute()
            if not result.success:
                raise HTTPException(409, result.error_message or "手机未完成操作")
            payload = json.loads(result.data) if isinstance(result.data, str) else result.data
            if not isinstance(payload, dict):
                raise ValueError("Unexpected phone response")
            # Dry-run, truncated or textual success must never appear as a real frame/transfer.
            required = {"frame": "jpeg", "control": "applied"}.get(operation)
            if required and required not in payload:
                raise ValueError("Phone response contains no result")
            if operation == "files" and transfer_id and journal:
                journal.observe(device_id, transfer_id, args, payload)
            return payload
        except TimeoutError as exc:
            raise HTTPException(504, "等待手机响应超时") from exc
        except (ValueError, TypeError) as exc:
            raise HTTPException(502, "手机返回的数据不完整") from exc
        finally:
            active[device_id] -= 1
            if not active[device_id]:
                active.pop(device_id, None)

    return router
