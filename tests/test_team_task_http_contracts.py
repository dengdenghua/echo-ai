"""Observable HTTP contracts around the canonical task cutover."""

from __future__ import annotations

import json
import sqlite3
import threading

import pytest

from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.team_task_authority import TeamTaskAuthority
from runtime.sensing.gateway._team_tasks_models import TeamTaskWire
from tests.test_team_tasks_router import _client, _create_task, _SuccessRunner, _wait_for_status


def test_consumers_observe_committed_rows_before_task_events(tmp_path):
    seen = []
    notified_done = threading.Event()
    authority = TeamTaskAuthority(CollaborationStore(tmp_path / "cowork"))

    def consume(room_id, task):
        current = authority.get(task["id"])
        assert current is not None
        assert current.revision == task["revision"]
        assert current.payload["status"] == task["status"]
        seen.append(task["status"])
        if task["status"] == "done":
            notified_done.set()

    client = _client(tmp_path, _SuccessRunner, [], task_projection=consume)
    task = _create_task(client)
    assert client.post(f"/api/team-tasks/{task['id']}/run").status_code == 200
    _wait_for_status(client, task["id"], "done")
    assert notified_done.wait(5), "the committed completion must reach its consumer"
    assert seen[0] == "pending" and seen[-1] == "done"
    assert not (tmp_path / "team_tasks.json").exists()


def test_revision_cas_rejects_stale_update_without_broadcast(tmp_path):
    events = []
    client = _client(tmp_path, _SuccessRunner, events)
    task = _create_task(client)
    assert task["revision"] == 1
    updated = client.patch(
        f"/api/team-tasks/{task['id']}", json={"title": "New title", "expected_revision": 1}
    )
    assert updated.status_code == 200 and updated.json()["revision"] == 2
    stale = client.patch(
        f"/api/team-tasks/{task['id']}", json={"description": "stale edit", "expected_revision": 1}
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "TEAM_TASK_STATE_CONFLICT"
    assert client.get(f"/api/team-tasks/{task['id']}").json() == updated.json()
    assert len(events) == 2


@pytest.mark.parametrize("revision", [True, 0, -1, "1"])
def test_invalid_revision_is_rejected_before_mutation(tmp_path, revision):
    client = _client(tmp_path, _SuccessRunner, [])
    task = _create_task(client)
    assert (
        client.patch(
            f"/api/team-tasks/{task['id']}", json={"title": "bad", "expected_revision": revision}
        ).status_code
        == 422
    )
    assert client.get(f"/api/team-tasks/{task['id']}").json() == task


def test_retired_json_cannot_restore_deleted_tasks_on_restart(tmp_path):
    source = tmp_path / "team_tasks.json"
    legacy = TeamTaskWire(
        id="task-legacy", room_id="team-alpha", title="Legacy", created_at="t0", updated_at="t0"
    )
    original = json.dumps({"tasks": [legacy.model_dump(exclude={"revision"})]})
    source.write_text(original, encoding="utf-8")
    client = _client(tmp_path, _SuccessRunner, [])
    assert client.get("/api/team-tasks/task-legacy").status_code == 200
    assert source.read_text(encoding="utf-8") == original
    assert client.delete("/api/team-tasks/task-legacy").status_code == 200
    source.write_text("corrupt retired JSON", encoding="utf-8")
    restarted = _client(tmp_path, _SuccessRunner, [])
    assert restarted.get("/api/team-tasks").json()["tasks"] == []
    assert restarted.get("/api/team-tasks/task-legacy").status_code == 404


def test_unknown_room_and_forged_session_do_not_invent_bindings(tmp_path):
    client = _client(tmp_path, _SuccessRunner, [])
    unknown = client.post("/api/team-tasks", json={"room_id": "unknown", "title": "Task"})
    forged = client.post(
        "/api/team-tasks",
        json={
            "room_id": "team-alpha",
            "title": "Task",
            "metadata": {"collab_session_id": "other-session"},
        },
    )
    assert unknown.status_code == forged.status_code == 409
    assert client.get("/api/team-tasks").json()["tasks"] == []
    assert CollaborationStore(tmp_path / "cowork").room_by_id("unknown") is None


def test_broadcast_failure_does_not_strand_committed_execution(tmp_path):
    async def broken_broadcast(room_id, task):
        raise RuntimeError("fixture broadcaster unavailable")

    client = _client(tmp_path, _SuccessRunner, [], broadcaster_override=broken_broadcast)
    task = _create_task(client)
    assert client.post(f"/api/team-tasks/{task['id']}/run").status_code == 200
    assert _wait_for_status(client, task["id"], "done")["produced_artifacts"]


@pytest.mark.parametrize("operation", ["get", "create", "mutate", "delete", "reconcile"])
def test_authority_failure_is_not_acknowledged_as_task_success(tmp_path, monkeypatch, operation):
    events = []
    client = _client(tmp_path, _SuccessRunner, events)
    task = _create_task(client)

    def unavailable(*args, **kwargs):
        raise sqlite3.OperationalError("fixture disk unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(TeamTaskAuthority, operation, unavailable)
        if operation == "get":
            response = client.get(f"/api/team-tasks/{task['id']}")
        elif operation == "create":
            response = client.post(
                "/api/team-tasks", json={"room_id": "team-alpha", "title": "must fail"}
            )
        elif operation == "mutate":
            response = client.patch(f"/api/team-tasks/{task['id']}", json={"title": "must fail"})
        elif operation == "delete":
            response = client.delete(f"/api/team-tasks/{task['id']}")
        else:
            response = client.post(f"/api/team-tasks/{task['id']}/run")
        assert response.status_code == 503
    assert client.get(f"/api/team-tasks/{task['id']}").json() == task
    assert len(events) == 1
