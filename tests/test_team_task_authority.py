"""Canonical task races, process recovery, and lossless migration contracts."""

from __future__ import annotations

import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from multiprocessing import get_context

import pytest

from runtime.memory.cowork._collaboration_schema import _MIGRATIONS
from runtime.memory.cowork._collaboration_team_records import TeamTaskCapacity, TeamTaskConflict
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.team_task_authority import TeamTaskAuthority
from runtime.platform.io.sqlite import connect_closing
from runtime.platform.io.sqlite_schema import SchemaTooNewError, migrate
from runtime.platform.process.process_identity import claim_owner_alive, current_claim_owner


def _task(task_id="task-1", **changes):
    return {
        "id": task_id,
        "room_id": "room-1",
        "title": "Task",
        "description": "Description",
        "status": "pending",
        "created_at": "2026-10-11T01:00:00+00:00",
        "updated_at": "2026-10-11T01:00:00+00:00",
        "metadata": {},
        **changes,
    }


def _authority(tmp_path):
    store = CollaborationStore(tmp_path)
    store.upsert_room("session-1", {"id": "room-1", "name": "Team"})
    return TeamTaskAuthority(store)


def _delta(**changes):
    return lambda payload: {**payload, **changes}


def _start(authority, task_id="task-1", **kwargs):
    current = authority.get(task_id)
    return authority.claim(
        task_id,
        expected_revision=current.revision,
        max_concurrent_runs=2,
        **kwargs,
    )


def _claim_process(base_dir, ready, stopped):
    authority = TeamTaskAuthority(CollaborationStore(base_dir))
    authority.create("session-1", _task("task-child"))
    _, claim = _start(authority, lease=600)
    ready.put(claim.run_token)
    stopped.wait(30)
    authority.mutate("task-1", _delta(status="done"), run_token=claim.run_token)
    authority.release("task-1", claim.run_token)


@contextmanager
def _worker(tmp_path):
    ctx = get_context("spawn")
    ready, stopped = ctx.Queue(), ctx.Event()
    process = ctx.Process(target=_claim_process, args=(str(tmp_path), ready, stopped))
    try:
        process.start()
        token = ready.get(timeout=20)
        yield process, token
    finally:
        if process.pid is not None:
            if process.is_alive():
                stopped.set()
            process.join(5)
            if process.is_alive():
                process.terminate()
                process.join(5)
        ready.close()
        ready.join_thread()


def test_two_real_processes_share_tasks_without_orphaning_a_live_worker(tmp_path):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    with _worker(tmp_path) as (process, _token):
        second = TeamTaskAuthority(CollaborationStore(tmp_path))
        assert process.is_alive() and second.reconcile() == []
        assert second.get("task-1").payload["status"] == "running"
        second.create("session-1", _task("task-parent"))
        assert {item.payload["id"] for item in second.list()} == {
            "task-1",
            "task-child",
            "task-parent",
        }
    assert authority.get("task-1").payload["status"] == "done"


def test_confirmed_process_death_recovers_before_expiry_and_fences_old_run(tmp_path):
    if claim_owner_alive(current_claim_owner()) is not True:
        pytest.skip("native process identity unavailable")
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    with _worker(tmp_path) as (process, token):
        process.terminate()
        process.join(5)
        assert not process.is_alive()
        assert authority.reconcile() == ["task-1"]
        recovered = authority.get("task-1")
        assert recovered.payload["metadata"]["failure_code"] == "worker_lost_on_restart"
        assert recovered.payload["status"] == "failed"
        with pytest.raises(TeamTaskConflict):
            authority.mutate("task-1", _delta(status="done"), run_token=token)
        assert authority.reconcile() == []


def test_disjoint_creates_from_independent_connections_survive(tmp_path):
    authority = _authority(tmp_path)

    def create(index):
        return TeamTaskAuthority(CollaborationStore(tmp_path)).create(
            "session-1",
            _task(f"task-{index}"),
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(create, range(24)))
    assert len(results) == len(authority.list()) == 24
    assert len(authority.store.tasks_for_session("session-1")) == 24


def test_preparation_revision_conflict_does_not_start_execution(tmp_path):
    authority = _authority(tmp_path)
    original = authority.create("session-1", _task())
    second = TeamTaskAuthority(CollaborationStore(tmp_path))
    second.mutate("task-1", _delta(title="New title"), expected_revision=original.revision)
    with pytest.raises(TeamTaskConflict, match="revision"):
        authority.claim("task-1", expected_revision=original.revision, max_concurrent_runs=2)
    assert authority.get("task-1").payload["status"] == "pending"


