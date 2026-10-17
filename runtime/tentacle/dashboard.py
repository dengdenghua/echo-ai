"""Tentacle Dashboard —— 移动设备控制面板 REST API.

提供 Web Dashboard 所需的 HTTP 端点：
  GET  /api/tentacle/devices          — 列出已连接设备
  GET  /api/tentacle/devices/{id}     — 设备详情
  POST /api/tentacle/task             — 提交任务（自然语言）
  GET  /api/tentacle/stats            — 协调器统计
  GET  /api/tentacle/dashboard        — Dashboard HTML 页面
  POST /api/tentacle/devices/{id}/analyze — VLM 视觉分析设备屏幕
  GET  /api/tentacle/devices/{id}/screenshot — 获取设备最新截图
  POST /api/tentacle/screen/subscribe — 返回 WebSocket URL
  WS   /api/tentacle/screen/stream    — 屏幕流 WebSocket 端点
  GET  /api/tentacle/pc-screen/stream — PC屏幕流 WebSocket 端点
  POST /api/tentacle/pc-screen/start  — 启动PC屏幕捕获
  POST /api/tentacle/pc-screen/stop   — 停止PC屏幕捕获
  GET  /api/tentacle/pc-screen/stats  — PC屏幕捕获统计
  POST /api/tentacle/remote-input     — 远程输入事件（手机→PC）
  GET  /api/tentacle/mcp/sse          — MCP SSE 连接端点
  POST /api/tentacle/mcp/message      — MCP 消息接收端点
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, WebSocket
from fastapi import Request as FastAPIRequest
from fastapi.responses import HTMLResponse

from runtime.safety.auth import require_operator
from runtime.safety.auth.websocket_auth import WebSocketAuthConfig
from runtime.tentacle._dashboard_device_routes import (
    register_device_routes,
    register_fleet_routes,
)
from runtime.tentacle._dashboard_html import _DASHBOARD_HTML
from runtime.tentacle._dashboard_mcp_routes import register_mcp_routes
from runtime.tentacle._dashboard_procedure_routes import (
    register_procedure_routes,
    register_telemetry_routes,
)
from runtime.tentacle._dashboard_screen_routes import (
    register_pc_screen_routes,
    register_screen_routes,
    register_vlm_routes,
)
from runtime.tentacle.coordinator import TentacleCoordinator

logger = logging.getLogger(__name__)


def create_tentacle_router(
    coordinator: TentacleCoordinator,
    *,
    identity_store: Any = None,
    require_auth: bool = True,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> APIRouter:
    """创建 Tentacle Dashboard 路由.

    Args:
        coordinator: 已启动的 TentacleCoordinator 实例
    """
    router = APIRouter(prefix="/api/tentacle", tags=["tentacle"])

    # ``require_auth`` is the deployment boundary.  Missing credentials must
    # never silently turn an explicitly protected dashboard into an anonymous
    # one; local callers that want the historical unauthenticated dashboard
    # opt into it by leaving ``require_auth`` disabled.
    _enforce_auth = require_auth
    # Browser screen streams share the HTTP session/token check and Origin
    # policy (runtime.safety.auth.websocket_auth); refusals close with 1008.
    ws_auth = WebSocketAuthConfig(
        identity_store=identity_store,
        require_auth=_enforce_auth,
        jwt_secret=jwt_secret,
        jwt_issuer=jwt_issuer,
        jwt_audience=jwt_audience,
    )

    @router.websocket("/device/ws")
    async def device_socket(websocket: WebSocket) -> None:
        from .transport.asgi import serve_device_socket

        # Device credentials are verified by device/hello, not dashboard JWTs.
        await serve_device_socket(websocket, coordinator.ws_server)

    def _require_http_auth(request: FastAPIRequest) -> None:
        """FastAPI dependency: enforce operator auth on HTTP endpoints when enabled.

        Every endpoint behind this dependency controls or observes the host's
        devices (screen capture, remote input, task dispatch), so being logged
        in is not enough: open-signup accounts (OCT/social) are plain users.
        Only ``admin``/``operator`` principals may use the control plane.

        Credentials resolve exactly as on every other HTTP route
        (``resolve_principal``): the ``Authorization`` header or the HttpOnly
        session cookie, whose browser Origins ``LocalOriginGuardMiddleware``
        polices. A browser session restored from its cookie carries no
        header (the JWT is kept out of script-readable storage), so a
        header-only check here refused signed-in operators.
        """
        if not _enforce_auth:
            return
        principal = require_operator(
            request,
            identity_store,
            True,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
        if principal is not None:
            request.state.device_workspace_actor = principal.actor_id

    from .mirror_api import create_mirror_router

    router.include_router(
        create_mirror_router(lambda: coordinator), dependencies=[Depends(_require_http_auth)]
    )

    from .task_workspace_api import create_task_workspace_router

    router.include_router(
        create_task_workspace_router(lambda: coordinator),
        dependencies=[Depends(_require_http_auth)],
    )

    # Per-device credentials (invite / list / revoke / rotate) when the hub
    # has them installed — see runtime/tentacle/device_credentials.py.
    _device_credentials = getattr(
        getattr(coordinator, "ws_server", None), "device_credentials", None
    )
    if _device_credentials is not None:
        from .device_credentials import create_device_credentials_router, device_ws_url

        router.include_router(
            create_device_credentials_router(
                _device_credentials,
                ws_url_resolver=lambda _request: device_ws_url(coordinator.ws_server),
                dependencies=[Depends(_require_http_auth)],
            )
        )

    # 任务历史记录（内存，重启清空）
    _task_history: list[dict[str, Any]] = []

    # ── Dashboard HTML ──────────────────────────────────

    @router.get("/dashboard", response_class=HTMLResponse)
    async def dashboard():
        return HTMLResponse(_DASHBOARD_HTML)

    register_device_routes(router, coordinator, _require_http_auth, _task_history)
    register_procedure_routes(router, coordinator, _require_http_auth)
    register_telemetry_routes(router, coordinator, _require_http_auth)
    register_fleet_routes(router, coordinator, _require_http_auth, _task_history)
    register_vlm_routes(router, coordinator, _require_http_auth)
    register_screen_routes(router, coordinator, _require_http_auth, ws_auth)
    register_pc_screen_routes(router, coordinator, _require_http_auth, ws_auth)
    register_mcp_routes(
        router,
        coordinator,
        identity_store=identity_store,
        require_auth=require_auth,
        jwt_secret=jwt_secret,
        jwt_issuer=jwt_issuer,
        jwt_audience=jwt_audience,
    )

    return router
