"""Local CodeBuddy account helpers; the official CLI owns credentials."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, Request

from runtime.execution.codebuddy_account import launch_login, login_launch_supported
from runtime.execution.codebuddy_backend import inspect_readiness, model_catalog, control_capabilities
from runtime.execution.codebuddy_events import CodeBuddyError
from runtime.execution.engine_observations import engine_observations
from runtime.safety.auth.scope import scope_from_request

if TYPE_CHECKING:
    from ._config_endpoints import _ConfigCtx


def _register_codebuddy(router: Any, ctx: _ConfigCtx) -> None:
    @router.get("/api/config/codebuddy/status", tags=["config"])
    async def codebuddy_status(request: Request) -> dict[str, Any]:
        scope = scope_from_request(request)
        ready = await asyncio.to_thread(inspect_readiness, scope)
        return {
            **ready,
            **engine_observations(scope, "codebuddy"),
            "login_launch_supported": ready["available"] and login_launch_supported(),
        }

    @router.get("/api/config/codebuddy/models", tags=["config"])
    async def codebuddy_models(request: Request) -> dict[str, Any]:
        scope_from_request(request)
        from runtime.execution.codebuddy_model_capabilities import model_capabilities
        models = await asyncio.to_thread(model_catalog)
        return {"models": models, "controls": await asyncio.to_thread(control_capabilities),
                "model_capabilities": await asyncio.to_thread(model_capabilities, models)}

    @router.post("/api/config/codebuddy/login", tags=["config"])
    async def codebuddy_login(request: Request) -> dict[str, object]:
        ctx.require_admin(request)  # The official CLI account is machine-wide.
        try:
            return await asyncio.to_thread(launch_login)
        except CodeBuddyError as exc:
            raise HTTPException(409, str(exc)) from None
