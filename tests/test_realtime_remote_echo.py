"""SSH / WSL work locations: transport registry, picker listing and turn relay."""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.engines import EngineId, ExecutionRoute
from runtime.platform import feature_flags as ff
from runtime.protocol.items import AgentMessageItem, CommandExecutionItem
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.realtime_remote_echo import (
    REMOTE_LOCATION_REASON,
    drive_remote_echo,
    remote_work_location,
)
from runtime.sensing.gateway.remote_backends_router import create_remote_backends_router
from runtime.sensing.gateway.remote_transport import (
    BackendRegistry,
    RemoteBackend,
    SshTunnel,
    WslTarget,
    connect_remote_backend,
)
from runtime.sensing.gateway.work_locations import parse_wsl_list, remote_connections


@pytest.fixture(autouse=True)
def _remote_transport_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("ECHO_FF_UI_REMOTE_TRANSPORT", "1")
    ff.reload()
    yield
    monkeypatch.delenv("ECHO_FF_UI_REMOTE_TRANSPORT", raising=False)
    ff.reload()


# ─── WSL transport ─────────────────────────────────────────


def test_wsl_connection_persists_and_is_loopback_only(tmp_path: Path) -> None:
    registry = BackendRegistry(tmp_path / "remote_backends.json")
    added = registry.add(
        name="Ubuntu", url="http://127.0.0.1:8320", wsl=WslTarget(distro="Ubuntu-24.04")
    )

    reloaded = BackendRegistry(tmp_path / "remote_backends.json").get(added.id)
    assert reloaded is not None and reloaded.wsl == WslTarget(distro="Ubuntu-24.04")
    assert reloaded.to_dict()["transport"] == "wsl"
    with pytest.raises(ValueError, match="loopback"):
        registry.add(name="Far", url="http://10.0.0.5:8320", wsl=WslTarget(distro="Ubuntu"))
    with pytest.raises(ValueError, match="either"):
        registry.add(
            name="Both",
            url="http://127.0.0.1:8321",
            wsl=WslTarget(distro="Ubuntu"),
            ssh=SshTunnel(host="box"),
        )


def test_wsl_connection_is_trusted_loopback_without_a_tunnel() -> None:
    backend = RemoteBackend(
        id="w", name="Ubuntu", url="http://127.0.0.1:8320", wsl=WslTarget(distro="Ubuntu")
    )
    with connect_remote_backend(backend) as connected:
        assert connected.tunnel_active is True and connected.url == backend.url


@pytest.mark.parametrize("distro", ["", "-rm", "a b", "x" * 70, "Ubuntu;rm"])
def test_wsl_target_rejects_unsafe_names(distro: str) -> None:
    assert WslTarget.from_dict({"distro": distro}) is None


def test_parse_wsl_list_reads_name_state_version_and_default() -> None:
    text = (
        "  NAME            STATE           VERSION\n"
        "* Ubuntu-24.04    Stopped         2\n"
        "  Debian          Running         1\n"
    )
    assert parse_wsl_list(text) == [
        {"name": "Ubuntu-24.04", "state": "stopped", "version": 2, "default": True},
        {"name": "Debian", "state": "running", "version": 1, "default": False},
    ]


def test_picker_lists_only_ssh_and_wsl_connections(tmp_path: Path) -> None:
    registry = BackendRegistry(tmp_path / "remote_backends.json")
    registry.add(name="Direct", url="https://echo.example.com")
    registry.add(
        name="Lab",
        url="http://127.0.0.1:8310",
        ssh=SshTunnel(host="lab.example.com", user="me", port=2222),
    )
    registry.add(name="Ubuntu", url="http://127.0.0.1:8320", wsl=WslTarget(distro="Ubuntu"))

    listed = {c["name"]: c for c in remote_connections(registry)}

    assert set(listed) == {"Lab", "Ubuntu"}
    assert listed["Lab"]["transport"] == "ssh_tunnel"
    assert listed["Lab"]["target"] == "me@lab.example.com:2222"
    assert listed["Ubuntu"]["transport"] == "wsl" and listed["Ubuntu"]["target"] == "Ubuntu"


# ─── Router ────────────────────────────────────────────────


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    app = FastAPI()
    app.include_router(create_remote_backends_router(store_path=tmp_path / "rb.json"))
    return TestClient(app)


def test_router_adds_a_wsl_connection_and_rejects_non_loopback(client: TestClient) -> None:
    ok = client.post(
        "/api/remote-backends",
        json={"name": "Ubuntu", "url": "http://127.0.0.1:8320", "wsl": {"distro": "Ubuntu"}},
    )
    assert ok.status_code == 200 and ok.json()["backend"]["transport"] == "wsl"
    bad = client.post(
        "/api/remote-backends",
        json={"name": "Far", "url": "http://192.168.1.5:8320", "wsl": {"distro": "Ubuntu"}},
    )
    assert bad.status_code == 400


