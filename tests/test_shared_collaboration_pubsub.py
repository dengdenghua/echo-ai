"""Real Redis, independently served workers and transient presence contracts."""

from __future__ import annotations

import json
import multiprocessing
import os
import shutil
import socket
import sqlite3
import subprocess
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest

if os.environ.get("ECHO_REQUIRE_REDIS_TESTS") == "1":
    import redis
else:
    redis = pytest.importorskip("redis")

from runtime.memory.cowork.presence import PresenceStore  # noqa: E402
from runtime.memory.cowork.transient_presence import TransientPresence  # noqa: E402
from runtime.platform.process.shared_pubsub import RedisPubSub  # noqa: E402


def _port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def real_redis(tmp_path_factory):
    home = tmp_path_factory.mktemp("redis-service")
    port = _port()
    executable = os.environ.get("ECHO_TEST_REDIS_EXECUTABLE") or shutil.which("redis-server")
    wrapper = os.environ.get("ECHO_TEST_REDIS_WSL_WRAPPER")
    if os.name == "nt" and wrapper:
        logfile = f"/home/runner/echo-redis-pubsub122/test-{uuid4().hex}.log"
        args = [
            "wsl",
            "-d",
            "Ubuntu-24.04",
            "-u",
            "runner",
            "--",
            "bash",
            wrapper,
            str(port),
            logfile,
        ]
    elif executable:
        logfile = str(home / "redis.log")
        args = [
            executable,
            "--bind",
            "127.0.0.1",
            "--port",
            str(port),
            "--save",
            "",
            "--appendonly",
            "no",
            "--logfile",
            logfile,
        ]
    else:
        if os.environ.get("ECHO_REQUIRE_REDIS_TESTS") == "1":
            pytest.fail("required real Redis executable is missing")
        pytest.skip(
            "real Redis server not configured; set ECHO_TEST_REDIS_EXECUTABLE or ECHO_TEST_REDIS_WSL_WRAPPER"
        )
    with (home / "launcher.log").open("wb") as output:
        process = subprocess.Popen(
            args,
            stdout=output,
            stderr=subprocess.STDOUT,
            creationflags=0x08000000 if os.name == "nt" else 0,
        )
        url = f"redis://127.0.0.1:{port}/0"
        client = redis.Redis.from_url(url, decode_responses=True, socket_timeout=0.5)
        owned = False
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError((home / "launcher.log").read_text(errors="replace"))
                try:
                    if client.ping() and client.config_get("logfile").get("logfile") == logfile:
                        owned = True
                        break
                except redis.RedisError:
                    pass
                time.sleep(0.1)
            assert owned, "dedicated test Redis did not become ready"
            assert client.config_get("appendonly")["appendonly"] == "no"
            assert client.config_get("save")["save"] == ""
            yield url
        finally:
            if owned:
                client.shutdown(nosave=True)
            client.close()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)


