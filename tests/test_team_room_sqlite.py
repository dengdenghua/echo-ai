"""Real room migration, incremental writes, concurrency and heartbeat boundaries."""

from __future__ import annotations

import json
import multiprocessing
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from runtime.sensing.gateway._team_room_persistence import merge_team_room_state
from runtime.sensing.gateway._team_room_store import room_database_path
from runtime.sensing.gateway._team_rooms_state import _load_state, _save_state
from runtime.sensing.gateway.team_rooms_models import TeamParticipantWire, TeamRoomWire
from runtime.sensing.gateway.team_rooms_router import create_team_rooms_router


def _room(room_id: str = "room-a") -> TeamRoomWire:
    return TeamRoomWire(
        id=room_id,
        name=room_id,
        owner_id="alice",
        tenant_id="tenant-a",
        thread_id="thread-a",
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
        participants=[
            TeamParticipantWire(
                id="owner-alice",
                display_name="Alice",
                role="owner",
                actor_id="alice",
                joined_at="2026-01-01T00:00:00+00:00",
                muted=True,
                speak_mode="twin",
                twin_agent_id="approved-agent",
            )
        ],
    )


def _merge(path: Path, local, baseline):
    return merge_team_room_state(
        path=path, local=local, baseline=baseline, legacy_tenant_for_owner=lambda _: "tenant-a"
    )


def test_migration_is_once_scoped_and_does_not_restore_deleted_rooms(tmp_path):
    path = tmp_path / "rooms.json"
    raw = _room().model_dump()
    raw.pop("tenant_id")
    raw.update(invite_token="plaintext-secret", join_policy="apply_then_join")
    raw["participants"][0]["last_seen_at"] = "old-heartbeat"
    path.write_text(json.dumps({"teams": [raw]}), encoding="utf-8")
    first = _load_state(path, legacy_tenant_for_owner=lambda _: "tenant-a", strict=True)
    room = first["room-a"]
    assert room.tenant_id == "tenant-a"
    assert room.join_policy_override == "apply_then_join"
    assert room.participants[0].muted and room.participants[0].twin_agent_id == "approved-agent"
    assert "plaintext-secret" not in path.read_text(encoding="utf-8")
    with sqlite3.connect(room_database_path(path)) as conn:
        payload = conn.execute("SELECT payload FROM rooms").fetchone()[0]
        assert "last_seen_at" not in payload and "plaintext-secret" not in payload
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    raw["name"] = "stale backup"
    path.write_text(json.dumps({"teams": [raw]}), encoding="utf-8")
    assert _load_state(path, legacy_tenant_for_owner=lambda _: "tenant-b")["room-a"] == room
    _save_state(path, {})
    assert _load_state(path) == {}


def test_corrupt_import_is_not_marked_complete_and_can_be_repaired(tmp_path):
    path = tmp_path / "rooms.json"
    path.write_text("{broken", encoding="utf-8")
    assert _load_state(path) == {}
    with pytest.raises(RuntimeError, match="invalid Team Room state"):
        _load_state(path, strict=True)
    with sqlite3.connect(room_database_path(path)) as conn:
        assert conn.execute("SELECT COUNT(*) FROM room_store_meta").fetchone()[0] == 0
    path.write_text(json.dumps([_room().model_dump()]), encoding="utf-8")
    assert _load_state(path, strict=True)["room-a"].owner_id == "alice"


def _write_log(path):
    # Database triggers observe actual production writes, not mocked helper calls.
    with sqlite3.connect(room_database_path(path)) as conn:
        conn.executescript("""
            CREATE TABLE observed_writes(id TEXT, operation TEXT);
            CREATE TRIGGER observed_insert AFTER INSERT ON rooms BEGIN
                INSERT INTO observed_writes VALUES(new.id, 'insert'); END;
            CREATE TRIGGER observed_update AFTER UPDATE ON rooms BEGIN
                INSERT INTO observed_writes VALUES(new.id, 'update'); END;
            CREATE TRIGGER observed_delete AFTER DELETE ON rooms BEGIN
                INSERT INTO observed_writes VALUES(old.id, 'delete'); END;
        """)


