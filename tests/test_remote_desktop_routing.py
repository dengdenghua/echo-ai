"""Staged ICE configuration and lifecycle; no native capture or public services."""

import json

import pytest

from runtime.tentacle.remote_desktop_config import has_relay, servers_for_mode
from tests.test_remote_desktop import host, start  # noqa: F401

SERVERS = [
    {
        "urls": ["stun:example.test:3478", "turn:example.test:3478", "turns:example.test:5349"],
        "username": "temporary-user",
        "credential": "temporary-password",
    }
]


def test_direct_stage_excludes_turn_without_mutating_shared_configuration():
    before = json.dumps(SERVERS)
    direct = servers_for_mode(SERVERS, "direct")
    assert direct[0]["urls"] == ["stun:example.test:3478"]
    assert not has_relay(direct)
    assert json.dumps(SERVERS) == before
    relay = servers_for_mode(SERVERS, "relay")
    assert relay[0]["urls"] == ["turn:example.test:3478", "turns:example.test:5349"]
    assert relay[0]["credential"] == "temporary-password"
    assert servers_for_mode(SERVERS, "auto") == SERVERS
    assert servers_for_mode([], "relay") == []


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["direct", "relay", "auto"])
async def test_host_negotiates_only_requested_stage(host, monkeypatch, mode):  # noqa: F811
    monkeypatch.setenv("ECHO_REMOTE_ICE_SERVERS", json.dumps(SERVERS))
    await host.grant("phone", "view")
    ws = host.server._connections["phone"]
    try:
        await host.handle(
            "phone",
            {
                "method": "webrtc/request",
                "params": {
                    "requestId": "routing-test",
                    "iceMode": mode,
                },
            },
            ws,
        )
        session = host.sessions["phone"]
        await session.task
        offer = ws.messages[-1]["params"]
        assert offer["iceMode"] == mode
        assert offer["iceServers"] == servers_for_mode(SERVERS, mode)
        assert host.status("phone")["connectionStages"] == ["direct", "turn", "wss"]
    finally:
        await host.shutdown()


@pytest.mark.asyncio
async def test_missing_turn_fails_before_capture_and_keeps_existing_session(host):  # noqa: F811
    await host.grant("phone", "view")
    ws = host.server._connections["phone"]
    await host.handle(
        "phone",
        {
            "method": "webrtc/request",
            "params": {
                "requestId": "turn-test",
                "iceMode": "relay",
            },
        },
        ws,
    )
    assert ws.messages[-1]["params"] == {"code": "turn_unavailable", "requestId": "turn-test"}
    assert not host.sessions
    assert host.status("phone")["connectionStages"] == ["direct", "wss"]


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["unrecognized", {}, [], 5])
async def test_invalid_stage_does_not_start_capture(host, mode):  # noqa: F811
    await host.grant("phone", "view")
    ws = host.server._connections["phone"]
    await host.handle(
        "phone",
        {
            "method": "webrtc/request",
            "params": {
                "requestId": "invalid-test",
                "iceMode": mode,
            },
        },
        ws,
    )
    assert ws.messages[-1]["params"]["code"] == "invalid_settings"
    assert not host.sessions


@pytest.mark.asyncio
async def test_selected_route_telemetry_is_session_bound_and_never_grants_control(host):  # noqa: F811
    session = await start(host, mode="view")
    try:
        assert host.status()["active"][0]["connectionPath"] == "unknown"
        host._input(
            session, json.dumps({"sessionId": "stale", "action": "connection_path", "path": "turn"})
        )
        assert session.connection_path == "unknown"
        for path in ["direct", "turn", "unknown"]:
            host._input(
                session,
                json.dumps({"sessionId": session.id, "action": "connection_path", "path": path}),
            )
            assert host.status()["active"][0]["connectionPath"] == path
        host._input(
            session,
            json.dumps({"sessionId": session.id, "action": "connection_path", "path": "wss"}),
        )
        assert session.connection_path == "unknown"
        assert session.permission == "view" and session.queue.empty() and session.input is None
    finally:
        await host.shutdown()