def _wait(predicate, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    assert predicate(), "shared state did not arrive"


def test_real_pubsub_deduplicates_self_and_isolates_namespaces(real_redis):
    received, self_received, foreign = [], [], []
    namespace = uuid4().hex
    first, second = RedisPubSub(real_redis, namespace), RedisPubSub(real_redis, namespace)
    outsider = RedisPubSub(real_redis, uuid4().hex)
    try:
        first.subscribe("hint", lambda event: self_received.append(event))
        second.subscribe("hint", lambda event: received.append(event))
        outsider.subscribe("hint", lambda event: foreign.append(event))
        for bus in (first, second, outsider):
            bus.start()
        first.publish("hint", {"sequence": 1})
        _wait(lambda: len(received) == 1)
        assert not self_received and not foreign
        # Same envelope sent twice through the real broker is only delivered once.
        event = received[0]
        with redis.Redis.from_url(real_redis) as client:
            client.publish(first.channel, json.dumps(event).encode())
        first.publish("hint", {"sequence": 2})
        _wait(lambda: len(received) == 2)
        assert [event["payload"]["sequence"] for event in received] == [1, 2]
    finally:
        for bus in (first, second, outsider):
            bus.close()


def test_real_presence_warms_new_worker_without_redis_keys(real_redis, tmp_path):
    namespace = uuid4().hex
    first, second = RedisPubSub(real_redis, namespace), RedisPubSub(real_redis, namespace)
    try:
        live_first, live_second = TransientPresence(first), TransientPresence(second)
        one = PresenceStore(tmp_path / "one", live_presence=live_first)
        two = PresenceStore(tmp_path / "two", live_presence=live_second)
        one.heartbeat("thread-a", "alice")
        two.get("thread-a", "alice")
        _wait(lambda: two.get("thread-a", "alice")["last_seen_at"] is not None)
        assert two.get("thread-b", "alice")["last_seen_at"] is None
        with redis.Redis.from_url(real_redis) as client:
            assert client.dbsize() == 0
        for home in (tmp_path / "one", tmp_path / "two"):
            with sqlite3.connect(home / "presence.db") as conn:
                assert conn.execute("SELECT COUNT(*) FROM read_state").fetchone()[0] == 0
    finally:
        first.close()
        second.close()


def test_old_persisted_heartbeat_is_ignored_but_read_cursors_survive(tmp_path):
    one = PresenceStore(tmp_path)
    one.mark_read("thread-a", "alice", 7, coordinate="message")
    with sqlite3.connect(tmp_path / "presence.db") as conn:
        conn.execute("UPDATE read_state SET last_seen_at=?", (datetime.now(UTC).isoformat(),))
    assert one.get("thread-a", "alice") == {
        "last_read": 0,
        "last_read_message_seq": 7,
        "last_seen_at": None,
    }


def _api_worker(home, url, namespace, port, ready):
    import uvicorn
    from fastapi import FastAPI

    from runtime.safety.auth import Identity, IdentityStore
    from runtime.sensing.gateway.team_rooms_router import create_team_rooms_router

    identities = IdentityStore()
    for actor, tenant in (("alice", "tenant-a"), ("bob", "tenant-a"), ("outsider", "tenant-b")):
        identities.add(
            Identity(actor_id=actor, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"key-{actor}",
        )
    bus = RedisPubSub(url, namespace)
    app = FastAPI()
    app.include_router(
        create_team_rooms_router(
            state_path=Path(home) / "rooms.json",
            identity_store=identities,
            require_auth=True,
            shared_bus=bus,
        )
    )

    @app.on_event("startup")
    def started():
        bus.start()
        ready.set()

    @app.on_event("shutdown")
    def stopped():
        bus.close()

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="error")


@contextmanager
def _workers(home, url, namespace):
    ctx = multiprocessing.get_context("spawn")
    ports, workers = [_port(), _port()], []
    try:
        for port in ports:
            ready = ctx.Event()
            worker = ctx.Process(target=_api_worker, args=(str(home), url, namespace, port, ready))
            worker.start()
            workers.append(worker)
            assert ready.wait(timeout=20), "worker startup failed"
        yield ports
    finally:
        for worker in workers:
            if worker.is_alive():
                worker.terminate()
            worker.join(timeout=10)


def _frame(ws, predicate):
    observed = []
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        event = json.loads(ws.recv(timeout=max(0.1, deadline - time.monotonic())))
        observed.append(event)
        if predicate(event):
            return event, observed
    raise AssertionError(observed)


def test_two_real_workers_deliver_once_fence_tenant_and_revoke_members(real_redis, tmp_path):
    import httpx
    from websockets.exceptions import ConnectionClosed
    from websockets.sync.client import connect

    namespace = uuid4().hex
    headers = {"Authorization": "Bearer key-alice"}
    with (
        _workers(tmp_path, real_redis, namespace) as ports,
        httpx.Client(base_url=f"http://127.0.0.1:{ports[0]}", headers=headers) as api,
    ):
        room_response = api.post(
            "/api/teams", json={"name": "Shared", "members": [{"name": "agent"}]}
        )
        assert room_response.status_code == 200, room_response.text
        room_id = room_response.json()["id"]
        invite = api.post(f"/api/teams/{room_id}/invites", json={"role": "member"}).json()
        joined = api.post(
            f"/api/team-invites/{invite['invite_token']}/join",
            headers={"Authorization": "Bearer key-bob"},
            json={},
        )
        assert joined.status_code == 200, joined.text
        bob_id = joined.json()["participant"]["id"]
        assert (
            api.get(
                f"/api/teams/{room_id}", headers={"Authorization": "Bearer key-outsider"}
            ).status_code
            == 403
        )
        with connect(
            f"ws://127.0.0.1:{ports[0]}/api/teams/{room_id}/ws?participant_id=owner-alice",
            additional_headers=headers,
        ) as alice:
            _frame(alice, lambda event: event.get("type") == "ready")
            with connect(
                f"ws://127.0.0.1:{ports[1]}/api/teams/{room_id}/ws?participant_id={bob_id}",
                additional_headers={"Authorization": "Bearer key-bob"},
            ) as bob:
                _frame(bob, lambda event: event.get("type") == "ready")
                _frame(
                    alice,
                    lambda event: event.get("type") == "presence" and event.get("count") == 2,
                )
                alice.send(json.dumps({"type": "message", "text": "Across real workers"}))
                message, _ = _frame(bob, lambda event: event.get("text") == "Across real workers")
                assert message["participant_id"] == "owner-alice"
                history = api.get(f"/api/teams/{room_id}/messages").json()
                assert (
                    sum(item["text"] == "Across real workers" for item in history["messages"]) == 1
                )
                publisher = RedisPubSub(real_redis, namespace)
                try:
                    bad = {
                        "room_id": room_id,
                        "tenant_id": "tenant-b",
                        "message": {"type": "thread:update", "reason": "must-not-leak"},
                    }
                    publisher.publish("room:frame", bad)
                    publisher.publish(
                        "room:frame",
                        {
                            **bad,
                            "tenant_id": "tenant-a",
                            "message": {"type": "thread:update", "reason": "barrier"},
                        },
                    )
                    _, observed = _frame(bob, lambda event: event.get("reason") == "barrier")
                    assert not any(event.get("reason") == "must-not-leak" for event in observed)
                    assert not any(event.get("text") == "Across real workers" for event in observed)
                finally:
                    publisher.close()
                removed = api.delete(f"/api/teams/{room_id}/participants/{bob_id}")
                assert removed.status_code == 200, removed.text
                with pytest.raises(ConnectionClosed) as closed:
                    while True:
                        bob.recv(timeout=5)
                assert closed.value.rcvd.code == 4403


def test_same_member_on_other_worker_keeps_floor_after_departure(real_redis, tmp_path):
    import httpx
    from websockets.sync.client import connect

    headers = {"Authorization": "Bearer key-alice"}
    with (
        _workers(tmp_path, real_redis, uuid4().hex) as ports,
        httpx.Client(base_url=f"http://127.0.0.1:{ports[0]}", headers=headers) as api,
    ):
        response = api.post("/api/teams", json={"name": "Floor", "members": [{"name": "agent"}]})
        assert response.status_code == 200, response.text
        room_id = response.json()["id"]
        assert (
            api.patch(
                f"/api/teams/{room_id}/speaker-policy", json={"speaker_policy": "moderated"}
            ).status_code
            == 200
        )
        url = f"/api/teams/{room_id}/ws?participant_id=owner-alice"
        with connect(f"ws://127.0.0.1:{ports[0]}{url}", additional_headers=headers) as first:
            _frame(first, lambda event: event.get("type") == "ready")
            with connect(f"ws://127.0.0.1:{ports[1]}{url}", additional_headers=headers) as second:
                _frame(second, lambda event: event.get("type") == "ready")
                _frame(
                    first,
                    lambda event: event.get("type") == "presence" and event.get("count") == 1,
                )
                first.send(json.dumps({"type": "floor:grant", "target": "owner-alice"}))
                _frame(
                    second,
                    lambda event: (
                        event.get("type") == "floor"
                        and event.get("current_speaker_id") == "owner-alice"
                    ),
                )
                first.close()
                _frame(
                    second,
                    lambda event: event.get("type") == "presence" and event.get("count") == 1,
                )
                room = api.get(f"/api/teams/{room_id}").json()
                assert room["current_speaker_id"] == "owner-alice"
                assert (
                    next(p for p in room["participants"] if p["id"] == "owner-alice")["status"]
                    == "active"
                )
                second.send(json.dumps({"type": "message", "text": "Still holding the floor"}))
                _frame(second, lambda event: event.get("text") == "Still holding the floor")
            _wait(lambda: api.get(f"/api/teams/{room_id}").json()["current_speaker_id"] is None)


def test_canonical_deletion_closes_other_worker_socket(real_redis, tmp_path):
    import httpx
    from websockets.exceptions import ConnectionClosed
    from websockets.sync.client import connect

    headers = {"Authorization": "Bearer key-alice"}
    namespace = uuid4().hex
    with (
        _workers(tmp_path, real_redis, namespace) as ports,
        httpx.Client(base_url=f"http://127.0.0.1:{ports[0]}", headers=headers) as api,
    ):
        response = api.post("/api/teams", json={"name": "Deleted", "members": [{"name": "agent"}]})
        assert response.status_code == 200
        room_id = response.json()["id"]
        with connect(
            f"ws://127.0.0.1:{ports[1]}/api/teams/{room_id}/ws?participant_id=owner-alice",
            additional_headers=headers,
        ) as ws:
            _frame(ws, lambda event: event.get("type") == "ready")
            _frame(ws, lambda event: event.get("type") == "presence")
            publisher = RedisPubSub(real_redis, namespace)
            try:
                publisher.publish(
                    "room:frame",
                    {
                        "room_id": room_id,
                        "tenant_id": "tenant-a",
                        "message": {"type": "team:deleted"},
                    },
                )
                publisher.publish(
                    "room:frame",
                    {
                        "room_id": room_id,
                        "tenant_id": "tenant-a",
                        "message": {"type": "thread:update", "reason": "still-exists"},
                    },
                )
                _frame(ws, lambda event: event.get("reason") == "still-exists")
            finally:
                publisher.close()
            assert api.delete(f"/api/teams/{room_id}").status_code == 200
            with pytest.raises(ConnectionClosed) as closed:
                while True:
                    ws.recv(timeout=5)
            assert closed.value.rcvd.code == 4403
            assert api.get(f"/api/teams/{room_id}").status_code == 403
            assert api.get("/api/teams").json()["teams"] == []


def test_future_heartbeat_cannot_remain_online_after_monotonic_ttl(tmp_path, monkeypatch):
    from runtime.memory.cowork import transient_presence as module
    from runtime.memory.cowork.group import MemberEvent
    from runtime.memory.cowork.group_store import GroupStore
    from runtime.memory.cowork.presence import group_presence

    clock = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    store, group = PresenceStore(tmp_path), GroupStore(tmp_path)
    group.append(
        "thread-a",
        MemberEvent(action="invite", actor="owner", target_id="alice", target_kind="human"),
    )
    store.heartbeat("thread-a", "alice", now="2030-01-01T00:00:00+00:00")
    assert group_presence(group, store, "thread-a")[0].online
    clock[0] = 161
    assert not group_presence(group, store, "thread-a")[0].online


def _read_after_restart(home, connection):
    try:
        connection.send(PresenceStore(home).get("thread-a", "alice"))
    finally:
        connection.close()


def test_heartbeat_never_writes_and_real_process_restart_only_keeps_cursors(tmp_path):
    store = PresenceStore(tmp_path)
    store.mark_read("thread-a", "alice", 8)
    store.mark_read("thread-a", "alice", 13, coordinate="message")
    with sqlite3.connect(tmp_path / "presence.db") as conn:
        for action in ("INSERT", "UPDATE", "DELETE"):
            conn.execute(
                f"CREATE TRIGGER no_{action.lower()} BEFORE {action} ON read_state BEGIN SELECT RAISE(ABORT, 'no heartbeat writes'); END"
            )
    for _ in range(20):
        store.heartbeat("thread-a", "alice")
    assert store.get("thread-a", "alice")["last_seen_at"] is not None
    context = multiprocessing.get_context("spawn")
    reader, writer = context.Pipe(duplex=False)
    worker = context.Process(target=_read_after_restart, args=(str(tmp_path), writer))
    try:
        worker.start()
        writer.close()
        assert reader.poll(15)
        assert reader.recv() == {"last_read": 8, "last_read_message_seq": 13, "last_seen_at": None}
        worker.join(timeout=10)
        assert worker.exitcode == 0
    finally:
        reader.close()
        if worker.is_alive():
            worker.terminate()
            worker.join(timeout=5)


def test_presence_replay_cannot_renew_ttl_or_resurrect_departed_member(monkeypatch):
    from runtime.memory.cowork import transient_presence as module

    clock = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    live = TransientPresence()
    origin = uuid4().hex
    item = {
        "member_id": "alice",
        "last_seen_at": datetime.now(UTC).isoformat(),
        "online": True,
        "revision": 1,
    }
    live._apply(origin, "cowork", "thread", [item], complete=False, revision=1)
    clock[0] = 159
    live._apply(origin, "cowork", "thread", [item], complete=False, revision=1)
    clock[0] = 161
    assert not live.values("cowork", "thread")["alice"]["online"]
    live._apply(origin, "cowork", "thread", [], complete=True, revision=2)
    live._apply(origin, "cowork", "thread", [item], complete=False, revision=1)
    assert not live.values("cowork", "thread")["alice"]["online"]
    live._apply(origin, "cowork", "thread", [{**item, "revision": 3}], complete=False, revision=3)
    assert live.values("cowork", "thread")["alice"]["online"]
    assert live.values("cowork", "other") == {}
    assert live.values("room", "thread") == {}


@pytest.mark.parametrize(
    "mutation",
    [
        {"version": True},
        {"version": 2},
        {"namespace": "foreign"},
        {"origin": "bad"},
        {"event_id": "bad"},
        {"kind": []},
        {"payload": []},
    ],
)
def test_malformed_shared_envelope_is_rejected(real_redis, mutation):
    bus = RedisPubSub(real_redis, uuid4().hex)
    try:
        event = {
            "version": 1,
            "namespace": bus.namespace,
            "origin": uuid4().hex,
            "event_id": uuid4().hex,
            "kind": "hint",
            "payload": {},
        }
        assert bus._decode(json.dumps(event).encode()) == event
        assert bus._decode(json.dumps({**event, **mutation}).encode()) is None
        assert bus._decode(b"x" * (256 * 1024 + 1)) is None
        assert bus._decode(json.dumps({**event, "origin": bus.origin}).encode()) is None
    finally:
        bus.close()


def test_actual_subscription_reconnect_warms_presence_again(real_redis, tmp_path):
    first, second = (RedisPubSub(real_redis, namespace) for namespace in [uuid4().hex] * 2)
    try:
        one = PresenceStore(tmp_path / "first", live_presence=TransientPresence(first))
        two = PresenceStore(tmp_path / "second", live_presence=TransientPresence(second))
        one.heartbeat("thread-a", "alice")
        _wait(lambda: two.get("thread-a", "alice")["last_seen_at"] is not None)
        generation = second.generation
        with redis.Redis.from_url(real_redis) as client:
            assert client.execute_command("CLIENT", "KILL", "TYPE", "PUBSUB") >= 2
        _wait(lambda: second.generation > generation and second.connected)
        # A reconnected worker must request a new snapshot, even if it warmed before.
        two.get("thread-a", "alice")
        assert two._live._requested_generation == second.generation
        one.heartbeat("thread-a", "alice", now="2030-01-01T00:00:00+00:00")
        _wait(lambda: two.get("thread-a", "alice")["last_seen_at"] == "2030-01-01T00:00:00+00:00")
    finally:
        first.close()
        second.close()


def test_application_realtime_configuration_and_lifecycle(real_redis):
    from types import SimpleNamespace

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from pydantic import ValidationError

    from runtime.platform.config.schema import CollaborationRealtimeConfig
    from runtime.platform.ui._app_context import AppContext
    from runtime.platform.ui._app_realtime import configure_collaboration_realtime

    with pytest.raises(ValidationError):
        CollaborationRealtimeConfig(require_distributed=True)
    with pytest.raises(ValidationError):
        CollaborationRealtimeConfig(backend="redis", redis_url=real_redis)
    settings = CollaborationRealtimeConfig(
        backend="redis", redis_url=real_redis, namespace=uuid4().hex, require_distributed=True
    )
    app = FastAPI()
    ctx = AppContext(
        app=app, stack=SimpleNamespace(config=SimpleNamespace(collaboration_realtime=settings))
    )
    configure_collaboration_realtime(ctx)
    assert ctx.live_presence.bus is ctx.shared_realtime
    with TestClient(app):
        assert app.state.collaboration_realtime.connected
    assert not ctx.shared_realtime.connected
    assert not ctx.shared_realtime._reader.is_alive()
    assert not ctx.shared_realtime._dispatcher.is_alive()


def test_configured_unavailable_broker_fails_startup_and_stops_threads():
    from types import SimpleNamespace

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from runtime.platform.config.schema import CollaborationRealtimeConfig
    from runtime.platform.process.shared_pubsub import SharedPubSubUnavailable
    from runtime.platform.ui._app_context import AppContext
    from runtime.platform.ui._app_realtime import configure_collaboration_realtime

    settings = CollaborationRealtimeConfig(
        backend="redis",
        redis_url=f"redis://127.0.0.1:{_port()}",
        namespace=uuid4().hex,
        connect_timeout_seconds=0.1,
    )
    ctx = AppContext(
        app=FastAPI(),
        stack=SimpleNamespace(config=SimpleNamespace(collaboration_realtime=settings)),
    )
    configure_collaboration_realtime(ctx)
    with (
        pytest.raises(SharedPubSubUnavailable, match="subscription is unavailable"),
        TestClient(ctx.app),
    ):
        pytest.fail("configured shared service silently started without a broker")
    assert not ctx.shared_realtime._reader.is_alive()
    assert not ctx.shared_realtime._dispatcher.is_alive()


def test_local_application_mode_does_not_import_optional_redis(monkeypatch):
    import builtins

    from fastapi import FastAPI

    from runtime.platform.ui._app_context import AppContext
    from runtime.platform.ui._app_realtime import configure_collaboration_realtime

    original = builtins.__import__

    def guarded(name, *args, **kwargs):
        if name == "redis":
            raise ImportError("optional Redis client absent")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded)
    ctx = AppContext(app=FastAPI())
    configure_collaboration_realtime(ctx)
    assert ctx.shared_realtime is None and ctx.live_presence.bus is None
    ctx.live_presence.record("cowork", "thread", "alice", datetime.now(UTC).isoformat())
    assert ctx.live_presence.values("cowork", "thread")["alice"]["online"]


