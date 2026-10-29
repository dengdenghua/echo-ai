"""Paired-device remote desktop lifecycle, permissions and bounded input dispatch."""

from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import json
import os
import re
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .remote_desktop_config import VIDEO_PROFILES, has_relay, ice_servers
from .remote_desktop_input import DesktopInput


@dataclass
class RemoteSession:
    device_id: str
    request_id: str
    permission: str
    socket: Any
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    peer: Any = None
    input: Any = None
    worker: Any = None
    task: Any = None
    consumer: Any = None
    watchdog: Any = None
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=64))
    state: str = "connecting"
    deadline: float = 0
    expires: float = 0
    sequence: int = 0
    transport: str = "webrtc"
    quality: str = "auto"


class RemoteDesktopHost:
    def __init__(self, server, state_path: Path, *, peer_factory=None, input_factory=DesktopInput):
        self.server = server
        self.state_path = state_path
        self.peer_factory = peer_factory
        self.input_factory = input_factory
        self.permissions: dict[str, str] = {}
        self.sessions: dict[str, RemoteSession] = {}
        self.lock = asyncio.Lock()
        try:
            stored = json.loads(state_path.read_text("utf-8"))
            self.permissions = {
                k: v for k, v in stored.items() if isinstance(k, str) and v in {"view", "control"}
            }
        except (OSError, ValueError, AttributeError, TypeError):
            pass  # A missing or damaged file never grants remote access.

    def availability(self) -> str:
        if self.peer_factory is not None:
            return "ready"
        if any(
            importlib.util.find_spec(name) is None for name in ("aiortc", "av", "mss", "pyautogui")
        ):
            return "component_missing"
        if sys.platform == "linux" and not os.environ.get("DISPLAY"):
            return "display_unavailable"
        try:
            ice_servers("status")
        except (ValueError, TypeError):
            return "network_config_invalid"
        return "ready"

    def status(self, device_id: str | None = None) -> dict:
        available = self.availability()
        try:
            relay = has_relay(ice_servers("status"))
        except (ValueError, TypeError):
            relay = False
        result = {
            "state": available,
            "platform": sys.platform,
            "inputFocusHints": sys.platform == "win32"
            or (
                sys.platform.startswith("linux") and os.environ.get("XDG_SESSION_TYPE") != "wayland"
            ),
            "relayConfigured": relay,
            "qualityProfiles": list(VIDEO_PROFILES),
            "active": [
                {"deviceId": s.device_id, "state": s.state, "permission": s.permission}
                for s in self.sessions.values()
            ],
        }
        if device_id is None:
            result["permissions"] = dict(self.permissions)
        else:
            result.pop("active")
            result["permission"] = self.permissions.get(device_id, "denied")
            if result["permission"] == "denied":
                result["state"] = "authorization_required"
        return result

    async def grant(self, device_id: str, mode: str):
        if mode not in {"view", "control", "denied"}:
            raise ValueError("Invalid remote permission")
        if mode != "denied" and device_id not in self.server._connections:
            raise ValueError("Device must be connected before authorization")
        async with self.lock:
            updated = dict(self.permissions)
            if mode == "denied":
                updated.pop(device_id, None)
            else:
                updated[device_id] = mode
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.state_path.with_suffix(".tmp")
            temp.write_text(json.dumps(updated), encoding="utf-8")
            temp.replace(self.state_path)
            self.permissions = updated
            await self._close(device_id, "permission_changed")
        ws = self.server._connections.get(device_id)
        if ws is not None:
            await self._send(ws, "remote_desktop/status", self.status(device_id))

    async def _send(self, ws, method: str, params: dict):
        with contextlib.suppress(Exception):
            await asyncio.wait_for(
                ws.send(json.dumps({"jsonrpc": "2.0", "method": method, "params": params})), 5
            )

    async def handle(self, device_id: str | None, message: dict, ws):
        # Never trust an identity inside params, a stale socket or an unregistered client.
        if not device_id or self.server._connections.get(device_id) is not ws:
            return
        method, params = message.get("method"), message.get("params", {})
        if not isinstance(params, dict):
            return
        if method == "remote_desktop/status":
            await self._send(ws, method, self.status(device_id))
        elif method == "webrtc/request":
            request_id = params.get("requestId", "")
            quality = params.get("quality", "auto")
            if not isinstance(quality, str) or quality not in VIDEO_PROFILES:
                await self._send(ws, "remote_desktop/error", {"code": "invalid_settings"})
                return
            if not isinstance(request_id, str) or not re.fullmatch(
                r"[a-zA-Z0-9-]{1,80}", request_id
            ):
                await self._send(ws, "remote_desktop/error", {"code": "client_update_required"})
                return
            state = self.status(device_id)
            if state["state"] != "ready":
                await self._send(
                    ws, "remote_desktop/error", {"code": state["state"], "requestId": request_id}
                )
                return
            async with self.lock:
                # A revoke can complete while this request waits for another session to close.
                if self.permissions.get(device_id, "denied") == "denied":
                    await self._send(
                        ws,
                        "remote_desktop/error",
                        {
                            "code": "authorization_required",
                            "requestId": request_id,
                        },
                    )
                    return
                if any(k != device_id for k in self.sessions):
                    await self._send(
                        ws, "remote_desktop/error", {"code": "busy", "requestId": request_id}
                    )
                    return
                await self._close(device_id, "replaced")
                session = RemoteSession(device_id, request_id, self.permissions[device_id], ws)
                session.quality = quality
                session.transport = "relay" if params.get("transport") == "relay" else "webrtc"
                self.sessions[device_id] = session
                session.task = asyncio.create_task(self._start(session))
        elif method in {
            "webrtc/answer",
            "webrtc/candidate",
            "remote_desktop/stop",
            "remote_desktop/input",
        }:
            session = self.sessions.get(device_id)
            if not session or session.request_id != params.get("requestId"):
                return
            if method != "remote_desktop/stop" and session.id != params.get("sessionId"):
                return
            if method == "remote_desktop/stop":
                await self.stop(device_id, "stopped")
            elif method == "remote_desktop/input":
                if session.transport == "relay":
                    self._input(session, params.get("data"))
            elif session.peer is not None:
                try:
                    if method == "webrtc/answer":
                        sdp = params.get("sdp")
                        if not isinstance(sdp, str) or len(sdp) > 128000:
                            raise ValueError("Invalid answer")
                        await session.peer.answer(sdp)
                    else:
                        candidate = params.get("candidate")
                        if not isinstance(candidate, dict) or len(str(candidate)) > 4096:
                            raise ValueError("Invalid candidate")
                        await session.peer.candidate(candidate)
                except Exception:
                    await self.stop(device_id, "negotiation_failed")
        else:
            await ws.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": message.get("id"),
                        "error": {"code": -32601, "message": "Method not found"},
                    }
                )
            )

    async def _start(self, session: RemoteSession):
        try:
            servers = ice_servers(session.device_id)
            factory = self.peer_factory
            if session.transport == "relay" and factory is None:
                from .remote_desktop_media import RelayedDesktopPeer

                async def emit(method, params):
                    if self.sessions.get(session.device_id) is session:
                        await self._send(
                            session.socket,
                            method,
                            {**params, "requestId": session.request_id, "sessionId": session.id},
                        )

                session.peer = RelayedDesktopPeer(emit)
            elif factory is None:
                from .remote_desktop_media import DesktopPeer

                factory = DesktopPeer
            if session.peer is None:
                session.peer = factory(
                    servers,
                    lambda data: self._input(session, data),
                    lambda state: self._state(session, state),
                )
            if hasattr(session.peer, "configure_video"):
                session.peer.configure_video(session.quality)
            geometry = await asyncio.wait_for(session.peer.prepare(), 10)
            if session.permission == "control":
                session.worker = ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="remote-input"
                )
                session.input = await asyncio.get_running_loop().run_in_executor(
                    session.worker, self.input_factory, geometry
                )
            session.consumer = asyncio.create_task(self._consume(session))
            now = asyncio.get_running_loop().time()
            session.deadline, session.expires = now + 45, now + 1800
            session.watchdog = asyncio.create_task(self._watch(session))
            offer = await asyncio.wait_for(session.peer.offer(), 30)
            method = "remote_desktop/relay" if session.transport == "relay" else "webrtc/offer"
            await self._send(
                session.socket,
                method,
                {
                    **offer,
                    "requestId": session.request_id,
                    "sessionId": session.id,
                    "iceServers": servers,
                    "permission": session.permission,
                },
            )
            if session.transport == "relay":
                self._state(session, "connected")
        except asyncio.CancelledError:
            raise
        except Exception:
            # Native exception text may include SDP, credentials or local paths.
            await self._send(
                session.socket,
                "remote_desktop/error",
                {"requestId": session.request_id, "code": "capture_or_permission_failed"},
            )
            asyncio.create_task(self.stop(session.device_id, "start_failed", expected=session))

    def _state(self, session: RemoteSession, state: str):
        if self.sessions.get(session.device_id) is not session:
            return
        session.state = state
        if state in {"failed", "closed"}:
            asyncio.create_task(self.stop(session.device_id, "connection_lost", expected=session))

    def _input(self, session: RemoteSession, raw: Any):
        if (
            self.sessions.get(session.device_id) is not session
            or not isinstance(raw, str)
            or len(raw) > 20000
        ):
            return
        try:
            event = json.loads(raw)
            if not isinstance(event, dict) or event.get("sessionId") != session.id:
                return
            if event.get("action") == "ping":
                session.deadline = asyncio.get_running_loop().time() + 30
                session.peer.send(json.dumps({"type": "pong"}))
                return
            sequence = event.get("seq")
            if type(sequence) is not int or sequence <= session.sequence:
                return
            session.sequence = sequence
            if (
                session.permission != "control"
                or self.permissions.get(session.device_id) != "control"
            ):
                session.peer.send(
                    json.dumps(
                        {"type": "inputAck", "seq": sequence, "ok": False, "code": "view_only"}
                    )
                )
                return
            session.queue.put_nowait(event)
        except asyncio.QueueFull:
            # End rather than dropping a mouse-up or replaying a delayed click.
            asyncio.create_task(self.stop(session.device_id, "input_overflow", expected=session))
        except (ValueError, TypeError):
            return

    async def _consume(self, session: RemoteSession):
        while True:
            event = await session.queue.get()
            if self.permissions.get(session.device_id) != "control":
                continue
            ok = True
            focus = None
            try:
                await asyncio.get_running_loop().run_in_executor(
                    session.worker, session.input.apply, event
                )
            except Exception:
                ok = False
            if ok and event.get("action") == "tap" and hasattr(session.input, "focus_hint"):
                try:
                    focus = await asyncio.get_running_loop().run_in_executor(
                        session.worker, session.input.focus_hint
                    )
                except Exception:
                    # A failed optional hint must never imply that the click failed.
                    focus = {"available": False, "editable": False, "secure": False}
            if isinstance(focus, dict):
                focus = {key: focus.get(key) is True for key in ("available", "editable", "secure")}
            session.peer.send(
                json.dumps(
                    {
                        "type": "inputAck",
                        "seq": event["seq"],
                        "ok": ok,
                        "code": "ok" if ok else "input_failed",
                        **({"inputFocus": focus} if isinstance(focus, dict) else {}),
                    }
                )
            )

    async def _watch(self, session: RemoteSession):
        while True:
            await asyncio.sleep(2)
            now = asyncio.get_running_loop().time()
            if now > min(session.deadline, session.expires):
                asyncio.create_task(
                    self.stop(session.device_id, "session_expired", expected=session)
                )
                return

    async def _close(self, device_id: str, reason: str):
        session = self.sessions.pop(device_id, None)
        if session is None:
            return
        for task in (session.task, session.consumer, session.watchdog):
            if task is not None and task is not asyncio.current_task():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        if session.worker:
            if session.input:
                with contextlib.suppress(Exception):
                    await asyncio.get_running_loop().run_in_executor(
                        session.worker, session.input.release
                    )
            session.worker.shutdown(wait=False, cancel_futures=True)
        if session.peer:
            with contextlib.suppress(Exception):
                await session.peer.close()
        await self._send(
            session.socket,
            "remote_desktop/stopped",
            {"requestId": session.request_id, "sessionId": session.id, "reason": reason},
        )

    async def stop(self, device_id: str, reason="stopped", *, expected=None):
        async with self.lock:
            if expected is None or self.sessions.get(device_id) is expected:
                await self._close(device_id, reason)

    async def shutdown(self):
        async with self.lock:
            for device_id in list(self.sessions):
                await self._close(device_id, "host_stopped")
