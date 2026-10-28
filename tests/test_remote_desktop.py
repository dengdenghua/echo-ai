import asyncio
import json
from types import SimpleNamespace

import pytest

from runtime.tentacle.remote_desktop import RemoteDesktopHost
from runtime.tentacle.remote_desktop_config import has_relay, ice_servers
from runtime.tentacle.remote_desktop_input import DesktopInput, unicode_units


class Socket:
    def __init__(self):
        self.messages = []

    async def send(self, text):
        self.messages.append(json.loads(text))


class Peer:
    def __init__(self, servers, on_input, on_state):
        self.on_input, self.on_state = on_input, on_state
        self.sent, self.answers, self.candidates = [], [], []
        self.closed = False

    async def prepare(self):
        return {"left": 0, "top": 0, "width": 1600, "height": 900}

    async def offer(self):
        return {"sdp": "test-offer", "type": "offer"}

    async def answer(self, sdp):
        self.answers.append(sdp)

    async def candidate(self, data):
        self.candidates.append(data)

    def send(self, data):
        self.sent.append(json.loads(data))

    async def close(self):
        self.closed = True


class Input:
    def __init__(self, geometry):
        self.events = []
        self.released = False

    def apply(self, event):
        self.events.append(event)

    def release(self):
        self.released = True


@pytest.fixture
def host(tmp_path, monkeypatch):
    monkeypatch.setenv("ECHO_REMOTE_ICE_SERVERS", "[]")
    server = SimpleNamespace(_connections={"phone": Socket(), "other": Socket()})
    return RemoteDesktopHost(
        server, tmp_path / "permissions.json", peer_factory=Peer, input_factory=Input
    )


async def start(host, device="phone", request="request-1", mode="control"):
    await host.grant(device, mode)
    await host.handle(
        device,
        {"method": "webrtc/request", "params": {"requestId": request}},
        host.server._connections[device],
    )
    session = host.sessions[device]
    await session.task
    return session


async def wait_for(predicate):
    async with asyncio.timeout(5):
        while not predicate():
            await asyncio.sleep(0.01)


@pytest.mark.asyncio
async def test_pairing_does_not_grant_remote_access(host):
    ws = host.server._connections["phone"]
    await host.handle(
        "phone", {"method": "webrtc/request", "params": {"requestId": "request-1"}}, ws
    )
    assert ws.messages[-1]["params"]["code"] == "authorization_required"
    assert not host.sessions
    await host.grant("phone", "control")
    await host.handle(
        "phone", {"method": "webrtc/request", "params": {"requestId": "request-1"}}, Socket()
    )
    assert not host.sessions


@pytest.mark.asyncio
async def test_unicode_input_ack_no_duplicate_and_revoke(host):
    session = await start(host)
    try:
        event = {"sessionId": session.id, "seq": 1, "action": "type", "text": "你好 Echo 🌏"}
        session.peer.on_input(json.dumps(event))
        session.peer.on_input(json.dumps(event))
        await wait_for(lambda: session.peer.sent)
        assert [e["text"] for e in session.input.events] == ["你好 Echo 🌏"]
        assert session.peer.sent[-1]["ok"] is True
        await host.grant("phone", "denied")
        session.peer.on_input(json.dumps({**event, "seq": 2}))
        assert len(session.input.events) == 1
        assert session.peer.closed and session.input.released
        assert not host.sessions
    finally:
        await host.shutdown()


@pytest.mark.asyncio
async def test_view_only_cannot_inject_and_other_device_cannot_take_over(host):
    session = await start(host, mode="view")
    try:
        session.peer.on_input(
            json.dumps({"sessionId": session.id, "seq": 1, "action": "tap", "x": 0.1, "y": 0.1})
        )
        assert session.peer.sent[-1]["code"] == "view_only"
        assert session.input is None
        session.peer.on_input(json.dumps({"sessionId": session.id, "action": "ping"}))
        assert session.peer.sent[-1]["type"] == "pong"
        await host.grant("other", "control")
        await host.handle(
            "other",
            {"method": "webrtc/request", "params": {"requestId": "r"}},
            host.server._connections["other"],
        )
        assert host.server._connections["other"].messages[-1]["params"]["code"] == "busy"
    finally:
        await host.shutdown()


@pytest.mark.asyncio
async def test_stale_signaling_cannot_close_or_answer_replacement(host):
    first = await start(host)
    await host.handle(
        "phone",
        {"method": "webrtc/request", "params": {"requestId": "replacement"}},
        host.server._connections["phone"],
    )
    second = host.sessions["phone"]
    await second.task
    try:
        assert first.peer.closed
        for method in ("webrtc/answer", "remote_desktop/stop"):
            await host.handle(
                "phone",
                {
                    "method": method,
                    "params": {
                        "requestId": first.request_id,
                        "sessionId": first.id,
                        "sdp": "stale",
                    },
                },
                first.socket,
            )
        assert host.sessions["phone"] is second and not second.peer.answers
        await host.handle(
            "phone",
            {
                "method": "webrtc/answer",
                "params": {
                    "requestId": second.request_id,
                    "sessionId": second.id,
                    "sdp": "current",
                },
            },
            second.socket,
        )
        assert second.peer.answers == ["current"]
    finally:
        await host.shutdown()


