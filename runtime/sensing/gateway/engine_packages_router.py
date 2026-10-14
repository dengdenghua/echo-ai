"""Execution engines in the store: list, install, uninstall.

``GET /api/engines`` reports each pinned engine (Codex, OpenCode) for this
computer; ``POST /api/engines/{id}/install`` starts a background download and
the same list reports its progress; ``DELETE /api/engines/{id}`` removes a
store-installed engine. Installing puts a native program on the machine for
every account, so both changes need the admin role (a no-op when sign-in is
off, as on a single-user desktop).
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from runtime.execution.engine_packages import ENGINES, EngineInstallError, engine_installer
from runtime.execution.engine_packages.status import engine_status, engine_statuses

ENGINE_ADMIN_REQUIRED = "只有管理员可以安装或卸载执行引擎，请联系本机管理员。"
_REFUSALS = {
    "busy": (409, "引擎正在运行或正在安装：先结束正在使用它的任务，再试一次。"),
    "unknown_engine": (404, "没有这个执行引擎。"),
    "unsupported_platform": (400, "这台电脑的系统暂时不能安装这个引擎。"),
}


class EngineInstallJob(BaseModel):
    engine: str
    version: str
    state: Literal["downloading", "installing", "done", "failed"]
    received: int
    total: int
    source: Literal["mirror", "upstream"] | None = None
    error: str | None = None
    finished_at: float | None = None


class EngineStatus(BaseModel):
    id: str
    name: str
    version: str
    license: str
    homepage: str
    supported: bool
    download_size: int | None = None
    state: Literal["ready", "installing", "update_available", "not_installed"]
    source: Literal["bundled", "installed", "configured", "system"] | None = None
    installed_version: str | None = None
    installed_size: int | None = None
    update_available: bool
    can_uninstall: bool
    job: EngineInstallJob | None = None


class EngineListResponse(BaseModel):
    engines: list[EngineStatus]


def create_engine_packages_router(
    *,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
    installer: Any = None,
) -> APIRouter:
    router = APIRouter(tags=["engines"])

    def _auth(request: Request) -> None:
        from runtime.sensing.gateway.openai_gateway_router import _resolve_actor

        if require_auth and identity_store is None:
            raise HTTPException(401, "auth required")
        _resolve_actor(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )  # AUTH-OK: actor-agnostic; machine-wide engines, changes need admin below

    def _require_admin(request: Request) -> None:
        from runtime.safety.auth.principal import require_roles

        try:
            require_roles(
                request,
                identity_store,
                require_auth,
                ("admin",),
                jwt_secret=jwt_secret,
                jwt_issuer=jwt_issuer,
                jwt_audience=jwt_audience,
            )
        except HTTPException as exc:
            if exc.status_code != 403:
                raise
            raise HTTPException(403, ENGINE_ADMIN_REQUIRED) from exc

    def _installer() -> Any:
        return installer or engine_installer()

    def _known(engine_id: str) -> str:
        if engine_id not in ENGINES:
            raise HTTPException(404, _REFUSALS["unknown_engine"][1])
        return engine_id

    def _refuse(exc: EngineInstallError) -> HTTPException:
        status, message = _REFUSALS.get(exc.code, (400, "现在无法完成这个操作，请稍后再试。"))
        return HTTPException(status, message)

    @router.get("/api/engines", response_model=EngineListResponse)
    async def list_engines(request: Request) -> EngineListResponse:
        _auth(request)  # AUTH-OK: actor-agnostic — machine-wide engine list
        engines = await asyncio.to_thread(engine_statuses, _installer())
        return EngineListResponse(engines=[EngineStatus(**item) for item in engines])

    @router.post("/api/engines/{engine_id}/install", response_model=EngineStatus)
    async def install_engine(engine_id: str, request: Request) -> EngineStatus:
        _auth(request)  # AUTH-OK: actor-agnostic — admin role checked next
        _require_admin(request)
        _known(engine_id)
        try:
            _installer().start(engine_id)
        except EngineInstallError as exc:
            raise _refuse(exc) from exc
        return EngineStatus(**await asyncio.to_thread(engine_status, engine_id, _installer()))

    @router.delete("/api/engines/{engine_id}", response_model=EngineStatus)
    async def uninstall_engine(engine_id: str, request: Request) -> EngineStatus:
        _auth(request)  # AUTH-OK: actor-agnostic — admin role checked next
        _require_admin(request)
        _known(engine_id)
        try:
            await asyncio.to_thread(_installer().uninstall, engine_id)
        except EngineInstallError as exc:
            raise _refuse(exc) from exc
        return EngineStatus(**await asyncio.to_thread(engine_status, engine_id, _installer()))

    return router


def mount_engine_packages_router(ctx: Any) -> None:
    """Mount the endpoints on the app being assembled by ``create_app``."""

    ctx.app.include_router(
        create_engine_packages_router(
            identity_store=ctx.identity_store,
            require_auth=ctx.require_auth,
            jwt_secret=ctx.jwt_secret,
            jwt_issuer=ctx.jwt_issuer,
            jwt_audience=ctx.jwt_audience,
        )
    )


__all__ = [
    "EngineListResponse",
    "EngineStatus",
    "create_engine_packages_router",
    "mount_engine_packages_router",
]