def test_full_app_passes_one_transport_to_room_and_cowork_presence(
    real_redis, tmp_path, monkeypatch
):
    from types import SimpleNamespace

    from fastapi.testclient import TestClient

    from runtime.execution.agents import AgentRegistry
    from runtime.platform.config.schema import CollaborationRealtimeConfig
    from runtime.platform.ui.app import create_app
    from runtime.sensing.model_router import MockModelRouter

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ECHO_HOME", str(tmp_path))
    monkeypatch.setattr("runtime.execution.agents.watcher.start_agent_watcher", lambda **_: None)
    settings = CollaborationRealtimeConfig(
        backend="redis", redis_url=real_redis, namespace=uuid4().hex
    )
    stack = SimpleNamespace(
        journal=None,
        executor=SimpleNamespace(journal=None, registry=None),
        runtime=SimpleNamespace(journal=None),
        planner=SimpleNamespace(router=MockModelRouter(), planner_model=None),
        config=SimpleNamespace(mcp_servers=None, collaboration_realtime=settings),
        is_llm_planner=False,
    )
    app = create_app(stack=stack, agent_registry=AgentRegistry(), tentacle_enabled=False)
    assert app.state.team_rooms_router.live_presence is app.state.live_presence
    with TestClient(app) as client:
        response = client.post("/api/cowork/thread-a/heartbeat", json={"member_id": "alice"})
        assert response.status_code == 200, response.text
        assert app.state.live_presence.values("cowork", "thread-a")["alice"]["online"]
        assert app.state.live_presence.bus is app.state.collaboration_realtime
        assert client.get("/api/teams").status_code == 200
    assert not app.state.collaboration_realtime.connected


