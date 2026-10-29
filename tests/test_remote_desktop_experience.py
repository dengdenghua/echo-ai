"""Interaction upgrades must retain authorization, input acknowledgement and privacy."""
import json
import subprocess
from types import SimpleNamespace

import pytest

from runtime.tentacle import remote_desktop_focus as probe
from runtime.tentacle.remote_desktop_config import VIDEO_PROFILES
from tests.test_remote_desktop import host as make_host
from tests.test_remote_desktop import start, wait_for


@pytest.fixture
def host(tmp_path, monkeypatch):
    return make_host.__wrapped__(tmp_path, monkeypatch)


@pytest.mark.asyncio
async def test_optional_focus_failure_does_not_mark_successful_click_failed(host):
    session = await start(host)
    def unavailable():
        raise OSError("No accessibility service")
    session.input.focus_hint = unavailable
    try:
        session.peer.on_input(json.dumps({"sessionId": session.id, "seq": 1, "action": "tap", "x": .5, "y": .5}))
        await wait_for(lambda: session.peer.sent)
        ack = session.peer.sent[-1]
        assert ack["ok"] is True and ack["inputFocus"]["available"] is False
        session.input.focus_hint = lambda: {"available": True, "editable": True, "secure": True}
        session.peer.on_input(json.dumps({"sessionId": session.id, "seq": 2, "action": "tap", "x": .4, "y": .3}))
        await wait_for(lambda: len(session.peer.sent) == 2)
        assert session.peer.sent[-1]["inputFocus"] == {"available": True, "editable": True, "secure": True}
    finally:
        await host.shutdown()


@pytest.mark.asyncio
@pytest.mark.parametrize("quality", ["unexpected", {}, True])
async def test_invalid_quality_never_starts_capture(host, quality):
    await host.grant("phone", "control")
    ws = host.server._connections["phone"]
    await host.handle("phone", {"method": "webrtc/request", "params": {"requestId": "quality", "quality": quality}}, ws)
    assert not host.sessions
    assert ws.messages[-1]["params"]["code"] == "invalid_settings"


@pytest.mark.parametrize("quality", VIDEO_PROFILES)
@pytest.mark.asyncio
async def test_quality_is_applied_before_capture_preparation(host, quality):
    from tests.test_remote_desktop import Peer
    class ProfiledPeer(Peer):
        def configure_video(self, value): self.profile = value
        async def prepare(self):
            assert self.profile == quality
            return await super().prepare()
    host.peer_factory = ProfiledPeer
    await host.grant("phone", "view")
    try:
        await host.handle("phone", {"method": "webrtc/request", "params": {"requestId": "quality", "quality": quality}}, host.server._connections["phone"])
        session = host.sessions["phone"]
        await session.task
        assert session.quality == quality
    finally:
        await host.shutdown()


@pytest.mark.parametrize("output", [b'{"available":true,"editable":true,"secure":false,"value":"never-forward"}', b'[]', b'{', b'{"available":1,"editable":"true"}'])
def test_focus_metadata_is_strict_and_discards_all_other_fields(monkeypatch, output):
    monkeypatch.setattr(probe.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")
    calls = []
    def run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0, stdout=output)
    monkeypatch.setattr(probe.subprocess, "run", run)
    value = probe.focused_input_hint()
    assert set(value) == {"available", "editable", "secure"}
    assert all(isinstance(v, bool) for v in value.values())
    assert "--focus" in calls[0][0] and calls[0][1]["timeout"] == 2
    if b'never-forward' in output:
        assert value == {"available": True, "editable": True, "secure": False}


def test_focus_timeout_and_unsupported_display_are_unavailable(monkeypatch):
    monkeypatch.setattr(probe.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")
    def timeout(*args, **kwargs): raise subprocess.TimeoutExpired("probe", 2)
    monkeypatch.setattr(probe.subprocess, "run", timeout)
    assert not probe.focused_input_hint()["available"]
    monkeypatch.setenv("XDG_SESSION_TYPE", "wayland")
    monkeypatch.setattr(probe.subprocess, "run", lambda *args, **kwargs: pytest.fail("Wayland must not launch X11 probe"))
    assert not probe.focused_input_hint()["available"]


@pytest.mark.parametrize("quality", VIDEO_PROFILES)
def test_capture_respects_profile_without_distorting_desktop(quality):
    from PIL import Image

    from runtime.tentacle.remote_desktop_media import DesktopCapture
    source = Image.new("RGB", (2560, 1440), (10, 20, 30))
    capture = object.__new__(DesktopCapture)
    capture.geometry = {"left": -2560, "top": 0, "width": 2560, "height": 1440}
    capture.max_edge = VIDEO_PROFILES[quality][0]
    capture.screen = SimpleNamespace(grab=lambda geometry: SimpleNamespace(size=source.size, rgb=source.tobytes()))
    frame = capture.frame()
    assert max(frame.size) == capture.max_edge
    assert frame.width % 2 == frame.height % 2 == 0
    assert abs(frame.width / frame.height - 16 / 9) < .01
