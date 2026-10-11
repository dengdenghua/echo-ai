"""Real independent HTTP backends sharing canonical task and room state."""

from __future__ import annotations

import json
import os
import socket
import time
from contextlib import contextmanager
from multiprocessing import get_context
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from runtime.memory.cowork.collaboration_store import CollaborationStore


def _serve(base_dir, home, ready, started, cancelled, release):
    os.environ["ECHO_HOME"] = home
    os.environ["ECHO_DATA_DIR"] = str(Path(home) / "data")
    import uvicorn
    from fastapi import FastAPI

    from runtime.safety.approval.cancellation import current_cancellation_token
    from runtime.safety.auth.identity import Identity, IdentityStore
    from runtime.sensing.gateway.team_rooms_router import create_team_rooms_router
    from runtime.sensing.gateway.team_tasks_router import create_team_tasks_router

    class ControlledRunner:
        def __init__(self, **kwargs):
            pass

        def run(self, topology, task, *, context=None):
            token = current_cancellation_token()
            started.set()
            deadline = time.monotonic() + 30
            while not release.wait(0.025):
                if token.is_cancelled:
                    cancelled.set()
                assert time.monotonic() < deadline, "owned runner was not released"
            return SimpleNamespace(
                success=True,
                final_output="late fixture output",
                role_outputs=[],
                iterations=1,
                total_duration_ms=1,
                error="",
            )

    identity = IdentityStore()
    identity.add(
        Identity(actor_id="alice", metadata={"tenant_id": "tenant-acme"}),
        api_key_plaintext="sk-test-alice",
    )
    base = Path(base_dir)
    store = CollaborationStore(base / "cowork")
    app = FastAPI()
    rooms = create_team_rooms_router(
        state_path=base / "rooms.json",
        identity_store=identity,
        require_auth=True,
        room_projection=store.upsert_room_by_id,
        room_delete_projection=store.delete_room_by_id,
    )
    app.include_router(rooms)
    app.include_router(
        create_team_tasks_router(
            state_path=base / "tasks.json",
            collaboration_store=store,
            workspace_root=base / "workspaces",
            identity_store=identity,
            require_auth=True,
            runner_factory=ControlledRunner,
            room_membership_resolver=rooms.list_room_members,
            room_participant_resolver=rooms.get_room_participant,
            max_concurrent_runs=1,
            heartbeat_interval_seconds=0.05,
        )
    )
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    ready.put(listener.getsockname()[1])
    uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False)).run(sockets=[listener])