def test_slow_consumer_has_bounded_queue_and_oversized_frame_is_refused(real_redis):
    import threading

    bus = RedisPubSub(real_redis, uuid4().hex)
    entered, release = threading.Event(), threading.Event()
    received = []

    def consumer(event):
        if event["payload"]["sequence"] == 0:
            entered.set()
            assert release.wait(timeout=5)
        received.append(event["payload"]["sequence"])

    def encoded(sequence):
        return json.dumps(
            {
                "version": 1,
                "namespace": bus.namespace,
                "origin": origin,
                "event_id": uuid4().hex,
                "kind": "hint",
                "payload": {"sequence": sequence},
            }
        ).encode()

    origin = uuid4().hex
    try:
        bus.subscribe("hint", consumer)
        bus.start()
        with redis.Redis.from_url(real_redis) as client:
            client.publish(bus.channel, encoded(0))
            assert entered.wait(timeout=5)
            with client.pipeline() as batch:
                for sequence in range(1, 701):
                    batch.publish(bus.channel, encoded(sequence))
                batch.execute()
            _wait(lambda: bus._pending.qsize() == 256 and bus.dropped_events > 0)
            with pytest.raises(ValueError, match="frame limit"):
                bus.publish("hint", {"text": "x" * (256 * 1024)})
            release.set()
            _wait(lambda: bus._pending.empty())
            client.publish(bus.channel, encoded(-1))
            _wait(lambda: -1 in received)
        assert len(received) < 702
        assert received[:-1] == sorted(set(received[:-1]))
    finally:
        release.set()
        bus.close()