def test_shared_capacity_and_duplicate_claim_are_atomic(tmp_path):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    authority.create("session-1", _task("task-2"))

    def start(task_id):
        second = TeamTaskAuthority(CollaborationStore(tmp_path))
        try:
            return second.claim(task_id, expected_revision=1, max_concurrent_runs=1)[1]
        except TeamTaskCapacity:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(start, ["task-1", "task-2"]))
    assert sum(claim is not None for claim in claims) == 1
    claim = next(claim for claim in claims if claim is not None)
    with pytest.raises(TeamTaskConflict):
        _start(authority, claim.task_id)


def test_operator_edits_and_worker_events_merge_against_fresh_rows(tmp_path):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    current, claim = _start(authority)
    second = TeamTaskAuthority(CollaborationStore(tmp_path))
    second.mutate("task-1", _delta(title="Edited"), expected_revision=current.revision)
    event = authority.mutate(
        "task-1",
        lambda payload: {
            **payload,
            "metadata": {**payload["metadata"], "process_events": [{"kind": "step"}]},
        },
        run_token=claim.run_token,
    )
    assert event.payload["title"] == "Edited"
    terminal = authority.mutate("task-1", _delta(status="done"), run_token=claim.run_token)
    assert terminal.payload["metadata"]["process_events"] == [{"kind": "step"}]
    assert authority.release("task-1", claim.run_token)


def test_remote_cancel_blocks_late_output_and_holds_capacity_until_ack(tmp_path):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    current, claim = _start(authority)
    second = TeamTaskAuthority(CollaborationStore(tmp_path))
    cancelled = second.mutate(
        "task-1", _delta(status="cancelled"), expected_revision=current.revision
    )
    heartbeat = authority.heartbeat("task-1", claim.run_token)
    assert heartbeat.cancel_requested and heartbeat.expires_at == claim.expires_at
    with pytest.raises(TeamTaskConflict):
        authority.mutate(
            "task-1",
            _delta(status="done", produced_artifacts=[{"bad": True}]),
            run_token=claim.run_token,
        )
    second.create("session-1", _task("task-2"))
    with pytest.raises(TeamTaskCapacity):
        second.claim("task-2", expected_revision=1, max_concurrent_runs=1)
    assert second.get("task-1").payload == cancelled.payload
    assert authority.release("task-1", claim.run_token)
    assert second.claim("task-2", expected_revision=1, max_concurrent_runs=1)


def test_delete_cancels_worker_and_prevents_old_id_resurrection(tmp_path):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    current, claim = _start(authority)
    authority.delete("task-1", expected_revision=current.revision)
    assert authority.get("task-1") is None
    assert authority.heartbeat("task-1", claim.run_token).cancel_requested
    with pytest.raises(TeamTaskConflict):
        authority.create("session-1", _task())
    with pytest.raises(TeamTaskConflict):
        authority.mutate("task-1", _delta(status="done"), run_token=claim.run_token)
    authority.release("task-1", claim.run_token)
    authority.create("session-1", _task())
    _, new_claim = _start(authority)
    assert not authority.release("task-1", claim.run_token)
    assert authority.heartbeat("task-1", new_claim.run_token).cancel_requested is False


def test_expired_claim_cannot_write_to_new_run(tmp_path):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    _, old = _start(authority)
    with authority.store._connect() as conn:
        conn.execute("UPDATE collaboration_team_task_claims SET expires_at=?", (time.time() - 1,))
    assert authority.heartbeat("task-1", old.run_token) is None
    assert authority.reconcile() == ["task-1"]
    _, new = _start(authority)
    with pytest.raises(TeamTaskConflict):
        authority.mutate("task-1", _delta(status="done"), run_token=old.run_token)
    assert not authority.release("task-1", old.run_token)
    authority.mutate("task-1", _delta(status="done"), run_token=new.run_token)
    assert authority.release("task-1", new.run_token)


