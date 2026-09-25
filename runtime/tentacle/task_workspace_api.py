"""HTTP adapter; authentication is inherited from the owning router."""

import json
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from .task_workspace import get_task_workspace


def create_task_workspace_router(provider: Callable[[], Any]) -> APIRouter:
    router = APIRouter()

    @router.post("/task-workspace/{command}")
    async def invoke(command: str, request: Request) -> dict[str, Any]:
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 16000:
                raise HTTPException(413, "任务请求过大")
        coordinator = provider()
        if coordinator is None:
            raise HTTPException(409, "设备服务未连接")
        try:
            args = json.loads(raw or b"{}")
            if not isinstance(args, dict):
                raise ValueError("任务请求应为对象")
            actor = getattr(request.state, "appliance_actor", None) or getattr(
                request.state, "device_workspace_actor", "authenticated-operator"
            )
            return await get_task_workspace(coordinator).dispatch(command, args, actor=actor)
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except (ValueError, TypeError) as exc:
            raise HTTPException(409, str(exc)) from exc

    return router
