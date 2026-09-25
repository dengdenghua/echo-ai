"""Expose the same authenticated device protocol through the HTTPS gateway."""

from __future__ import annotations

import asyncio
from typing import Any

from starlette.websockets import WebSocket, WebSocketDisconnect

MAX_FRAME_BYTES = 1024 * 1024


class AsgiDeviceSocket:
    """Small websockets-compatible adapter; no secondary TCP relay or auth bypass."""

    def __init__(self, socket: WebSocket) -> None:
        self.socket = socket
        self.remote_address = tuple(socket.client) if socket.client else ("unknown", None)
        self.path = socket.url.path
        self.closed = False
        self._first = True
        self._send_lock = asyncio.Lock()

    def __aiter__(self):
        return self

    async def __anext__(self) -> str | bytes:
        if self.closed:
            raise StopAsyncIteration
        try:
            if self._first:
                message = await asyncio.wait_for(self.socket.receive(), timeout=10)
                self._first = False
            else:
                message = await self.socket.receive()
        except (WebSocketDisconnect, RuntimeError):
            self.closed = True
            raise StopAsyncIteration from None
        except TimeoutError:
            await self.close(code=1008, reason="device hello timed out")
            raise StopAsyncIteration from None
        if message["type"] == "websocket.disconnect":
            self.closed = True
            raise StopAsyncIteration
        data = message.get("bytes")
        if data is None:
            data = message.get("text", "")
        length = len(data) if isinstance(data, bytes) else len(data.encode("utf-8"))
        if length > MAX_FRAME_BYTES:
            await self.close(code=1009, reason="device frame too large")
            raise StopAsyncIteration
        return data

    async def send(self, data: str | bytes) -> None:
        async with self._send_lock:
            if isinstance(data, bytes):
                await self.socket.send_bytes(data)
            else:
                await self.socket.send_text(data)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        if not self.closed:
            self.closed = True
            async with self._send_lock:
                await self.socket.close(code=code, reason=reason)


async def serve_device_socket(socket: WebSocket, server: Any) -> None:
    # A loopback-only unauthenticated development listener must never become
    # public merely because its parent HTTP app is reverse-proxied.
    if not server.auth_token:
        await socket.close(code=1008, reason="device authentication is not configured")
        return
    await socket.accept()
    await server._handle_connection(AsgiDeviceSocket(socket))