def test_pid_reuse_fences_worker_even_before_reconciliation(tmp_path):
    if claim_owner_alive(current_claim_owner()) is not True:
        pytest.skip("native process identity unavailable")
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    _, claim = _start(authority)
    owner = json.loads(current_claim_owner())
    owner["stamp"] += "-previous-incarnation"
    with authority.store._connect() as conn:
        conn.execute(
            "UPDATE collaboration_team_task_claims SET process_owner=?", (json.dumps(owner),)
        )
    assert authority.heartbeat("task-1", claim.run_token) is None
    with pytest.raises(TeamTaskConflict, match="dead"):
        authority.mutate("task-1", _delta(status="done"), run_token=claim.run_token)
    assert authority.reconcile() == ["task-1"]


def test_terminal_artifact_delta_updates_the_shared_read_model(tmp_path):
    authority = _authority(tmp_path)
    authority.create("session-1", _task(produced_artifacts=[{"content": "old"}]))
    _, claim = _start(authority)
    authority.mutate(
        "task-1",
        _delta(status="done", produced_artifacts=[{"content": "new"}]),
        run_token=claim.run_token,
    )
    projected = authority.store.tasks_for_session("session-1")[0]
    assert projected["artifacts"] == projected["produced_artifacts"] == [{"content": "new"}]


def test_unsupported_newer_schema_is_never_downgraded(tmp_path):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    with authority.store._connect() as conn:
        conn.execute("PRAGMA user_version=6")
    with pytest.raises(SchemaTooNewError):
        CollaborationStore(tmp_path)
    with connect_closing(str(tmp_path / "collaboration.db")) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 6
        assert conn.execute("SELECT COUNT(*) FROM collaboration_tasks").fetchone()[0] == 1


def test_concurrent_importers_commit_one_complete_import(tmp_path):
    authority = _authority(tmp_path)
    path = tmp_path / "tasks.json"
    path.write_text(json.dumps([_task(f"task-{i}") for i in range(12)]), encoding="utf-8")

    def import_tasks(_):
        return TeamTaskAuthority(CollaborationStore(tmp_path)).import_legacy(path)

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(import_tasks, range(4)))
    assert sorted(results) == [0, 0, 0, 12]
    assert len(authority.list()) == 12


@pytest.mark.parametrize(
    "changes", [{"id": "other-task"}, {"room_id": "other-room"}, {"created_at": "new"}]
)
def test_identity_fields_cannot_be_changed_by_task_delta(tmp_path, changes):
    authority = _authority(tmp_path)
    original = authority.create("session-1", _task())
    with pytest.raises(TeamTaskConflict):
        authority.mutate("task-1", _delta(**changes), expected_revision=original.revision)
    assert authority.get("task-1") == original


@pytest.mark.parametrize("owner", ["", "{", "[]", '{"namespace":"foreign","pid":1,"stamp":"x"}'])
def test_foreign_or_uninspectable_owner_is_not_recovered_early(tmp_path, owner):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    _start(authority)
    with authority.store._connect() as conn:
        conn.execute("UPDATE collaboration_team_task_claims SET process_owner=?", (owner,))
    assert authority.reconcile() == []
    assert authority.get("task-1").payload["status"] == "running"


def test_worker_release_without_terminal_state_fails_explicitly(tmp_path):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    _, claim = _start(authority)
    assert authority.release("task-1", claim.run_token)
    assert authority.get("task-1").payload["status"] == "failed"


def test_generic_projection_and_delete_cannot_replace_authority(tmp_path):
    authority = _authority(tmp_path)
    original = authority.create("session-1", _task())
    with pytest.raises(TeamTaskConflict):
        authority.store.upsert_task("session-1", _task(status="done"))
    with pytest.raises(TeamTaskConflict):
        authority.store.delete_task("task-1")
    with authority.store._connect() as conn, pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE collaboration_tasks SET status='done' WHERE task_id='task-1'")
    assert authority.get("task-1") == original


def test_missing_binding_and_room_move_fail_closed(tmp_path):
    authority = _authority(tmp_path)
    with pytest.raises(TeamTaskConflict):
        authority.create("other-session", _task())
    with pytest.raises(TeamTaskConflict):
        authority.create("session-1", _task(room_id="missing-room"))
    authority.create("session-1", _task())
    with pytest.raises(sqlite3.IntegrityError):
        authority.store.upsert_room("other-session", {"id": "room-1", "name": "Moved"})
    assert authority.store.session_id_for_room("room-1") == "session-1"


