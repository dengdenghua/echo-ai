"""Outbound desktop/VM device agent for either Echo AI or Echo OS.

Run inside the computer/VM being controlled. Only explicitly enabled tools are
advertised. A disconnected tool call is never replayed on reconnect.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import io
import ipaddress
import json
import os
import platform
import socket
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from .transport.device_protocol import DEVICE_ID, normalize_hello


def validate_url(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise ValueError("Use a device WebSocket URL without credentials or query parameters")
    if parsed.scheme == "wss":
        return
    host = parsed.hostname
    try:
        address = ipaddress.ip_address(host)
        local = address.is_loopback or any(
            address in ipaddress.ip_network(net)
            for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
        )
    except ValueError:
        local = host == "localhost"
    if parsed.scheme != "ws" or not local:
        raise ValueError("Remote device connections require wss://; ws:// is LAN development only")


class DesktopTools:
    """Actual local operations, scoped by the device owner's launch options."""

    def __init__(
        self, *, workspace: Path | None = None, screen: bool = False, allow_input: bool = False
    ) -> None:
        self.workspace = workspace.resolve(strict=True) if workspace is not None else None
        if self.workspace is not None and not self.workspace.is_dir():
            raise ValueError("workspace must be an existing directory")
        self.handlers: dict[str, Callable[[dict[str, Any]], Any]] = {"device.info": self.info}
        if self.workspace is not None:
            self.handlers.update(
                {"workspace.read_text": self.read_text, "workspace.write_text": self.write_text}
            )
        self.gui = None
        if screen or allow_input:
            import pyautogui

            self.gui = pyautogui
            # Keep the native corner fail-safe enabled.
            pyautogui.FAILSAFE = True
            self.handlers.update(
                {"screen_info": self.screen_info, "screen_capture": self.screen_capture}
            )
        if allow_input:
            self.handlers.update(
                {"mouse_click": self.mouse_click, "keyboard_type": self.keyboard_type}
            )

    def info(self, args: dict[str, Any]) -> dict[str, Any]:
        return {
            "platform": platform.system().lower(),
            "hostname": socket.gethostname(),
            "capabilities": sorted(self.handlers),
        }

    def _path(self, args: dict[str, Any]) -> Path:
        if self.workspace is None:
            raise ValueError("workspace access is disabled")
        name = args.get("path")
        if not isinstance(name, str) or not name or Path(name).is_absolute() or ":" in name:
            raise ValueError("expected a relative workspace path")
        target = (self.workspace / name).resolve()
        if not target.is_relative_to(self.workspace) or target == self.workspace:
            raise ValueError("path is outside the shared workspace")
        return target

    def read_text(self, args: dict[str, Any]) -> dict[str, Any]:
        with self._path(args).open("rb") as stream:
            data = stream.read(65537)
        if len(data) > 65536:
            raise ValueError("text file exceeds 64 KiB")
        return {"text": data.decode("utf-8")}

    def write_text(self, args: dict[str, Any]) -> dict[str, Any]:
        text = args.get("text")
        if not isinstance(text, str) or len(text.encode("utf-8")) > 65536:
            raise ValueError("text must be at most 64 KiB")
        target = self._path(args)
        # Creation only: overwriting an existing file requires a separate local decision.
        with target.open("x", encoding="utf-8", newline="") as stream:
            stream.write(text)
        return {
            "created": str(target.relative_to(self.workspace)),
            "bytes": len(text.encode("utf-8")),
        }

    def screen_info(self, args: dict[str, Any]) -> dict[str, int]:
        size = self.gui.size()
        return {"width": size.width, "height": size.height}

    def screen_capture(self, args: dict[str, Any]) -> dict[str, str]:
        screenshot = self.gui.screenshot()
        screenshot.thumbnail((1280, 800))
        buffer = io.BytesIO()
        screenshot.convert("RGB").save(buffer, format="JPEG", quality=65)
        return {
            "mime_type": "image/jpeg",
            "base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        }

    def mouse_click(self, args: dict[str, Any]) -> dict[str, bool]:
        x, y = args.get("x"), args.get("y")
        size = self.gui.size()
        if (
            type(x) not in (int, float)
            or type(y) not in (int, float)
            or not (0 <= x < size.width and 0 <= y < size.height)
            or int(x) != x
            or int(y) != y
        ):
            raise ValueError("click is outside the screen")
        self.gui.click(int(x), int(y))
        return {"clicked": True}

    def keyboard_type(self, args: dict[str, Any]) -> dict[str, bool]:
        text = args.get("text")
        if not isinstance(text, str) or len(text) > 4096 or not text.isascii():
            raise ValueError("keyboard_type currently accepts at most 4096 ASCII characters")
        self.gui.write(text)
        return {"typed": True}


class DeviceClient:
    def __init__(
        self,
        *,
        url: str,
        token: str,
        device_id: str,
        tools: DesktopTools,
        device_kind: str = "physical",
    ) -> None:
        validate_url(url)
        if not token or not DEVICE_ID.fullmatch(device_id):
            raise ValueError("a pairing token and unique device id are required")
        self.url, self.token, self.device_id = url, token, device_id
        self.tools, self.device_kind = tools, device_kind
        self.ready = asyncio.Event()
        self._socket = None
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}

    async def call_peer(self, target: str, tool: str, args: dict[str, Any]) -> dict[str, Any]:
        import uuid

        if not self.ready.is_set() or self._socket is None:
            raise ValueError("device is not connected")
        call_id = f"peer-{uuid.uuid4().hex}"
        future = asyncio.get_running_loop().create_future()
        self._pending[call_id] = future
        try:
            await self._socket.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": call_id,
                        "method": "device/call",
                        "params": {
                            "target_device_id": target,
                            "tool": tool,
                            "args": args,
                            "timeout_ms": 30000,
                        },
                    }
                )
            )
            return await asyncio.wait_for(future, timeout=35)
        finally:
            self._pending.pop(call_id, None)

    async def run_once(self) -> None:
        self.ready.clear()
        params = normalize_hello(
            {
                "tentacle_id": self.device_id,
                "auth_token": self.token,
                "protocol_version": "1.0",
                "platform": platform.system().lower(),
                "device_kind": self.device_kind,
                "hostname": socket.gethostname(),
                "capabilities": sorted(self.tools.handlers),
            }
        )
        async with connect(self.url, max_size=1024 * 1024) as ws:
            await ws.send(
                json.dumps(
                    {"jsonrpc": "2.0", "id": "hello", "method": "device/hello", "params": params}
                )
            )
            ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if ack.get("id") != "hello" or ack.get("result", {}).get("registered") is not True:
                raise ValueError("device registration rejected")
            self.ready.set()
            self._socket = ws

            async def heartbeat() -> None:
                while True:
                    await asyncio.sleep(20)
                    await ws.send(
                        json.dumps(
                            {
                                "jsonrpc": "2.0",
                                "method": "device/heartbeat",
                                "params": {
                                    "tentacle_id": self.device_id,
                                    "ts": int(time.time() * 1000),
                                    "online": True,
                                },
                            }
                        )
                    )

            beat = asyncio.create_task(heartbeat())
            try:
                async for raw in ws:
                    if isinstance(raw, bytes):
                        continue
                    message = json.loads(raw)
                    pending = self._pending.get(message.get("id"))
                    if pending is not None and not pending.done():
                        if "error" in message:
                            pending.set_exception(
                                ValueError(message["error"].get("message", "Peer call rejected"))
                            )
                        elif "result" in message:
                            pending.set_result(message["result"])
                        continue
                    if message.get("method") != "tool/execute":
                        continue
                    call = message.get("params", {})
                    call_id = call.get("id", message.get("id"))
                    result: dict[str, Any] = {"call_id": call_id, "success": False}
                    started = time.monotonic()
                    try:
                        if call.get("tentacle_id") != self.device_id:
                            raise ValueError("device target mismatch")
                        handler = self.tools.handlers.get(call.get("tool"))
                        if handler is None:
                            raise ValueError("tool is not enabled on this device")
                        args = call.get("args", {})
                        if not isinstance(args, dict):
                            raise ValueError("tool arguments must be an object")
                        result.update(data=await asyncio.to_thread(handler, args), success=True)
                    except Exception as exc:
                        result["error"] = {"code": -32004, "message": str(exc)}
                    result["duration_ms"] = int((time.monotonic() - started) * 1000)
                    await ws.send(
                        json.dumps({"jsonrpc": "2.0", "method": "tool/result", "params": result})
                    )
            finally:
                self.ready.clear()
                self._socket = None
                for future in self._pending.values():
                    if not future.done():
                        future.set_exception(ConnectionError("Device disconnected"))
                beat.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await beat

    async def run_forever(self) -> None:
        delay = 1
        while True:
            try:
                await self.run_once()
                delay = 1
            except (OSError, ValueError, TimeoutError, WebSocketException):
                # Do not print the URL, token, or upstream exception containing either.
                print("Device connection unavailable; retrying.", flush=True)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument(
        "--device-id", required=True, help="Unique persistent id; change it when cloning a VM"
    )
    parser.add_argument("--kind", choices=("physical", "vm"), default="physical")
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--screen", action="store_true")
    parser.add_argument("--allow-input", action="store_true")
    options = parser.parse_args()
    tools = DesktopTools(
        workspace=options.workspace, screen=options.screen, allow_input=options.allow_input
    )
    client = DeviceClient(
        url=options.url,
        token=os.environ.get("ECHO_DEVICE_TOKEN", ""),
        device_id=options.device_id,
        device_kind=options.kind,
        tools=tools,
    )
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(client.run_forever())


if __name__ == "__main__":
    main()