def test_router_tests_an_unsaved_connection(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[tuple[str, bool, str | None]] = []

    def fake_health(backend: RemoteBackend, *, auth_token: str | None = None, **_: Any):
        seen.append((backend.url, backend.tunnel_active, auth_token))
        return "ok", None

    monkeypatch.setattr("runtime.sensing.gateway.remote_backends_router.health_check", fake_health)

    response = client.post(
        "/api/remote-backends/test",
        json={"url": "http://127.0.0.1:8320", "wsl": {"distro": "Ubuntu"}, "auth_token": "t"},
    )

    assert response.json() == {"status": "ok", "detail": None}
    assert seen == [("http://127.0.0.1:8320", True, "t")]
    assert client.get("/api/remote-backends").json()["backends"] == []


# ─── Relay driver ──────────────────────────────────────────


def test_remote_location_parsing() -> None:
    assert remote_work_location({}) is None
    assert remote_work_location({"work_location": {"kind": "node"}}) is None
    assert remote_work_location({"work_location": {"kind": "remote", "backend_id": "a" * 32}}) == (
        "a" * 32
    )
    with pytest.raises(ValueError):
        remote_work_location({"work_location": {"kind": "remote", "backend_id": "../x"}})


def test_remote_route_keeps_every_phase_on_the_relay() -> None:
    route = ExecutionRoute(EngineId.ECHO, "remote_echo", REMOTE_LOCATION_REASON)
    assert {route.driver_for(phase) for phase in ("initial", "continuation", "resume")} == {
        "remote_echo"
    }


class _Upstream:
    """A remote realtime gateway that plays a scripted turn."""

    def __init__(self, script: list[dict[str, Any]]):
        self.script = list(script)
        self.sent: list[dict[str, Any]] = []
        self.ready = asyncio.Event()

    async def send(self, frame: str) -> None:
        message = json.loads(frame)
        self.sent.append(message)
        if message.get("method") == "turn/start":
            self.ready.set()

    async def recv(self) -> str:
        await self.ready.wait()
        while not self.script:
            await asyncio.sleep(0.01)
        step = self.script.pop(0)
        if callable(step):
            step = step(self)
        return json.dumps(step)


class _Runtime:
    def __init__(self) -> None:
        self.events: list[tuple[str, Any]] = []
        self.steering: list[bool] = []
        self._require_auth = False
        self._identity_store = None

    def _set_turn_steering_accepting(self, _turn: Any, value: bool) -> None:
        self.steering.append(value)

    async def _emit_item_started(self, _turn, _log, _emitter, item) -> None:
        self.events.append(("started", item.model_copy()))

    async def _emit_item_completed(self, _turn, _log, _emitter, item) -> None:
        self.events.append(("completed", item.model_copy()))


class _Emitter:
    def __init__(self) -> None:
        self.notified: list[tuple[str, dict[str, Any]]] = []
        self.approvals: list[tuple[str, dict[str, Any]]] = []
        self.interrupted = False

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        self.notified.append((method, params))

    async def request_approval(self, method: str, params: dict[str, Any]) -> Any:
        self.approvals.append((method, params))
        return {"action": "accept"}

    def is_turn_interrupted(self, _turn_id: str) -> bool:
        return self.interrupted


@pytest.fixture
def relay_setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    registry = BackendRegistry(tmp_path / "remote_backends.json")
    backend = registry.add(
        name="实验室", url="http://127.0.0.1:8310", ssh=SshTunnel(host="lab"), auth_token="tok"
    )
    monkeypatch.setattr("runtime.sensing.gateway.realtime_remote_echo._registry", lambda: registry)
    turn = SimpleNamespace(
        id="local-turn",
        thread_id="thread-1",
        params=SimpleNamespace(approval_policy="on-request", owner_actor_id="alice"),
        items=[],
    )
    intent = SimpleNamespace(
        user_context={"work_location": {"kind": "remote", "backend_id": backend.id}}
    )
    return registry, backend, turn, intent


def _opener(upstream: _Upstream, opened: list[tuple[str, str | None]]):
    @contextlib.asynccontextmanager
    async def open_upstream(backend: RemoteBackend, token: str | None):
        opened.append((backend.name, token))
        yield upstream

    return open_upstream


def _message(item_id: str, text: str, status: str) -> dict[str, Any]:
    return {"type": "agentMessage", "id": item_id, "text": text, "status": status}


def test_relay_mirrors_remote_items_deltas_and_approvals(relay_setup) -> None:
    _, _, turn, intent = relay_setup
    command = {
        "type": "commandExecution",
        "id": "cmd-1",
        "command": "ls",
        "cwd": "/home/me",
        "status": "inProgress",
    }
    remote = {"threadId": "thread-1", "turnId": "remote-turn"}
    upstream = _Upstream(
        [
            {
                "jsonrpc": "2.0",
                "method": "turn/started",
                "params": {"threadId": "thread-1", "turn": {"id": "remote-turn"}},
            },
            {
                "jsonrpc": "2.0",
                "method": "item/started",
                "params": {**remote, "item": {"type": "userMessage", "id": "u1", "content": []}},
            },
            {
                "jsonrpc": "2.0",
                "id": 99,
                "method": "item/commandExecution/requestApproval",
                "params": {**remote, "itemId": "cmd-1"},
            },
            {"jsonrpc": "2.0", "method": "item/started", "params": {**remote, "item": command}},
            {
                "jsonrpc": "2.0",
                "method": "item/completed",
                "params": {**remote, "item": {**command, "status": "completed"}},
            },
            {
                "jsonrpc": "2.0",
                "method": "item/started",
                "params": {**remote, "item": _message("m1", "", "inProgress")},
            },
            {
                "jsonrpc": "2.0",
                "method": "item/agentMessage/delta",
                "params": {**remote, "itemId": "m1", "delta": "你好"},
            },
            {
                "jsonrpc": "2.0",
                "method": "item/completed",
                "params": {**remote, "item": _message("m1", "你好", "completed")},
            },
            {"jsonrpc": "2.0", "id": 1, "result": {"id": "remote-turn", "status": "completed"}},
        ]
    )
    opened: list[tuple[str, str | None]] = []
    runtime, emitter = _Runtime(), _Emitter()

    asyncio.run(
        drive_remote_echo(
            runtime,
            turn,
            None,
            emitter,
            intent,
            text="列一下目录",
            open_upstream=_opener(upstream, opened),
        )
    )

    assert opened == [("实验室", "tok")] and runtime.steering == [False]
    start = upstream.sent[0]
    assert start["method"] == "turn/start"
    assert start["params"]["threadId"] == "thread-1"
    assert start["params"]["input"] == [{"type": "text", "text": "列一下目录"}]
    # The user's message is already local; only the remote's work is mirrored.
    assert [(kind, type(item).__name__) for kind, item in runtime.events] == [
        ("started", "CommandExecutionItem"),
        ("completed", "CommandExecutionItem"),
        ("started", "AgentMessageItem"),
        ("completed", "AgentMessageItem"),
    ]
    assert isinstance(turn.items[0], CommandExecutionItem) and turn.items[0].status == "completed"
    assert isinstance(turn.items[1], AgentMessageItem) and turn.items[1].text == "你好"
    assert emitter.notified == [
        (
            "item/agentMessage/delta",
            {"threadId": "thread-1", "turnId": "local-turn", "itemId": "m1", "delta": "你好"},
        )
    ]
    # Approvals reach the local user with local ids; the answer goes back.
    assert emitter.approvals == [
        (
            "item/commandExecution/requestApproval",
            {"threadId": "thread-1", "turnId": "local-turn", "itemId": "cmd-1"},
        )
    ]
    assert {"jsonrpc": "2.0", "id": 99, "result": {"action": "accept"}} in upstream.sent


def test_relay_forwards_a_local_stop_to_the_remote_turn(relay_setup) -> None:
    _, _, turn, intent = relay_setup
    emitter = _Emitter()

    def stop_then_finish(upstream: _Upstream) -> dict[str, Any]:
        emitter.interrupted = True
        return {"jsonrpc": "2.0", "method": "turn/heartbeat", "params": {"turnId": "remote-turn"}}

    def finish_after_interrupt(upstream: _Upstream) -> dict[str, Any]:
        assert any(m.get("method") == "turn/interrupt" for m in upstream.sent)
        return {"jsonrpc": "2.0", "id": 1, "result": {"status": "interrupted"}}

    upstream = _Upstream(
        [
            {"jsonrpc": "2.0", "method": "turn/started", "params": {"turn": {"id": "remote-turn"}}},
            stop_then_finish,
            finish_after_interrupt,
        ]
    )

    asyncio.run(
        drive_remote_echo(
            _Runtime(), turn, None, emitter, intent, text="x", open_upstream=_opener(upstream, [])
        )
    )

    interrupt = next(m for m in upstream.sent if m.get("method") == "turn/interrupt")
    assert interrupt["params"] == {"threadId": "thread-1", "turnId": "remote-turn"}


def test_relay_reports_a_remote_error(relay_setup) -> None:
    _, _, turn, intent = relay_setup
    upstream = _Upstream([{"jsonrpc": "2.0", "id": 1, "error": {"code": -1, "message": "boom"}}])
    with pytest.raises(RuntimeError, match="实验室.*boom"):
        asyncio.run(
            drive_remote_echo(
                _Runtime(),
                turn,
                None,
                _Emitter(),
                intent,
                text="x",
                open_upstream=_opener(upstream, []),
            )
        )


def test_relay_requires_an_operator_when_auth_is_on(relay_setup) -> None:
    _, _, turn, intent = relay_setup
    store = IdentityStore()
    store.add(Identity(actor_id="alice", roles=("user",)), api_key_plaintext="sk-a")
    runtime = _Runtime()
    runtime._require_auth, runtime._identity_store = True, store
    upstream = _Upstream([])
    opened: list[Any] = []
    with pytest.raises(PermissionError):
        asyncio.run(
            drive_remote_echo(
                runtime,
                turn,
                None,
                _Emitter(),
                intent,
                text="x",
                open_upstream=_opener(upstream, opened),
            )
        )
    assert opened == []
