"""Android device HTTP API — server-side counterpart to Echo Mobile.

Mirrors the design of computer_router.py (observe → preview → execute)
but for Android devices connected via WebSocket.

Endpoints:
    GET  /api/android/devices              — list online devices
    GET  /api/android/devices/{id}/status   — device status + heartbeat
    POST /api/android/devices/{id}/call     — execute a tool call on device
    POST /api/android/devices/{id}/preview  — preview a tool call (dry run)
    POST /api/android/devices/{id}/execute  — execute with preview token
    WS   /api/android/ws/{id}              — WebSocket for device ↔ server
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect

from runtime.safety.approval.device_lock import get_device_lock_manager
from runtime.safety.auth.websocket_auth import (
    OPERATOR_ROLES,
    WebSocketAuthConfig,
    authenticate_websocket,
)
from runtime.sensing.model_router.devices import (
    AndroidDevice,
    get_device_pool,
)

_VALID_ANDROID_ACTIONS = {
    "tap",
    "long_press",
    "swipe",
    "input_text",
    "system_key",
    "open_app",
    "get_screen_info",
    "take_screenshot",
    "find_node",
    "find_text",
    "scroll_to_find",
    "find_and_tap",
    "get_current_app",
    "get_installed_apps",
    "install_app",
    "wait",
    "finish",
    "browser_navigate",
    "browser_get_dom",
    "browser_click",
    "browser_type",
    "browser_screenshot",
    "browser_evaluate",
    "browser_install_extension",
}

_PENDING_TTL_SECONDS = 90


def create_android_router(
    *,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> APIRouter:
    def _operator_http(request: Request = None) -> None:  # type: ignore[assignment]
        # Router-level dependencies are also evaluated for WebSocket routes;
        # the WebSocket handshake is authenticated explicitly below because
        # it has no HTTP Request object.
        if request is None:
            return
        from runtime.safety.auth.principal import require_operator

        require_operator(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )

    router = APIRouter(
        prefix="/api/android",
        tags=["android"],
        dependencies=[Depends(_operator_http)] if require_auth else [],
    )
    pool = get_device_pool()
    lock_mgr = get_device_lock_manager()
    pending_previews: dict[str, dict[str, Any]] = {}

    # The device WebSocket carries the operator's session/API key (header or
    # ``bearer.b64`` subprotocol). The HTTP auth middleware never sees WS
    # scope, so the handshake goes through the shared gate: Origin, the HTTP
    # token check, and the operator role — refusals close 1008 before accept.
    ws_auth = WebSocketAuthConfig(
        identity_store=identity_store,
        require_auth=require_auth,
        jwt_secret=jwt_secret,
        jwt_issuer=jwt_issuer,
        jwt_audience=jwt_audience,
    )

    # ── List devices ───────────────────────────────────

    @router.get("/devices")
    async def list_devices() -> list[dict[str, Any]]:
        devices = pool.list_all()
        return [
            {
                "device_id": d.device_id,
                "model": getattr(d, "model", ""),
                "android_version": getattr(d, "android_version", ""),
                "state": d.state.value,
                "last_heartbeat_ago": round(d.stale_seconds(), 1),
                "pending_calls": len(d.pending_calls),
            }
            for d in devices
        ]

    # ── Device status ──────────────────────────────────

    @router.get("/devices/{device_id}/status")
    async def device_status(device_id: str) -> dict[str, Any]:
        dev = pool.get(device_id)
        if dev is None:
            raise HTTPException(404, f"Device {device_id} not found")
        return {
            "device_id": dev.device_id,
            "model": getattr(dev, "model", ""),
            "android_version": getattr(dev, "android_version", ""),
            "state": dev.state.value,
            "last_heartbeat_ago": round(dev.stale_seconds(), 1),
            "pending_calls": len(dev.pending_calls),
            "locked_by": lock_mgr.current_holder(device_id),
        }

    # ── Direct tool call ───────────────────────────────

    @router.post("/devices/{device_id}/call")
    async def call_tool(device_id: str, body: dict[str, Any]) -> dict[str, Any]:
        action = body.get("action", "")
        if action not in _VALID_ANDROID_ACTIONS:
            raise HTTPException(400, f"Unsupported action: {action}")

        dev = pool.get(device_id)
        if dev is None or not dev.is_online:
            raise HTTPException(404, f"Device {device_id} not online")

        method = f"android.{action}"
        params = body.get("params", {})

        try:
            result = await pool.call_tool(device_id, method, params, timeout_s=30.0)
            return {"ok": True, "result": result}
        except TimeoutError as e:
            raise HTTPException(504, str(e)) from e
        except ConnectionError as e:
            raise HTTPException(503, str(e)) from e
        except Exception as e:
            raise HTTPException(500, str(e)) from e

    # ── Preview → Execute (mirrors computer_router.py) ─

    @router.post("/devices/{device_id}/preview")
    async def preview_action(device_id: str, body: dict[str, Any]) -> dict[str, Any]:
        action = body.get("action", "")
        if action not in _VALID_ANDROID_ACTIONS:
            raise HTTPException(400, f"Unsupported action: {action}")

        dev = pool.get(device_id)
        if dev is None or not dev.is_online:
            raise HTTPException(404, f"Device {device_id} not online")

        # Create preview token
        token = uuid.uuid4().hex[:16]
        pending_previews[token] = {
            "device_id": device_id,
            "action": action,
            "params": body.get("params", {}),
            "created_at": time.time(),
        }

        # Cleanup old tokens
        now = time.time()
        expired = [
            t for t, v in pending_previews.items() if now - v["created_at"] > _PENDING_TTL_SECONDS
        ]
        for t in expired:
            pending_previews.pop(t, None)

        return {"preview_token": token, "action": action, "device_id": device_id}

    @router.post("/devices/{device_id}/execute")
    async def execute_action(device_id: str, body: dict[str, Any]) -> dict[str, Any]:
        token = body.get("preview_token", "")
        preview = pending_previews.pop(token, None)
        if preview is None:
            raise HTTPException(400, "Invalid or expired preview token")
        if preview["device_id"] != device_id:
            raise HTTPException(400, "Preview token does not match device")

        method = f"android.{preview['action']}"
        params = preview["params"]

        try:
            result = await pool.call_tool(device_id, method, params, timeout_s=30.0)
            return {"ok": True, "result": result}
        except TimeoutError as e:
            raise HTTPException(504, str(e)) from e
        except Exception as e:
            raise HTTPException(500, str(e)) from e

    # ── WebSocket (device ↔ server) ────────────────────

    @router.websocket("/ws/{device_id}")
    async def device_websocket(ws: WebSocket, device_id: str) -> None:
        auth = await authenticate_websocket(ws, config=ws_auth, roles=OPERATOR_ROLES)
        if auth is None:
            return
        await ws.accept(subprotocol=auth.subprotocol)

        # Register device
        dev = AndroidDevice(device_id=device_id, ws=ws)

        # Read hello message for metadata
        try:
            hello = await asyncio.wait_for(ws.receive_json(), timeout=10.0)
            dev.model = hello.get("model", "")
            dev.android_version = hello.get("android_version", "")
            dev.sdk_version = hello.get("sdk_version", 0)
            dev.capabilities = hello.get("capabilities", [])
            dev.label = hello.get("label", "")
        except Exception:  # noqa: BLE001 — hello handshake is best-effort; defaults already populated
            pass  # Use defaults

        pool.register(dev)

        try:
            while True:
                msg = await ws.receive_json()

                # Heartbeat
                if msg.get("method") == "heartbeat":
                    pool.heartbeat(device_id)
                    await ws.send_json({"jsonrpc": "2.0", "id": msg.get("id"), "result": "ok"})
                    continue

                # JSON-RPC response (from a previous tool call)
                if "result" in msg or "error" in msg:
                    msg_id = msg.get("id", "")
                    if "result" in msg:
                        pool.handle_response(device_id, msg_id, msg["result"])
                    else:
                        pool.handle_error(device_id, msg_id, msg.get("error"))
                    continue

        except WebSocketDisconnect:
            pool.unregister(device_id, reason="ws_disconnect")
        except Exception:
            pool.unregister(device_id, reason="ws_error")

    return router
