"""VLM analysis, screen streaming and remote-input routes for the Tentacle dashboard."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi import Request as FastAPIRequest
from fastapi.responses import Response

from runtime.safety.auth.websocket_auth import (
    OPERATOR_ROLES,
    WebSocketAuthConfig,
    authenticate_websocket,
)
from runtime.tentacle._dashboard_helpers import _auto_detect_vlm_config
from runtime.tentacle.base import ToolCall

if TYPE_CHECKING:
    from runtime.tentacle.coordinator import TentacleCoordinator

# Keep the dashboard's logger name so log routing is unchanged by the split.
logger = logging.getLogger("runtime.tentacle.dashboard")


def register_vlm_routes(
    router: APIRouter,
    coordinator: TentacleCoordinator,
    require_http_auth: Callable[[FastAPIRequest], None],
) -> None:
    """Register the manual VLM screen-analysis route."""
    # ── VLM 视觉分析 ────────────────────────────────────

    @router.post("/devices/{tentacle_id}/analyze", dependencies=[Depends(require_http_auth)])
    async def vlm_analyze(tentacle_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """手动触发 VLM 分析设备屏幕.

        请求体::

            {"task": "描述你想做什么"}

        返回::

            {
                "description": "屏幕内容描述",
                "suggested_actions": [...],
                "current_app": "当前应用",
                "screen_state": "屏幕状态",
                "vlm_usage": {...}
            }
        """
        task = body.get("task", "").strip()
        if not task:
            raise HTTPException(400, "Missing 'task' field")

        device = coordinator.pool.get(tentacle_id)
        if device is None:
            raise HTTPException(404, f"Device {tentacle_id} not found")
        if not device.is_online:
            raise HTTPException(400, f"Device {tentacle_id} is offline")

        # 1. 截图
        screenshot_call = ToolCall(
            call_id=f"vlm-analyze-{int(time.time() * 1000)}",
            tentacle_id=tentacle_id,
            tool="android.take_screenshot",
            args={},
        )
        screenshot_result = await device.execute(screenshot_call)
        if not screenshot_result.success:
            raise HTTPException(500, f"Screenshot failed: {screenshot_result.error_message}")

        # 获取截图 base64
        screenshot_b64 = ""
        if isinstance(screenshot_result.data, dict):
            screenshot_b64 = screenshot_result.data.get("screenshot", "")
        elif isinstance(screenshot_result.data, str):
            screenshot_b64 = screenshot_result.data

        if not screenshot_b64:
            raise HTTPException(500, "Screenshot data is empty")

        # 2. 获取无障碍树（可选）
        screen_info = None
        screen_info_call = ToolCall(
            call_id=f"vlm-screeninfo-{int(time.time() * 1000)}",
            tentacle_id=tentacle_id,
            tool="android.get_screen_info",
            args={},
        )
        screen_info_result = await device.execute(screen_info_call)
        if screen_info_result.success and isinstance(screen_info_result.data, dict):
            screen_info = screen_info_result.data

        # 3. 调用 VLM 分析
        try:
            from runtime.tentacle.mobile.vlm import VlmClient

            # 从协调器获取 VLM 客户端（如果已配置）
            vlm_client: VlmClient | None = getattr(coordinator, "_vlm_client", None)
            if vlm_client is None:
                # 尝试从环境变量自动配置
                vlm_config = _auto_detect_vlm_config()
                if vlm_config is None:
                    raise HTTPException(
                        400,
                        "VLM not configured. Set VLM_API_KEY env var or use with_vlm() factory.",
                    )
                vlm_client = VlmClient(vlm_config)
                coordinator._vlm_client = vlm_client  # 缓存到协调器

            if screen_info:
                analysis = vlm_client.analyze_with_tree(
                    screenshot_base64=screenshot_b64,
                    tree_data=screen_info,
                    task=task,
                )
            else:
                analysis = vlm_client.analyze_screenshot(
                    screenshot_base64=screenshot_b64,
                    task=task,
                )

            result = analysis.to_dict()
            result["vlm_usage"] = vlm_client.usage.to_dict()
            return result

        except HTTPException:
            raise
        except Exception as e:
            logger.exception("VLM analysis failed")
            raise HTTPException(500, f"VLM analysis failed: {e}") from e


def register_screen_routes(
    router: APIRouter,
    coordinator: TentacleCoordinator,
    require_http_auth: Callable[[FastAPIRequest], None],
    ws_auth: WebSocketAuthConfig,
) -> None:
    """Register device screenshot, screen-subscribe and screen-stream routes."""
    # ── 屏幕流：获取设备最新截图 ────────────────────────

    @router.get("/devices/{tentacle_id}/screenshot", dependencies=[Depends(require_http_auth)])
    async def device_screenshot(tentacle_id: str) -> Response:
        """获取设备最新截图（JPEG）.

        返回设备最近推送的 JPEG 帧，若无截图返回 404.
        """
        screen_relay = getattr(coordinator, "screen_relay", None)
        if screen_relay is None:
            raise HTTPException(503, "Screen relay not available")

        jpeg_data = screen_relay.get_screenshot(tentacle_id)
        if jpeg_data is None:
            raise HTTPException(404, f"No screenshot available for device {tentacle_id}")

        return Response(
            content=jpeg_data,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache, no-store"},
        )

    # ── 屏幕流：获取 WebSocket URL ──────────────────────

    @router.post("/screen/subscribe", dependencies=[Depends(require_http_auth)])
    async def screen_subscribe(body: dict[str, Any] | None = None) -> dict[str, Any]:
        """返回屏幕流 WebSocket URL 供前端连接.

        客户端连接 WS 后发送 JSON 订阅/取消订阅消息.
        """
        screen_relay = getattr(coordinator, "screen_relay", None)
        if screen_relay is None:
            raise HTTPException(503, "Screen relay not available")

        # 构建 WebSocket URL
        ws_url = f"ws://localhost:{coordinator._dashboard_port}/api/tentacle/screen/stream"

        return {
            "ws_url": ws_url,
            "protocol": "binary",
            "frame_format": {
                "header": "4 bytes (uint16 tid_len + uint8 frame_type + uint8 flags) + tid_bytes",
                "frame_types": {
                    "0x01": "H.264",
                    "0x02": "JPEG",
                    "0x03": "WebP",
                },
            },
            "subscribe_message": {"action": "subscribe", "tentacle_id": "xxx"},
            "unsubscribe_message": {"action": "unsubscribe", "tentacle_id": "xxx"},
        }

    # ── 屏幕流：WebSocket 端点 ──────────────────────────

    @router.websocket("/screen/stream")
    async def screen_stream(ws: WebSocket) -> None:
        """屏幕流 WebSocket 端点.

        浏览器客户端连接此端点接收屏幕流.

        客户端发送 JSON:
          - {"action": "subscribe", "tentacle_id": "xxx"} — 订阅设备屏幕流
          - {"action": "unsubscribe", "tentacle_id": "xxx"} — 取消订阅

        服务端推送二进制帧（格式同 ScreenRelay）.
        """
        auth = await authenticate_websocket(ws, config=ws_auth, roles=OPERATOR_ROLES)
        if auth is None:
            return
        screen_relay = getattr(coordinator, "screen_relay", None)
        if screen_relay is None:
            await ws.close(code=1011, reason="Screen relay not available")
            return

        await ws.accept(subprotocol=auth.subprotocol)
        logger.info("screen stream client connected: %s", ws.client)

        try:
            # 持续接收客户端的控制消息
            while True:
                raw = await ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await ws.send_json({"type": "error", "message": "Invalid JSON"})
                    continue

                action = msg.get("action", "")
                tentacle_id = msg.get("tentacle_id", "")

                if not tentacle_id:
                    await ws.send_json({"type": "error", "message": "Missing tentacle_id"})
                    continue

                if action == "subscribe":
                    # 检查设备是否存在
                    device = coordinator.pool.get(tentacle_id)
                    if device is None or not device.is_online:
                        # 设备不在线时，尝试启动 mock 流
                        await screen_relay.add_subscriber(tentacle_id, ws)
                        await screen_relay.start_mock_stream(tentacle_id)
                        await ws.send_json(
                            {
                                "type": "subscribed",
                                "tentacle_id": tentacle_id,
                                "mode": "mock",
                                "message": "Device offline, using mock stream",
                            }
                        )
                    else:
                        await screen_relay.add_subscriber(tentacle_id, ws)
                        await ws.send_json(
                            {
                                "type": "subscribed",
                                "tentacle_id": tentacle_id,
                                "mode": "live",
                            }
                        )
                    logger.info(
                        "screen subscribe: ws=%s device=%s",
                        ws.client,
                        tentacle_id,
                    )

                elif action == "unsubscribe":
                    await screen_relay.unsubscribe(tentacle_id, ws)
                    await ws.send_json(
                        {
                            "type": "unsubscribed",
                            "tentacle_id": tentacle_id,
                        }
                    )
                    logger.info(
                        "screen unsubscribe: ws=%s device=%s",
                        ws.client,
                        tentacle_id,
                    )

                else:
                    await ws.send_json(
                        {
                            "type": "error",
                            "message": f"Unknown action: {action}",
                        }
                    )

        except WebSocketDisconnect:
            logger.info("screen stream client disconnected: %s", ws.client)
        except Exception as e:
            logger.warning("screen stream error: %s", e)
        finally:
            # 清理：移除该客户端的所有订阅
            await screen_relay.remove_subscriber(ws)


def register_pc_screen_routes(
    router: APIRouter,
    coordinator: TentacleCoordinator,
    require_http_auth: Callable[[FastAPIRequest], None],
    ws_auth: WebSocketAuthConfig,
) -> None:
    """Register PC screen capture/stream and remote-input routes."""
    # ── PC 屏幕流 ────────────────────────────────────────────

    @router.websocket("/pc-screen/stream")
    async def pc_screen_stream(ws: WebSocket) -> None:
        """PC 屏幕流 WebSocket 端点.

        浏览器客户端连接此端点接收 PC 屏幕画面.
        协议与设备屏幕流相同（二进制帧格式）.
        """
        auth = await authenticate_websocket(ws, config=ws_auth, roles=OPERATOR_ROLES)
        if auth is None:
            return
        screen_relay = getattr(coordinator, "screen_relay", None)
        if screen_relay is None:
            await ws.close(code=1011, reason="Screen relay not available")
            return

        await ws.accept(subprotocol=auth.subprotocol)
        logger.info("PC screen stream client connected: %s", ws.client)

        # 自动订阅 pc-host
        from runtime.tentacle.mobile.pc_screen_capture import PC_HOST_ID

        await screen_relay.add_subscriber(PC_HOST_ID, ws)

        try:
            # 持续保持连接，等待客户端断开
            while True:
                # 接收客户端消息（心跳/控制）
                await ws.receive_text()
                # 忽略客户端消息，只用于保持连接
        except WebSocketDisconnect:
            logger.info("PC screen stream client disconnected: %s", ws.client)
        except Exception as e:
            logger.warning("PC screen stream error: %s", e)
        finally:
            await screen_relay.unsubscribe(PC_HOST_ID, ws)

    @router.post("/pc-screen/start", dependencies=[Depends(require_http_auth)])
    async def pc_screen_start(body: dict[str, Any] | None = None) -> dict[str, Any]:
        """启动 PC 屏幕捕获."""
        from runtime.tentacle.mobile.pc_screen_capture import PcScreenCapture, PcScreenConfig

        if coordinator.pc_screen_capture is not None and coordinator.pc_screen_capture.is_running:
            return {"status": "already_running", "stats": coordinator.pc_screen_capture.stats}

        # 解析可选配置
        config = PcScreenConfig()
        if body:
            if "fps" in body:
                config.fps = int(body["fps"])
            if "scale" in body:
                config.scale = float(body["scale"])
            if "quality" in body:
                config.jpeg_quality = int(body["quality"])

        try:
            coordinator.pc_screen_capture = PcScreenCapture(coordinator.screen_relay, config=config)
            await coordinator.pc_screen_capture.start()
            return {"status": "started", "stats": coordinator.pc_screen_capture.stats}
        except Exception as e:
            raise HTTPException(500, f"Failed to start PC screen capture: {e}") from e

    @router.post("/pc-screen/stop", dependencies=[Depends(require_http_auth)])
    async def pc_screen_stop() -> dict[str, Any]:
        """停止 PC 屏幕捕获."""
        if coordinator.pc_screen_capture is None:
            return {"status": "not_running"}

        stats = coordinator.pc_screen_capture.stats
        await coordinator.pc_screen_capture.stop()
        coordinator.pc_screen_capture = None
        return {"status": "stopped", "last_stats": stats}

    @router.get("/pc-screen/stats", dependencies=[Depends(require_http_auth)])
    async def pc_screen_stats() -> dict[str, Any]:
        """获取 PC 屏幕捕获统计."""
        if coordinator.pc_screen_capture is None:
            return {"running": False}
        return coordinator.pc_screen_capture.stats

    # ── 远程输入（手机→PC控制）──────────────────────────────

    @router.post("/remote-input", dependencies=[Depends(require_http_auth)])
    async def remote_input(body: dict[str, Any]) -> dict[str, Any]:
        """远程输入事件端点.

        接收来自前端/手机的输入事件，转发为PC鼠标/键盘操作.

        请求体::

            {
                "action": "tap",       # tap|double_tap|long_press|swipe|type_text|key_press
                "x": 0.5, "y": 0.3,   # 归一化坐标 [0,1]
                "x2": 0.8, "y2": 0.6,  # swipe 终点
                "duration_ms": 300,
                "text": "hello",
                "key": "enter"
            }
        """
        handler = coordinator.remote_input_handler
        if handler is None:
            raise HTTPException(
                400, "Remote input not enabled. Start coordinator with remote_input=True"
            )

        return await handler.handle_input(body)


__all__ = ["register_pc_screen_routes", "register_screen_routes", "register_vlm_routes"]