def test_only_changed_rows_are_written_and_heartbeat_does_not_conflict(tmp_path):
    path = tmp_path / "rooms.json"
    initial = {key: _room(key) for key in ("room-a", "room-b", "room-c")}
    _save_state(path, initial)
    baseline = _load_state(path)
    _write_log(path)
    local = dict(baseline)
    local["room-a"] = local["room-a"].model_copy(update={"name": "changed"})
    local.pop("room-b")
    local["room-d"] = _room("room-d")
    _merge(path, local, baseline)
    durable = _load_state(path)
    heartbeat = dict(durable)
    participant = durable["room-a"].participants[0].model_copy(update={"last_seen_at": "now"})
    heartbeat["room-a"] = durable["room-a"].model_copy(update={"participants": [participant]})
    _merge(path, heartbeat, durable)
    with sqlite3.connect(room_database_path(path)) as conn:
        assert set(conn.execute("SELECT id, operation FROM observed_writes")) == {
            ("room-a", "update"),
            ("room-b", "delete"),
            ("room-d", "insert"),
        }
    # A stale heartbeat-only view must not overwrite a later owner change.
    latest = dict(durable)
    latest["room-a"] = latest["room-a"].model_copy(update={"name": "owner change"})
    _merge(path, latest, durable)
    assert _merge(path, heartbeat, durable)["room-a"].name == "owner change"


def test_partial_delta_failure_rolls_back_delete_and_updates(tmp_path, monkeypatch):
    from runtime.sensing.gateway import _team_room_store as store

    path = tmp_path / "rooms.json"
    _save_state(path, {key: _room(key) for key in ("room-a", "room-b")})
    baseline = _load_state(path)
    original = store.write_room_delta

    def fail_after_writes(conn, upserts, deleted):
        original(conn, upserts, deleted)
        raise RuntimeError("transaction interrupted before commit")

    monkeypatch.setattr(store, "write_room_delta", fail_after_writes)
    with pytest.raises(RuntimeError, match="before commit"):
        _merge(path, {"room-a": _room().model_copy(update={"name": "changed"})}, baseline)
    assert _load_state(path) == baseline


def _process_merge(path, room_id, conflicting, barrier, results):
    path = Path(path)
    barrier.wait(timeout=15)
    baseline = _load_state(path, strict=True)
    local = dict(baseline)
    local[room_id] = (
        baseline[room_id].model_copy(update={"name": multiprocessing.current_process().name})
        if conflicting
        else _room(room_id)
    )
    barrier.wait(timeout=15)
    try:
        _merge(path, local, baseline)
        results.put("ok")
    except HTTPException as exc:
        results.put(exc.status_code)


@pytest.mark.parametrize("conflicting,importing", [(False, False), (True, False), (False, True)])
def test_real_workers_merge_disjoint_rooms_and_reject_conflicting_writes(
    tmp_path, conflicting, importing
):
    path = tmp_path / "rooms.json"
    if importing:
        path.write_text(json.dumps([_room("legacy-room").model_dump()]), encoding="utf-8")
    else:
        _save_state(path, {"room-a": _room()} if conflicting else {})
    ctx = multiprocessing.get_context("spawn")
    barrier, results = ctx.Barrier(2), ctx.Queue()
    workers = [
        ctx.Process(
            target=_process_merge,
            args=(
                str(path),
                "room-a" if conflicting else f"room-{index}",
                conflicting,
                barrier,
                results,
            ),
        )
        for index in range(2)
    ]
    try:
        for worker in workers:
            worker.start()
        outcomes = [results.get(timeout=25) for _ in workers]
        for worker in workers:
            worker.join(timeout=10)
            assert worker.exitcode == 0
        assert sorted(map(str, outcomes)) == (["409", "ok"] if conflicting else ["ok", "ok"])
        durable = _load_state(path)
        assert len(durable) == (3 if importing else 1 if conflicting else 2)
        if importing:
            assert durable["legacy-room"].tenant_id == "tenant-a"
            with sqlite3.connect(room_database_path(path)) as conn:
                assert conn.execute("SELECT COUNT(*) FROM room_store_meta").fetchone()[0] == 1
    finally:
        for worker in workers:
            if worker.is_alive():
                worker.terminate()
                worker.join(timeout=10)
        results.close()


@pytest.mark.parametrize("invalid", ["nondict", "invalid_room", "duplicate"])
def test_invalid_legacy_entries_do_not_silently_commit_partial_import(tmp_path, invalid):
    path = tmp_path / "rooms.json"
    good = _room().model_dump()
    bad = {"nondict": None, "invalid_room": {"id": "bad"}, "duplicate": good}[invalid]
    path.write_text(json.dumps([good, bad]), encoding="utf-8")
    with pytest.raises(RuntimeError):
        _load_state(path, strict=True)
    with sqlite3.connect(room_database_path(path)) as conn:
        assert conn.execute("SELECT COUNT(*) FROM rooms").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM room_store_meta").fetchone()[0] == 0