def test_project_generation_change_cancels_old_execution(tmp_path):
    authority = _authority(tmp_path)
    authority.store.upsert_project_room(
        session_id="session-1",
        room={"id": "room-1", "name": "Team"},
        project_id="project-1",
        generation=1,
    )
    authority.create("session-1", _task())
    _, claim = _start(authority)
    authority.store.upsert_project_room(
        session_id="session-1",
        room={"id": "room-1", "name": "Team"},
        project_id="project-1",
        generation=2,
    )
    assert authority.heartbeat("task-1", claim.run_token).cancel_requested
    with pytest.raises(TeamTaskConflict, match="generation"):
        authority.mutate("task-1", _delta(status="done"), run_token=claim.run_token)
    assert authority.release("task-1", claim.run_token)


def test_migration_adopts_v1_database_without_replacing_projection(tmp_path):
    path = tmp_path / "collaboration.db"
    with connect_closing(str(path)) as conn:
        migrate(conn, _MIGRATIONS[:1], name="collaboration")
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    authority = _authority(tmp_path)
    with authority.store._connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 5
    authority.store.upsert_task("session-1", _task())
    assert authority.get("task-1") is None
    assert authority.store.tasks_for_session("session-1")[0]["id"] == "task-1"


def test_lossless_once_import_adopts_matching_projection_and_retains_file(tmp_path):
    authority = _authority(tmp_path)
    task = _task(
        assignees=[{"kind": "agent", "ref": f"agent-{i}"} for i in range(600)],
        produced_artifacts=[{"content": str(i)} for i in range(600)],
        extension_field={"arbitrary": [1, 2]},
    )
    authority.store.upsert_task("session-1", task)
    path = tmp_path / "tasks.json"
    content = json.dumps({"tasks": [task], "updated_at": "old"})
    path.write_text(content, encoding="utf-8")
    assert authority.import_legacy(path) == 1
    imported = authority.get("task-1")
    assert len(imported.payload["assignees"]) == len(imported.payload["produced_artifacts"]) == 600
    assert imported.payload["extension_field"] == task["extension_field"]
    assert path.read_text(encoding="utf-8") == content
    authority.delete("task-1", expected_revision=imported.revision)
    path.write_text("corrupt retired data", encoding="utf-8")
    assert authority.import_legacy(path) == 0
    assert authority.get("task-1") is None


@pytest.mark.parametrize(
    "content",
    [
        '{"tasks": [1]}',
        '{"tasks": [], "tasks": []}',
        '{"tasks": [], "version": 99}',
        "{",
        json.dumps({"tasks": [_task(), _task()]}),
        json.dumps({"tasks": [_task(), _task("missing", room_id="missing-room")]}),
    ],
)
def test_bad_import_is_atomic_and_does_not_mark_success(tmp_path, content):
    authority = _authority(tmp_path)
    path = tmp_path / "tasks.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises((ValueError, TeamTaskConflict)):
        authority.import_legacy(path)
    assert authority.list() == []
    with authority.store._connect() as conn:
        assert (
            conn.execute("SELECT COUNT(*) FROM collaboration_team_task_imports").fetchone()[0] == 0
        )


def test_conflicting_projection_prevents_whole_import(tmp_path):
    authority = _authority(tmp_path)
    authority.store.upsert_task("session-1", _task(title="Canonical title"))
    path = tmp_path / "tasks.json"
    path.write_text(json.dumps([_task("new-task"), _task()]), encoding="utf-8")
    with pytest.raises(TeamTaskConflict, match="conflicts"):
        authority.import_legacy(path)
    assert authority.list() == []
    assert authority.store.tasks_for_session("session-1")[0]["title"] == "Canonical title"


def test_imported_running_task_fails_without_automatic_retry(tmp_path):
    authority = _authority(tmp_path)
    path = tmp_path / "tasks.json"
    path.write_text(json.dumps([_task(status="running")]), encoding="utf-8")
    assert authority.import_legacy(path) == 1
    assert authority.get("task-1").payload["status"] == "failed"
    assert authority.reconcile() == []


@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan"), True])
def test_invalid_lease_does_not_start_task(tmp_path, value):
    authority = _authority(tmp_path)
    authority.create("session-1", _task())
    with pytest.raises(ValueError, match="lease"):
        _start(authority, lease=value)
    assert authority.get("task-1").revision == 1


def test_oversized_task_is_rejected_without_truncation(tmp_path):
    authority = _authority(tmp_path)
    with pytest.raises(ValueError, match="512 KiB"):
        authority.create("session-1", _task(produced_artifacts=[{"content": "x" * 524288}]))
    assert authority.list() == []