def test_lost_shared_publisher_preserves_local_heartbeat_and_durable_read_state(
    real_redis, tmp_path, monkeypatch
):
    bus = RedisPubSub(real_redis, uuid4().hex)
    try:
        store = PresenceStore(tmp_path, live_presence=TransientPresence(bus))
        store.mark_read("thread", "alice", 19)
        store.get("thread", "alice")

        def unavailable(*args, **kwargs):
            raise redis.ConnectionError("injected publisher disconnect")

        monkeypatch.setattr(bus._client, "publish", unavailable)
        store.heartbeat("thread", "alice")
        assert store.get("thread", "alice")["last_read"] == 19
        assert store.get("thread", "alice")["last_seen_at"] is not None
        assert store.online_members("thread") == {"alice"}
        with sqlite3.connect(tmp_path / "presence.db") as conn:
            assert conn.execute("SELECT last_seen_at FROM read_state").fetchone()[0] is None
    finally:
        bus.close()


def test_failed_first_snapshot_request_can_retry_and_find_existing_peer(
    real_redis, tmp_path, monkeypatch
):
    namespace = uuid4().hex
    first, second = RedisPubSub(real_redis, namespace), RedisPubSub(real_redis, namespace)
    try:
        one = PresenceStore(tmp_path / "first", live_presence=TransientPresence(first))
        two = PresenceStore(tmp_path / "second", live_presence=TransientPresence(second))
        one.heartbeat("thread", "alice")
        original = second._client.publish

        def unavailable(*args, **kwargs):
            raise redis.ConnectionError("injected first snapshot failure")

        monkeypatch.setattr(second._client, "publish", unavailable)
        assert two.get("thread", "alice")["last_seen_at"] is None
        monkeypatch.setattr(second._client, "publish", original)
        _wait(
            lambda: (
                two.get("thread", "alice")["last_seen_at"]
                == one.get("thread", "alice")["last_seen_at"]
            )
        )
    finally:
        first.close()
        second.close()
