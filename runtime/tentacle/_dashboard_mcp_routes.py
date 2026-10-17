"""MCP SSE transport routes for the Tentacle dashboard."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException
from fastapi import Request as FastAPIRequest
from fastapi.responses import StreamingResponse

from runtime.safety.auth import require_operator

if TYPE_CHECKING:
    from runtime.tentacle.coordinator import TentacleCoordinator


def register_mcp_routes(
    router: APIRouter,
    coordinator: TentacleCoordinator,
    *,
    identity_store: Any,
    require_auth: bool,
    jwt_secret: str | None,
    jwt_issuer: str | None,
    jwt_audience: str | None,
) -> None:
    """Register the account-bound MCP SSE and message routes."""
    # ── MCP SSE Transport ────────────────────────────────────

    # SSE 会话管理器（延迟初始化）
    _mcp_session_manager: Any | None = None

    def _get_mcp_session_manager() -> Any:
        """获取或创建 MCP SSE 会话管理器."""
        nonlocal _mcp_session_manager
        if _mcp_session_manager is None:
            from runtime.tentacle.mobile.mcp_server import SseSessionManager, TentacleMcpServer

            mcp_server = TentacleMcpServer(coordinator=coordinator)
            _mcp_session_manager = SseSessionManager(mcp_server)
        return _mcp_session_manager

    @router.get("/mcp/sse")
    async def mcp_sse(request: FastAPIRequest) -> StreamingResponse:
        """MCP SSE 连接端点.

        客户端连接此端点获取 SSE 事件流，服务端首先发送 endpoint 事件
        告知客户端消息发送 URL，然后持续推送 JSON-RPC 响应。

        账号登录鉴权：网关开启 ``require_auth`` 时，Claude Desktop /
        Cursor 等 MCP 客户端必须携带账号登录后的 Bearer Token
        （``Authorization`` 请求头或 ``?token=`` 查询参数）。会话会
        绑定到该账号，后续 ``/mcp/message`` 也要求同一账号凭证。
        """
        principal = require_operator(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
        actor_id = principal.actor_id if principal is not None else None

        manager = _get_mcp_session_manager()
        session = manager.create_session(actor_id=actor_id)

        # 构建 message endpoint URL
        scheme = "https" if request.url.scheme == "https" else "http"
        host = request.headers.get("host", f"localhost:{coordinator._dashboard_port}")
        message_url = f"{scheme}://{host}/api/tentacle/mcp/message?session_id={session.session_id}"

        async def _sse_generator():
            """SSE 事件流生成器."""
            try:
                # 首先发送 endpoint 事件
                yield f"event: endpoint\ndata: {message_url}\n\n"
                # 然后持续推送 JSON-RPC 响应
                async for chunk in session.event_stream():
                    yield chunk
            finally:
                # 客户端断开（含异常退出）时清理会话，避免泄漏
                manager.remove_session(session.session_id)

        return StreamingResponse(
            _sse_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post("/mcp/message")
    async def mcp_message(request: FastAPIRequest) -> dict[str, Any]:
        """MCP 消息接收端点.

        客户端通过此端点发送 JSON-RPC 请求，服务端处理后通过 SSE 推送响应。
        与 ``/mcp/sse`` 一致要求账号凭证；若会话已绑定账号，则必须由
        同一账号携带相同凭证调用。
        """
        session_id = request.query_params.get("session_id", "")
        if not session_id:
            raise HTTPException(400, "Missing session_id parameter")

        principal = require_operator(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
        actor_id = principal.actor_id if principal is not None else None

        manager = _get_mcp_session_manager()
        session = manager.get_session(session_id)
        if session is None:
            raise HTTPException(404, f"Session not found: {session_id}")
        if session.actor_id is not None and session.actor_id != actor_id:
            raise HTTPException(403, "Session belongs to a different account")

        try:
            body = await request.json()
        except json.JSONDecodeError as e:
            raise HTTPException(400, f"Invalid JSON: {e}") from e

        # 异步处理请求并通过 SSE 推送响应
        asyncio.create_task(session.handle_message(body))

        return {"status": "ok"}


__all__ = ["register_mcp_routes"]
