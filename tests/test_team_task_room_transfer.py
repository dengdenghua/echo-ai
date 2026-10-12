"""Room transfer preserves payloads and fences old executions atomically."""

from __future__ import annotations

import json
import sqlite3

import pytest

from runtime.memory.cowork._collaboration_schema import _MIGRATIONS
from runtime.memory.cowork._collaboration_team_records import TeamTaskCapacity, TeamTaskConflict
from runtime.memory.cowork._collaboration_team_transfer import prepare_room_projection
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.team_task_authority import TeamTaskAuthority
from runtime.platform.io.sqlite import connect_closing


def _task(task_id="task-1"):
    return dict(
        id=task_id,
        room_id="room-1",
        title="Preserve",
        status="pending",
        created_at="2026-10-12T00:00:00+00:00",
        updated_at="2026-10-12T00:00:00+00:00",
        metadata={"custom": ["keep"]},
        extra_payload=list(range(600)),
    )


def _authority(tmp_path):
    store = CollaborationStore(tmp_path)
    store.upsert_room("old", {"id": "room-1", "name": "Room"})
    authority = TeamTaskAuthority(store)
    authority.create("old", _task())
    return authority


def test_transfer_cancels_old_execution_keeps_capacity_until_ack(tmp_path):
    authority = _authority(tmp_path)
    started, claim = authority.claim("task-1", expected_revision=1, max_concurrent_runs=1)
    project = prepare_room_projection(authority.store, "room-1")
    project("new", {"id": "room-1", "name": "New"})
    current = authority.get("task-1")
    assert current.revision == started.revision + 1
    assert current.binding["session_id"] == "new"
    assert current.payload["metadata"]["collab_session_id"] == "new"
    assert current.payload["metadata"]["custom"] == ["keep"]
    assert current.payload["extra_payload"] == list(range(600))
    assert current.payload["status"] == "cancelled"
    assert authority.heartbeat("task-1", claim.run_token).cancel_requested
    with pytest.raises(TeamTaskConflict):
        authority.mutate(
            "task-1", lambda task: {**task, "status": "done"}, run_token=claim.run_token
        )
    authority.create("new", _task("task-2"))
    with pytest.raises(TeamTaskCapacity):
        authority.claim("task-2", expected_revision=1, max_concurrent_runs=1)
    assert authority.release("task-1", claim.run_token)
    assert authority.get("task-1") == current
    rerun, new_claim = authority.claim(
        "task-1", expected_revision=current.revision, max_concurrent_runs=1
    )
    assert new_claim.run_token != claim.run_token and rerun.payload["status"] == "running"
    assert not authority.release("task-1", claim.run_token)
    authority.release("task-1", new_claim.run_token)


def test_transfer_fences_stale_snapshot_and_idempotent_retry(tmp_path):
    authority = _authority(tmp_path)
    stale = prepare_room_projection(authority.store, "room-1")
    stale("winner", {"id": "room-1"})
    current = authority.get("task-1")
    with pytest.raises(TeamTaskConflict):
        stale("loser", {"id": "room-1"})
    prepare_room_projection(authority.store, "room-1")("winner", {"id": "room-1"})
    assert authority.get("task-1") == current
    assert authority.store.session_id_for_room("room-1") == "winner"
    assert authority.store.tasks_for_session("old") == []


def test_failed_transfer_rolls_back_room_and_every_task(tmp_path):
    authority = _authority(tmp_path)
    authority.create("old", _task("task-2"))
    project = prepare_room_projection(authority.store, "room-1")
    # Simulate a legacy corrupt row; moving a room must never partially adopt it.
    with authority.store._connect() as conn:
        conn.execute(
            "UPDATE collaboration_tasks SET task_json=?,task_revision=2 WHERE task_id='task-2'",
            (json.dumps({**_task("task-2"), "title": None}),),
        )
    before = authority.get("task-1")
    with pytest.raises(ValueError):
        project("new", {"id": "room-1"})
    assert authority.store.session_id_for_room("room-1") == "old"
    assert authority.get("task-1") == before
    with authority.store._connect() as conn:
        assert conn.execute(
            "SELECT session_id,task_revision FROM collaboration_tasks WHERE task_id='task-2'"
        ).fetchone() == ("old", 2)


def test_v2_upgrade_retains_payload_and_revision_and_rejects_generic_move(tmp_path):
    authority = _authority(tmp_path)
    original = authority.get("task-1")
    path = tmp_path / "collaboration.db"
    with connect_closing(str(path)) as conn:
        conn.execute("PRAGMA user_version=2")
        conn.execute("DROP TRIGGER collab_team_task_revision_fence")
        # Install the actual v2 trigger, as an existing installation has it.
        _MIGRATIONS[1].apply(conn)
    reopened = TeamTaskAuthority(CollaborationStore(tmp_path))
    assert reopened.get("task-1") == original
    with reopened.store._connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 5
    with pytest.raises(sqlite3.IntegrityError):
        reopened.store.upsert_room("new", {"id": "room-1"})
    prepare_room_projection(reopened.store, "room-1")("new", {"id": "room-1"})
    assert reopened.get("task-1").revision == original.revision + 1