def test_import_failure_rolls_back_rows_and_marker_together(tmp_path, monkeypatch):
    from runtime.sensing.gateway import _team_room_store as store

    path = tmp_path / "rooms.json"
    path.write_text(json.dumps([_room().model_dump()]), encoding="utf-8")
    original = store.write_room_delta

    def interrupted(conn, upserts, deleted):
        original(conn, upserts, deleted)
        raise RuntimeError("import interrupted")

    monkeypatch.setattr(store, "write_room_delta", interrupted)
    with pytest.raises(RuntimeError, match="import interrupted"):
        _load_state(path, strict=True)
    with sqlite3.connect(room_database_path(path)) as conn:
        assert conn.execute("SELECT COUNT(*) FROM rooms").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM room_store_meta").fetchone()[0] == 0
    monkeypatch.setattr(store, "write_room_delta", original)
    assert set(_load_state(path, strict=True)) == {"room-a"}


def test_corrupt_sqlite_never_falls_back_to_valid_legacy_backup(tmp_path):
    path = tmp_path / "rooms.json"
    path.write_text(json.dumps([_room().model_dump()]), encoding="utf-8")
    _load_state(path, strict=True)
    with sqlite3.connect(room_database_path(path)) as conn:
        conn.execute("UPDATE rooms SET payload='{}'")
    with pytest.raises(RuntimeError, match="invalid durable Team Room"):
        _load_state(path)


@pytest.mark.parametrize("version", [1, 2])
def test_missing_table_is_not_rebuilt_or_downgraded(tmp_path, version):
    from runtime.platform.io.sqlite_schema import SchemaTooNewError

    path = tmp_path / "rooms.json"
    _save_state(path, {"room-a": _room()})
    with sqlite3.connect(room_database_path(path)) as conn:
        conn.execute("DROP TABLE rooms")
        conn.execute(f"PRAGMA user_version={version}")
    expected = sqlite3.OperationalError if version == 1 else SchemaTooNewError
    with pytest.raises(expected):
        _load_state(path, strict=True)
    with sqlite3.connect(room_database_path(path)) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == version
        assert conn.execute("SELECT 1 FROM sqlite_master WHERE name='rooms'").fetchone() is None


def test_missing_import_marker_cannot_overwrite_populated_authority(tmp_path):
    path = tmp_path / "rooms.json"
    path.write_text(json.dumps([_room().model_dump()]), encoding="utf-8")
    _load_state(path, strict=True)
    _save_state(path, {"room-a": _room().model_copy(update={"name": "current authority"})})
    with sqlite3.connect(room_database_path(path)) as conn:
        conn.execute("DELETE FROM room_store_meta")
    with pytest.raises(RuntimeError, match="import marker missing"):
        _load_state(path, strict=True)
    with sqlite3.connect(room_database_path(path)) as conn:
        payload = conn.execute("SELECT payload FROM rooms").fetchone()[0]
        assert json.loads(payload)["name"] == "current authority"


def test_future_schema_is_refused_without_rewriting_data(tmp_path):
    from runtime.platform.io.sqlite_schema import SchemaTooNewError

    path = tmp_path / "rooms.json"
    _save_state(path, {"room-a": _room()})
    with sqlite3.connect(room_database_path(path)) as conn:
        original = conn.execute("SELECT payload FROM rooms").fetchone()[0]
        conn.execute("PRAGMA user_version=2")
    with pytest.raises(SchemaTooNewError):
        _save_state(path, {})
    with sqlite3.connect(room_database_path(path)) as conn:
        assert conn.execute("SELECT payload FROM rooms").fetchone()[0] == original


def test_real_websocket_heartbeat_refreshes_presence_without_any_room_write(tmp_path, monkeypatch):
    from runtime.sensing.gateway import team_rooms_ws

    path = tmp_path / "rooms.json"
    app = FastAPI()
    app.include_router(create_team_rooms_router(state_path=path))
    with TestClient(app) as client:
        room = client.post(
            "/api/teams", json={"name": "Live", "members": [{"name": "agent"}]}
        ).json()
        room_id = room["id"]
        with client.websocket_connect(f"/api/teams/{room_id}/ws?participant_id=owner-local") as ws:
            assert ws.receive_json()["type"] == "ready"
            assert ws.receive_json()["type"] == "presence"
            durable = _load_state(path)
            _write_log(path)
            monkeypatch.setattr(team_rooms_ws, "_now", lambda: "2030-01-01T00:00:00+00:00")
            for kind in ("ping", "presence:ping", "ping"):
                ws.send_json({"type": kind})
                assert ws.receive_json()["type"] == "pong"
                presence = ws.receive_json()
                assert presence["participants"][0]["last_seen_at"] == "2030-01-01T00:00:00+00:00"
            refreshed = client.get(f"/api/teams/{room_id}").json()
            assert refreshed["participants"][0]["last_seen_at"] == "2030-01-01T00:00:00+00:00"
            assert _load_state(path) == durable
            with sqlite3.connect(room_database_path(path)) as conn:
                assert conn.execute("SELECT COUNT(*) FROM observed_writes").fetchone()[0] == 0
            assert not path.exists()
