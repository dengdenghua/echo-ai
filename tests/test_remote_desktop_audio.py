"""Audio authorization, actual RTP encoding, fallback and bounded resource lifetime."""

import asyncio
import base64
import json
import math
import queue
import struct
from functools import partial
from types import SimpleNamespace

import pytest

from runtime.tentacle import remote_desktop_audio as audio
from runtime.tentacle.remote_desktop import RemoteDesktopHost
from runtime.tentacle.remote_desktop_media import DesktopPeer, RelayedDesktopPeer
from tests.test_remote_desktop import Input, Socket


class Capture:
    geometry = {"left": 0, "top": 0, "width": 160, "height": 90}

    def frame(self):
        from PIL import Image
        return Image.new("RGB", (160, 90))

    def close(self):
        self.closed = True


class Tone:
    instances = []

    def __init__(self, rate, channels):
        self.rate, self.channels, self.closed = rate, channels, False
        self.pcm = b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * i / rate)))
                            * channels for i in range(rate // 50))
        self.instances.append(self)

    def read(self):
        assert not self.closed
        return self.pcm

    def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_audio_requires_live_identity_authorization_and_explicit_opt_in(tmp_path, monkeypatch):
    monkeypatch.setenv("ECHO_REMOTE_ICE_SERVERS", "[]")
    server = SimpleNamespace(_connections={"phone": Socket()})
    Tone.instances = []
    host = RemoteDesktopHost(server, tmp_path / "grants.json",
                            peer_factory=partial(DesktopPeer, capture_factory=Capture,
                                                 audio_factory=Tone), input_factory=Input)
    request = {"method": "webrtc/request", "params": {"requestId": "audio", "audio": True}}
    try:
        await host.handle("phone", request, Socket())
        await host.handle("phone", request, server._connections["phone"])
        assert not host.sessions and not Tone.instances
        await host.grant("phone", "view")
        for bad in ("true", 1, {}, None):
            request["params"]["audio"] = bad
            await host.handle("phone", request, server._connections["phone"])
            assert not host.sessions
        request["params"].pop("audio")
        await host.handle("phone", request, server._connections["phone"])
        await host.sessions["phone"].task
        assert not Tone.instances
        await host.stop("phone")
        request["params"]["audio"] = True
        await host.handle("phone", request, server._connections["phone"])
        await host.sessions["phone"].task
        assert len(Tone.instances) == 1
        assert host.sessions["phone"].input is None  # View permission may listen, never inject input.
        await host.grant("phone", "denied")
        assert not host.sessions and Tone.instances[0].closed
    finally:
        await host.shutdown()


@pytest.mark.asyncio
async def test_actual_webrtc_opus_audio_and_video_arrive_together():
    from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription

    sender = DesktopPeer([], lambda _: None, lambda _: None, Capture, Tone)
    sender.configure_audio(True)
    receiver = RTCPeerConnection(RTCConfiguration(iceServers=[]))
    tracks, tasks = {}, []

    @receiver.on("track")
    def track_received(track):
        async def receive():
            # Ignore the codec's initial delay, then inspect decoded samples.
            frames = [await track.recv() for _ in range(5 if track.kind == "audio" else 1)]
            tracks[track.kind] = frames[-1]
        tasks.append(asyncio.create_task(receive()))

    try:
        await sender.prepare()
        offer = await sender.offer()
        assert "m=audio" in offer["sdp"] and "opus/48000/2" in offer["sdp"]
        await receiver.setRemoteDescription(RTCSessionDescription(sdp=offer["sdp"], type="offer"))
        await receiver.setLocalDescription(await receiver.createAnswer())
        await sender.answer(receiver.localDescription.sdp)
        await asyncio.wait_for(asyncio.gather(*tasks), 15)
        frame = tracks["audio"]
        assert frame.sample_rate == 48000
        assert max(abs(float(x)) for x in frame.to_ndarray().ravel()) > 500
        assert tracks["video"].width == 160
        capture = sender.audio.capture
    finally:
        await sender.close()
        await receiver.close()
    assert capture.closed and sender.audio.track.readyState == "ended"


@pytest.mark.asyncio
@pytest.mark.parametrize("peer_type", [DesktopPeer, RelayedDesktopPeer])
async def test_missing_audio_does_not_break_video(peer_type):
    def missing(*args):
        raise OSError("sensitive native paths must never be forwarded")
    if peer_type is DesktopPeer:
        peer = peer_type([], lambda _: None, lambda _: None, Capture, missing)
    else:
        async def emit(*args):
            pass
        peer = peer_type(emit, Capture, missing)
    peer.configure_audio(True)
    try:
        assert (await peer.prepare())["width"] == 160
        offer = await peer.offer()
        assert offer["audio"] == "unavailable"
        assert "sensitive" not in json.dumps(offer)
    finally:
        await peer.close()


@pytest.mark.asyncio
async def test_relay_audio_is_bounded_pcm_and_closes_on_slow_connection():
    packets = []
    async def emit(method, params):
        if method == "remote_desktop/audio":
            packets.append(params)
            await asyncio.sleep(.08)
    peer = RelayedDesktopPeer(emit, Capture, Tone)
    peer.configure_audio(True)
    await peer.prepare()
    await peer.offer()
    await asyncio.sleep(.24)
    capture = peer.audio.capture
    await asyncio.wait_for(peer.close(), 1)
    assert 1 <= len(packets) <= 4
    packet = packets[0]
    assert packet["rate"] == 24000 and packet["channels"] == 1
    assert len(base64.b64decode(packet["pcm"])) == 960
    assert capture.closed and peer.audio_task.done()


@pytest.mark.asyncio
async def test_device_loss_emits_safe_status_and_releases_capture():
    states = []
    class Lost(Tone):
        def read(self):
            raise OSError("unplugged private device name")
    async def status(state):
        states.append(state)
    stream = audio.SessionAudio(capture_factory=Lost)
    stream.configure(True, status)
    assert await stream.prepare()
    capture = stream.capture
    assert await stream.read() == bytes(3840)
    assert capture.closed and states == ["unavailable"]
    assert await stream.read() == bytes(3840)
    assert states == ["unavailable"]
    await stream.close()


def test_native_queue_discards_old_audio_and_never_grows():
    capture = audio.SystemAudioCapture.__new__(audio.SystemAudioCapture)
    capture.closed, capture.chunks = False, queue.Queue(maxsize=3)
    for i in range(20):
        capture._push(bytes([i]))
    assert [capture.chunks.get_nowait()[0] for _ in range(3)] == [17, 18, 19]
    capture.closed = True
    capture._push(b"late")
    assert capture.chunks.empty()


@pytest.mark.asyncio
async def test_cancelled_audio_initialization_is_still_closed_without_orphaning_a_worker():
    import threading
    entered, release = threading.Event(), threading.Event()
    captures = []
    def delayed(rate, channels):
        entered.set()
        assert release.wait(timeout=2)
        capture = Tone(rate, channels)
        captures.append(capture)
        return capture
    stream = audio.SessionAudio(capture_factory=delayed)
    stream.configure(True)
    preparing = asyncio.create_task(stream.prepare())
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        preparing.cancel()
        with pytest.raises(asyncio.CancelledError):
            await preparing
    finally:
        release.set()
        await asyncio.wait_for(stream.close(), 2)
    assert captures[0].closed and stream.worker._shutdown


def test_windows_never_falls_back_to_a_microphone(monkeypatch):
    import sys
    terminated = []
    device = SimpleNamespace(get_default_wasapi_loopback=lambda: {"isLoopbackDevice": False},
                             terminate=lambda: terminated.append(True),
                             open=lambda **_: pytest.fail("Must not open a recording device"))
    monkeypatch.setattr(audio.sys, "platform", "win32")
    monkeypatch.setattr(audio, "_windows_com", lambda: None)
    monkeypatch.setitem(sys.modules, "pyaudiowpatch", SimpleNamespace(PyAudio=lambda: device))
    with pytest.raises(OSError, match="No speaker loopback"):
        audio.SystemAudioCapture()
    assert terminated == [True]


@pytest.mark.parametrize("result,owns_reference", [(0, True), (1, True), (-2147417850, False)])
def test_windows_audio_com_reference_is_balanced(monkeypatch, result, owns_reference):
    import ctypes

    released = []
    ole32 = SimpleNamespace(CoInitializeEx=lambda *args: result,
                            CoUninitialize=lambda: released.append(True))
    monkeypatch.setattr(ctypes, "WinDLL", lambda _: ole32, raising=False)
    release = audio._windows_com()
    if release:
        release()
    assert released == ([True] if owns_reference else [])


def test_windows_audio_com_failure_does_not_claim_a_reference(monkeypatch):
    import ctypes

    ole32 = SimpleNamespace(CoInitializeEx=lambda *args: -2147467259,
                            CoUninitialize=lambda: pytest.fail("No COM reference was acquired"))
    monkeypatch.setattr(ctypes, "WinDLL", lambda _: ole32, raising=False)
    with pytest.raises(OSError, match="audio thread initialization"):
        audio._windows_com()


def test_linux_captures_only_the_default_output_monitor(monkeypatch):
    import io
    calls = []
    class Process:
        stdout = io.BytesIO(bytes(3840))
        stopped = False
        def poll(self): return 0 if self.stopped else None
        def terminate(self): self.stopped = True
        def wait(self, **kwargs): return 0
    process = Process()
    monkeypatch.setattr(audio.sys, "platform", "linux")
    monkeypatch.setattr(audio.shutil, "which", lambda _: "/usr/bin/parec")
    def popen(command, **kwargs):
        calls.append((command, kwargs))
        return process
    monkeypatch.setattr(audio.subprocess, "Popen", popen)
    capture = audio.SystemAudioCapture()
    try:
        assert capture.read() == bytes(3840)
        assert "--device=@DEFAULT_MONITOR@" in calls[0][0]
        assert "--device=@DEFAULT_SOURCE@" not in calls[0][0]
        assert not calls[0][1].get("shell")
    finally:
        capture.close()
    assert process.stopped and not capture.thread.is_alive()
