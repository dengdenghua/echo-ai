"""Real signaling and real media/data transport, with synthetic capture and harmless input."""

import asyncio
import json
from functools import partial

import pytest

from runtime.tentacle.remote_desktop import RemoteDesktopHost
from runtime.tentacle.transport.ws_server import TentacleWebSocketServer
from tests.test_remote_desktop import Input, Peer, wait_for


@pytest.mark.asyncio
async def test_authenticated_phone_socket_reaches_integrated_host(tmp_path, monkeypatch):
    from websockets.asyncio.client import connect

    monkeypatch.setenv("ECHO_REMOTE_ICE_SERVERS", "[]")
    server = TentacleWebSocketServer(host="127.0.0.1", port=0, auth_token="test-token")
    host = RemoteDesktopHost(
        server, tmp_path / "grants.json", peer_factory=Peer, input_factory=Input
    )
    server.on_custom = host.handle
    server.on_device_disconnect = host.stop
    await server.start()
    try:
        port = server._server.sockets[0].getsockname()[1]
        async with connect(f"ws://127.0.0.1:{port}") as phone:
            await phone.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": "hello",
                        "method": "device/hello",
                        "params": {
                            "tentacle_id": "phone",
                            "auth_token": "test-token",
                            "platform": "android",
                        },
                    }
                )
            )
            hello = json.loads(await phone.recv())
            assert hello.get("result", {}).get("registered")
            await host.grant("phone", "control")
            assert json.loads(await phone.recv())["method"] == "remote_desktop/status"
            await phone.send(
                json.dumps({"method": "webrtc/request", "params": {"requestId": "live-phone"}})
            )
            offer = json.loads(await phone.recv())
            assert offer["method"] == "webrtc/offer"
            session = host.sessions["phone"]
            assert offer["params"]["sessionId"] == session.id
        await wait_for(lambda: session.peer.closed and session.input.released)
        assert session.peer.closed and session.input.released
    finally:
        await host.shutdown()
        await server.stop()


@pytest.mark.asyncio
async def test_real_webrtc_frame_and_unicode_input(tmp_path, monkeypatch):
    aiortc = pytest.importorskip("aiortc")
    from types import SimpleNamespace

    from PIL import Image

    from runtime.tentacle.remote_desktop_media import DesktopPeer
    from tests.test_remote_desktop import Socket, start

    monkeypatch.setenv("ECHO_REMOTE_ICE_SERVERS", "[]")

    class Capture:
        geometry = {"left": 0, "top": 0, "width": 160, "height": 90}

        def frame(self):
            return Image.new("RGB", (160, 90), (40, 80, 120))

        def close(self):
            pass

    server = SimpleNamespace(_connections={"phone": Socket()})
    host = RemoteDesktopHost(
        server,
        tmp_path / "grants.json",
        peer_factory=partial(DesktopPeer, capture_factory=Capture),
        input_factory=Input,
    )
    remote = aiortc.RTCPeerConnection(aiortc.RTCConfiguration(iceServers=[]))
    frame_received, ack = asyncio.Event(), asyncio.Event()
    receive_task = None

    @remote.on("track")
    def on_track(track):
        nonlocal receive_task

        async def receive():
            frame = await track.recv()
            assert frame.width == 160 and frame.height == 90
            frame_received.set()

        receive_task = asyncio.create_task(receive())

    try:
        session = await start(host)

        @remote.on("datachannel")
        def on_channel(channel):
            @channel.on("message")
            def on_message(data):
                if json.loads(data).get("ok"):
                    ack.set()

            channel.send(
                json.dumps(
                    {"sessionId": session.id, "seq": 1, "action": "type", "text": "你好，Echo 🌏"}
                )
            )

        offer = server._connections["phone"].messages[-1]["params"]
        await remote.setRemoteDescription(
            aiortc.RTCSessionDescription(sdp=offer["sdp"], type="offer")
        )
        await remote.setLocalDescription(await remote.createAnswer())
        await session.peer.answer(remote.localDescription.sdp)
        await asyncio.wait_for(asyncio.gather(frame_received.wait(), ack.wait()), 15)
        assert session.input.events[0]["text"] == "你好，Echo 🌏"
    finally:
        await host.shutdown()
        await remote.close()
        if receive_task and not receive_task.done():
            receive_task.cancel()