def _request(port, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        method=method,
        headers={"Authorization": "Bearer sk-test-alice", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read())
    except HTTPError as exc:
        return exc.code, json.loads(exc.read())


@contextmanager
def _backend(tmp_path, name):
    ctx = get_context("spawn")
    ready, started, cancelled, release = ctx.Queue(), ctx.Event(), ctx.Event(), ctx.Event()
    process = ctx.Process(
        target=_serve,
        args=(str(tmp_path), str(tmp_path / name), ready, started, cancelled, release),
    )
    try:
        process.start()
        port = ready.get(timeout=25)
        deadline = time.monotonic() + 20
        while True:
            try:
                if _request(port, "GET", "/api/team-tasks")[0] == 200:
                    break
            except URLError:
                pass
            assert process.is_alive() and time.monotonic() < deadline
            time.sleep(0.025)
        yield SimpleNamespace(
            port=port, process=process, started=started, cancelled=cancelled, release=release
        )
    finally:
        if process.pid is not None:
            if process.is_alive():
                release.set()
                process.join(0.2)
            if process.is_alive():
                process.terminate()
            process.join(5)
        ready.close()
        ready.join_thread()


def _room(backend):
    status, room = _request(
        backend.port,
        "POST",
        "/api/teams",
        {
            "id": "room-alpha",
            "name": "Shared room",
            "members": [{"name": "alice", "role": "owner"}],
        },
    )
    assert status == 200, room


def _task(backend, title="Shared task"):
    status, task = _request(
        backend.port,
        "POST",
        "/api/team-tasks",
        {
            "room_id": "room-alpha",
            "title": title,
            "assignees": [{"kind": "agent", "ref": "agent-a"}],
        },
    )
    assert status == 200, task
    return task


def _start(backend, task):
    status, started = _request(backend.port, "POST", f"/api/team-tasks/{task['id']}/run")
    assert status == 200 and started["status"] == "running", started
    assert backend.started.wait(5)


def _wait_status(backend, task_id, status):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        code, task = _request(backend.port, "GET", f"/api/team-tasks/{task_id}")
        if code == 200 and task["status"] == status:
            return task
        time.sleep(0.025)
    raise AssertionError(f"task did not reach {status}")


def test_second_real_http_backend_preserves_live_owner_and_disjoint_creates(tmp_path):
    with _backend(tmp_path, "a") as first:
        _room(first)
        live = _task(first)
        _start(first, live)
        with _backend(tmp_path, "b") as second:
            assert first.process.is_alive()
            assert (
                _request(second.port, "GET", f"/api/team-tasks/{live['id']}")[1]["status"]
                == "running"
            )
            created_a, created_b = _task(first, "A create"), _task(second, "B create")
            ids = {live["id"], created_a["id"], created_b["id"]}
            for backend in (first, second):
                assert {
                    task["id"]
                    for task in _request(backend.port, "GET", "/api/team-tasks")[1]["tasks"]
                } == ids
            status, changed = _request(
                second.port, "PATCH", f"/api/team-tasks/{live['id']}", {"title": "Edited by B"}
            )
            assert status == 200
            first.release.set()
            done = _wait_status(second, live["id"], "done")
            assert done["title"] == changed["title"] == "Edited by B"
            assert done["produced_artifacts"][0]["content"] == "late fixture output"
            assert not (tmp_path / "tasks.json").exists()


def test_remote_cancel_fences_late_result_and_global_capacity_until_exit(tmp_path):
    with _backend(tmp_path, "a") as first:
        _room(first)
        task = _task(first)
        _start(first, task)
        with _backend(tmp_path, "b") as second:
            queued = _task(second, "Next task")
            assert _request(second.port, "POST", f"/api/team-tasks/{queued['id']}/run")[0] == 429
            status, cancelled = _request(
                second.port, "PATCH", f"/api/team-tasks/{task['id']}", {"status": "cancelled"}
            )
            assert status == 200 and first.cancelled.wait(5)
            assert _request(second.port, "POST", f"/api/team-tasks/{queued['id']}/run")[0] == 429
            first.release.set()
            authority = CollaborationStore(tmp_path / "cowork")
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                with authority._connect() as conn:
                    if (
                        conn.execute(
                            "SELECT COUNT(*) FROM collaboration_team_task_claims"
                        ).fetchone()[0]
                        == 0
                    ):
                        break
                time.sleep(0.025)
            status, final = _request(second.port, "GET", f"/api/team-tasks/{task['id']}")
            assert status == 200 and final == cancelled
            assert final["produced_artifacts"] == []
            _start(second, queued)


def test_remote_delete_cancels_execution_without_resurrecting_task(tmp_path):
    with _backend(tmp_path, "a") as first:
        _room(first)
        task = _task(first)
        _start(first, task)
        with _backend(tmp_path, "b") as second:
            assert _request(second.port, "DELETE", f"/api/team-tasks/{task['id']}")[0] == 200
            assert first.cancelled.wait(5)
            first.release.set()
            assert _request(first.port, "GET", f"/api/team-tasks/{task['id']}")[0] == 404
            assert _request(second.port, "GET", "/api/team-tasks")[1]["tasks"] == []


def test_dead_http_owner_is_failed_without_automatic_execution_on_restart(tmp_path):
    with _backend(tmp_path, "a") as first:
        _room(first)
        task = _task(first)
        _start(first, task)
        first.process.terminate()
        first.process.join(5)
        assert not first.process.is_alive()
        with _backend(tmp_path, "b") as second:
            failed = _wait_status(second, task["id"], "failed")
            assert failed["metadata"]["failure_code"] == "worker_lost_on_restart"
            assert not second.started.is_set()
            _start(second, task)