@pytest.mark.asyncio
async def test_queue_overflow_ends_session_instead_of_replaying_input(host):
    session = await start(host)
    for i in range(70):
        session.peer.on_input(
            json.dumps({"sessionId": session.id, "seq": i + 1, "action": "tap", "x": 0.5, "y": 0.5})
        )
    await wait_for(lambda: session.peer.closed)
    assert session.input.released
    assert not host.sessions


@pytest.mark.asyncio
async def test_device_disconnect_closes_media_and_releases_input(host):
    session = await start(host)
    await host.stop("phone", "device_disconnected")
    assert session.peer.closed and session.input.released
    reloaded = RemoteDesktopHost(host.server, host.state_path, peer_factory=Peer)
    assert reloaded.permissions["phone"] == "control"
    assert not reloaded.sessions  # Permission persistence never starts capture.


@pytest.mark.asyncio
async def test_stop_during_prepare_retires_pending_session(host):
    ready = asyncio.Event()

    class Slow(Peer):
        async def prepare(self):
            ready.set()
            await asyncio.Event().wait()

    host.peer_factory = Slow
    await host.grant("phone", "control")
    await host.handle(
        "phone",
        {"method": "webrtc/request", "params": {"requestId": "slow"}},
        host.server._connections["phone"],
    )
    session = host.sessions["phone"]
    await ready.wait()
    await host.stop("phone")
    assert session.peer.closed and session.task.cancelled()


def test_turn_credentials_are_expiring_and_shared_consistently():
    env = {
        "ECHO_REMOTE_ICE_SERVERS": "[]",
        "ECHO_REMOTE_TURN_URLS": "turn:relay.test:3478,turns:relay.test:5349",
        "ECHO_REMOTE_TURN_SECRET": "test-secret",
    }
    servers = ice_servers("private-phone-id", env, now=100)
    assert has_relay(servers)
    assert servers[0]["username"].startswith("3700:")
    assert "private-phone-id" not in json.dumps(servers)
    assert servers == ice_servers("private-phone-id", env, now=100)
    with pytest.raises(ValueError):
        ice_servers("phone", {"ECHO_REMOTE_ICE_SERVERS": '[{"urls":"https://bad"}]'})


def test_unicode_units_preserve_emoji_and_native_input_validates_coordinates():
    assert unicode_units("中🌏") == [0x4E2D, 0xD83C, 0xDF0F]
    calls = []
    driver = SimpleNamespace(KEYBOARD_KEYS=["ctrl", "a"], click=lambda *a, **k: calls.append(a))
    typed = []
    control = DesktopInput(
        {"left": -1600, "top": 0, "width": 1600, "height": 900}, driver, typed.append
    )
    control.apply({"action": "type", "text": "中文🌏"})
    assert typed == ["中文🌏"]
    control.apply({"action": "tap", "x": 1, "y": 1})
    assert calls == [(-1, 899)]
    for value in (float("nan"), float("inf"), -0.1, True):
        with pytest.raises(ValueError):
            control.apply({"action": "tap", "x": value, "y": 0.5})
    with pytest.raises(ValueError):
        control.apply({"action": "key", "text": "not-a-key"})


def test_shortcut_error_releases_modifiers():
    released = []

    def hotkey(*args, **kwargs):
        raise RuntimeError("failsafe")

    driver = SimpleNamespace(
        KEYBOARD_KEYS=["ctrl", "a"],
        hotkey=hotkey,
        platformModule=SimpleNamespace(_keyUp=released.append),
    )
    control = DesktopInput({}, driver)
    with pytest.raises(RuntimeError):
        control.apply({"action": "key", "text": "ctrl+a"})
    assert released == ["a", "ctrl"]


def test_windows_unicode_builds_native_utf16_events(monkeypatch):
    import ctypes
    import sys

    if sys.platform != "win32":
        pytest.skip("Windows input ABI")
    from runtime.tentacle.remote_desktop_input import type_unicode

    received = []

    def send(count, events, size):
        assert size == (40 if ctypes.sizeof(ctypes.c_void_p) == 8 else 28)
        received.extend((e.payload.keyboard.scan, e.payload.keyboard.flags) for e in events)
        return count

    monkeypatch.setattr(ctypes, "WinDLL", lambda *a, **k: SimpleNamespace(SendInput=send))
    type_unicode("中🌏")
    assert received == [(unit, flag) for unit in [0x4E2D, 0xD83C, 0xDF0F] for flag in (4, 6)]
