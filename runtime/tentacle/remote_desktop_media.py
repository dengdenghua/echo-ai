"""Lazy WebRTC media engine; no capture, input or listener exists before authorization."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from typing import Any


class DesktopCapture:
    def __init__(self):
        import mss

        self.screen = mss.mss()
        self.geometry = dict(self.screen.monitors[1])

    def frame(self):
        from PIL import Image

        shot = self.screen.grab(self.geometry)
        image = Image.frombytes("RGB", shot.size, shot.rgb)
        image.thumbnail((1280, 1280))
        # Video codecs require even dimensions. Preserve the screen's aspect ratio.
        return image.resize((max(2, image.width // 2 * 2), max(2, image.height // 2 * 2)))

    def close(self):
        self.screen.close()


class DesktopPeer:
    def __init__(self, servers, on_input, on_state, capture_factory=DesktopCapture):
        from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection

        self.pc = RTCPeerConnection(
            RTCConfiguration(iceServers=[RTCIceServer(**s) for s in servers])
        )
        self.channel = self.pc.createDataChannel("input", ordered=True)
        self.channel.on("message", on_input)
        self.pc.on("connectionstatechange", lambda: on_state(self.pc.connectionState))
        self.capture_factory = capture_factory
        self.worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="remote-screen")
        self.capture: Any = None
        self.track: Any = None
        self.closed = False
        self.capture_future = None

    async def prepare(self):
        from aiortc import VideoStreamTrack
        from av import VideoFrame

        loop = asyncio.get_running_loop()
        self.capture_future = loop.run_in_executor(self.worker, self.capture_factory)
        self.capture = await asyncio.shield(self.capture_future)
        await loop.run_in_executor(self.worker, self.capture.frame)  # Permission/display preflight.
        capture, worker = self.capture, self.worker

        class Screen(VideoStreamTrack):
            def __init__(self):
                super().__init__()
                self.started = loop.time()
                self.index = 0

            async def recv(self):
                await asyncio.sleep(max(0, self.started + self.index / 15 - loop.time()))
                image = await loop.run_in_executor(worker, capture.frame)
                frame = VideoFrame.from_image(image)
                frame.pts = round((loop.time() - self.started) * 90000)
                frame.time_base = Fraction(1, 90000)
                self.index += 1
                return frame

        self.track = Screen()
        self.pc.addTrack(self.track)
        return self.capture.geometry

    async def offer(self) -> dict:
        await self.pc.setLocalDescription(await self.pc.createOffer())
        return {"sdp": self.pc.localDescription.sdp, "type": "offer"}

    async def answer(self, sdp: str):
        from aiortc import RTCSessionDescription

        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="answer"))

    async def candidate(self, data: dict):
        from aiortc.sdp import candidate_from_sdp

        candidate = candidate_from_sdp(data["candidate"].removeprefix("candidate:"))
        candidate.sdpMid = data.get("sdpMid")
        candidate.sdpMLineIndex = (
            int(data["sdpMLineIndex"]) if data.get("sdpMLineIndex") is not None else None
        )
        await self.pc.addIceCandidate(candidate)

    def send(self, message: str):
        if self.channel.readyState == "open":
            self.channel.send(message)

    async def close(self):
        if self.closed:
            return
        self.closed = True
        if self.track:
            self.track.stop()
        await self.pc.close()
        try:
            if self.capture is None and self.capture_future is not None:
                self.capture = await self.capture_future
            if self.capture:
                await asyncio.get_running_loop().run_in_executor(self.worker, self.capture.close)
        finally:
            self.worker.shutdown(wait=False, cancel_futures=True)


class RelayedDesktopPeer:
    """Bounded low-frame-rate fallback through the existing authenticated WSS gateway."""

    def __init__(self, emit, capture_factory=DesktopCapture):
        self.emit = emit
        self.capture_factory = capture_factory
        self.worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="remote-relay")
        self.capture = None
        self.capture_future = None
        self.task = None
        self.closed = False

    async def prepare(self):
        loop = asyncio.get_running_loop()
        self.capture_future = loop.run_in_executor(self.worker, self.capture_factory)
        self.capture = await asyncio.shield(self.capture_future)
        await loop.run_in_executor(self.worker, self.capture.frame)
        return self.capture.geometry

    def _frame(self):
        import base64
        import io

        image = self.capture.frame()
        for quality in (60, 40, 25):
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=quality)
            if buffer.tell() <= 240000:
                return {
                    "jpeg": base64.b64encode(buffer.getvalue()).decode(),
                    "width": image.width,
                    "height": image.height,
                }
        return None

    async def offer(self):
        self.task = asyncio.create_task(self._stream())
        return {"type": "relay"}

    async def _stream(self):
        try:
            while not self.closed:
                frame = await asyncio.get_running_loop().run_in_executor(self.worker, self._frame)
                if frame:
                    await self.emit("remote_desktop/frame", frame)
                # Await every send: a slow gateway cannot accumulate stale frames.
                await asyncio.sleep(0.3)
        except asyncio.CancelledError:
            raise
        except Exception:
            await self.emit("remote_desktop/error", {"code": "capture_or_permission_failed"})

    def send(self, message):
        import json

        asyncio.create_task(self.emit("remote_desktop/inputAck", json.loads(message)))

    async def close(self):
        import contextlib

        if self.closed:
            return
        self.closed = True
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        try:
            if self.capture is None and self.capture_future is not None:
                self.capture = await self.capture_future
            if self.capture:
                await asyncio.get_running_loop().run_in_executor(self.worker, self.capture.close)
        finally:
            self.worker.shutdown(wait=False, cancel_futures=True)
