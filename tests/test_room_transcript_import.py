"""Once-only full transcript import, write fencing, and atomic recovery contracts."""

from __future__ import annotations

import json
import multiprocessing
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from runtime.memory.cowork import _collaboration_transcript_import as migration
from runtime.memory.cowork._collaboration_schema import _MIGRATIONS as CANONICAL_MIGRATIONS
from runtime.memory.cowork._collaboration_transcript_schema import adopt_room_transcripts
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.room_messages import _MIGRATIONS as LEGACY_MIGRATIONS
from runtime.memory.cowork.room_messages import RoomMessageStore
from runtime.platform.io.sqlite_schema import SchemaTooNewError, migrate


@pytest.fixture
def stores(tmp_path):
    canonical = CollaborationStore(tmp_path / "canonical")
    canonical.upsert_room("session-1", {"id": "room-1", "name": "Room"})
    return canonical, RoomMessageStore(tmp_path / "legacy")


def _rows(store):
    with store._connect() as conn:
        return conn.execute(
            "SELECT seq,room_seq,text,ts,metadata_json FROM collaboration_messages "
            "WHERE room_id='room-1' ORDER BY room_seq"
        ).fetchall()


def _ledger(store):
    with store._connect() as conn:
        return conn.execute(
            "SELECT source_sha256,imported_count,adopted_count,receipt_count "
            "FROM collaboration_room_transcript_imports WHERE room_id='room-1'"
        ).fetchone()


def _append_from_old_process(base_dir, start, results):
    legacy = RoomMessageStore(base_dir)
    results.put("ready")
    if not start.wait(10):
        raise RuntimeError("parent did not start the write race")
    try:
        legacy.append("room-1", text="racing late line", message_id="late")
    except sqlite3.IntegrityError:
        results.put("fenced")
    else:
        results.put("committed")


def test_import_reads_all_history_beyond_public_page_limit(stores):
    canonical, legacy = stores
    with legacy._connect() as conn:
        conn.executemany(
            "INSERT INTO room_messages(room_id,seq,text,ts,participant_id,message_id) "
            "VALUES('room-1',?,?,'2026-10-01T00:00:00Z','old',?)",
            ((i, f"original {i}", f"old-{i}") for i in range(1, 2502)),
        )
    canonical.append_message_for_room("room-1", text="new canonical line")
    assert len(legacy.history("room-1", limit=9999)) == 2000
    assert canonical.import_legacy_room(legacy, "room-1") == 2501
    rows = _rows(canonical)
    assert len(rows) == 2502
    assert [row[1] for row in rows] == list(range(1, 2503))
    assert [row[2] for row in rows[:2501]] == [f"original {i}" for i in range(1, 2502)]
    assert rows[-1][0] == 1 and rows[-1][2] == "new canonical line"
    assert _ledger(canonical)[1:] == (2501, 0, 0)
    assert len(legacy.history("room-1", limit=9999)) == 2000


def test_matching_shadow_adopts_once_and_preserves_sender_seal_timestamp_and_metadata(stores):
    canonical, legacy = stores
    legacy.append("room-1", text="old", participant_id="old", message_id="m-old")
    legacy.append(
        "room-1",
        text="shared",
        participant_id="human",
        display_name="Human",
        message_id="m-shared",
        client_message_id="client / 1",
        sender_kind="human",
        sender_driver="human",
    )
    canonical.append_message_for_room(
        "room-1",
        text="shared",
        participant_id="human",
        display_name="Human",
        metadata={
            "message_id": "m-shared",
            "client_message_id": "client / 1",
            "extra_payload": list(range(600)),
        },
    )
    canonical.append_message_for_room("room-1", text="new", metadata={"message_id": "m-new"})
    old_rows = _rows(canonical)
    original = legacy.history("room-1")
    legacy.record_receipt(
        "room-1", message_id="m-shared", participant_id="viewer", status="read", seq=2
    )
    canonical.record_receipt_for_room(
        "room-1", message_id="m-shared", participant_id="viewer", status="delivered", seq=1
    )
    assert canonical.import_legacy_room(legacy, "room-1") == 1
    rows = _rows(canonical)
    assert [row[2] for row in rows] == ["old", "shared", "new"]
    assert rows[1][0] == old_rows[0][0] and rows[1][3] == old_rows[0][3]
    metadata = json.loads(rows[1][4])
    assert metadata["extra_payload"] == list(range(600))
    assert metadata["sender_kind"] == metadata["sender_driver"] == "human"
    provenance = metadata["legacy_history"]
    assert provenance["ts"] == original[1]["ts"]
    assert provenance["message_id"] == "m-shared"
    assert provenance["seal"] and provenance["seal_prev"]
    with canonical._connect() as conn:
        assert conn.execute("SELECT status,seq FROM collaboration_message_receipts").fetchone() == (
            "read",
            2,
        )
    assert _ledger(canonical)[1:] == (1, 1, 1)
    assert canonical.import_legacy_room(legacy, "room-1") == 0
    assert _rows(canonical) == rows


def test_source_ids_remain_bounded_and_blank_ids_get_stable_identity(tmp_path):
    room = "r" * 240
    canonical, legacy = (
        CollaborationStore(tmp_path / "canonical"),
        RoomMessageStore(tmp_path / "legacy"),
    )
    canonical.upsert_room("session-1", {"id": room})
    legacy.append(room, text="old anonymous ID", client_message_id="client 1")
    canonical.append_message_for_room(
        room, text="old anonymous ID", metadata={"client_message_id": "client 1"}
    )
    assert canonical.import_legacy_room(legacy, room) == 0
    message = canonical.messages_for_room(room)[0]
    assert message["metadata"]["message_id"].startswith("legacy-room-")
    assert len(message["metadata"]["message_id"]) <= 240
    assert canonical.import_legacy_room(legacy, room) == 0
    assert canonical.messages_for_room(room)[0] == message


def test_old_connections_are_fenced_but_other_rooms_remain_writable(stores):
    canonical, legacy = stores
    legacy.append("room-1", text="old", message_id="m-old")
    stale = sqlite3.connect(legacy._db)
    try:
        assert canonical.import_legacy_room(legacy, "room-1") == 1
        for statement in (
            "INSERT INTO room_messages(room_id,seq,text,ts) VALUES('room-1',2,'late','now')",
            "UPDATE room_messages SET text='changed' WHERE room_id='room-1'",
            "DELETE FROM room_messages WHERE room_id='room-1'",
            "INSERT INTO room_message_receipts VALUES('room-1','m-old','reader','read',1,'now')",
        ):
            with pytest.raises(sqlite3.IntegrityError, match="retired"):
                stale.execute(statement)
            stale.rollback()
    finally:
        stale.close()
    with pytest.raises(sqlite3.IntegrityError, match="retired"):
        legacy.append("room-1", text="late")
    assert legacy.append("room-2", text="another room") == 1
    assert legacy.history("room-1")[0]["text"] == "old"


def test_failed_destination_keeps_source_fence_and_retry_imports_everything(stores):
    canonical, legacy = stores
    legacy.append("room-1", text="first", message_id="first")
    legacy.append("room-1", text="last", message_id="last")
    with canonical._connect() as conn:
        conn.execute(
            "CREATE TRIGGER fail_import BEFORE INSERT ON collaboration_messages "
            "WHEN NEW.text='last' BEGIN SELECT RAISE(ABORT,'simulated disk fault'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="disk fault"):
        canonical.import_legacy_room(legacy, "room-1")
    assert _rows(canonical) == [] and _ledger(canonical) is None
    assert len(legacy.history("room-1")) == 2
    with pytest.raises(sqlite3.IntegrityError, match="retired"):
        legacy.append("room-1", text="late")
    with canonical._connect() as conn:
        conn.execute("DROP TRIGGER fail_import")
    reopened = CollaborationStore(canonical.base_dir)
    assert reopened.import_legacy_room(RoomMessageStore(legacy.base_dir), "room-1") == 2
    assert [row[2] for row in _rows(reopened)] == ["first", "last"]


@pytest.mark.parametrize(
    "change",
    [
        "UPDATE room_messages SET seal='tampered' WHERE seq=1",
        "UPDATE room_messages SET sender_kind='invalid' WHERE seq=1",
        "INSERT INTO room_messages(room_id,seq,text,ts) VALUES('room-1',2,'unsealed tail','now')",
        "INSERT INTO room_message_receipts VALUES('room-1','missing','reader','read',1,'now')",
        "INSERT INTO room_message_receipts VALUES('room-1','m-old','reader','read',99,'now')",
    ],
)
def test_invalid_source_has_no_partial_import_or_write_fence(stores, change):
    canonical, legacy = stores
    legacy.append("room-1", text="old", message_id="m-old")
    with legacy._connect() as conn:
        conn.execute(change)
    with pytest.raises(ValueError):
        canonical.import_legacy_room(legacy, "room-1")
    assert _rows(canonical) == [] and _ledger(canonical) is None
    with legacy._connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM room_message_retirements").fetchone()[0] == 0


def test_conflicting_message_id_rolls_back_and_preserves_canonical_content(stores):
    canonical, legacy = stores
    legacy.append("room-1", text="newly imported", message_id="first")
    legacy.append("room-1", text="source content", message_id="conflict")
    canonical.append_message_for_room(
        "room-1", text="canonical content", metadata={"message_id": "conflict"}
    )
    before = _rows(canonical)
    with pytest.raises(migration.RoomTranscriptConflict, match="conflicting"):
        canonical.import_legacy_room(legacy, "room-1")
    assert _rows(canonical) == before and _ledger(canonical) is None


def test_two_source_messages_cannot_adopt_one_canonical_row(stores):
    canonical, legacy = stores
    legacy.append("room-1", text="same", message_id="id-one", client_message_id="client-one")
    legacy.append("room-1", text="same", client_message_id="client-two")
    canonical.append_message_for_room(
        "room-1", text="same", metadata={"message_id": "id-one", "client_message_id": "client-two"}
    )
    before = _rows(canonical)
    with pytest.raises(migration.RoomTranscriptConflict, match="multiple legacy"):
        canonical.import_legacy_room(legacy, "room-1")
    assert _rows(canonical) == before and _ledger(canonical) is None


def test_concurrent_importers_commit_one_complete_ledger(stores):
    canonical, legacy = stores
    for number in range(5):
        legacy.append("room-1", text=f"old {number}", message_id=f"m-{number}")

    def run(_):
        store = CollaborationStore(canonical.base_dir)
        return store.import_legacy_room(RoomMessageStore(legacy.base_dir), "room-1")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, range(24)))
    assert sorted(results) == [0] * 23 + [5]
    assert len(_rows(canonical)) == 5 and _ledger(canonical)[1:] == (5, 0, 0)


def test_committed_import_never_consults_legacy_again(stores):
    canonical, legacy = stores
    legacy.append("room-1", text="old")
    assert canonical.import_legacy_room(legacy, "room-1") == 1
    assert canonical.import_legacy_room(SimpleNamespace(), "room-1") == 0


def test_room_binding_change_during_freeze_is_fenced(stores, monkeypatch):
    canonical, legacy = stores
    legacy.append("room-1", text="old")
    freeze = migration.freeze_legacy_room

    def move(*args):
        source = freeze(*args)
        canonical.upsert_room("session-2", {"id": "room-1"})
        return source

    monkeypatch.setattr(migration, "freeze_legacy_room", move)
    with pytest.raises(migration.RoomTranscriptConflict, match="ownership changed"):
        canonical.import_legacy_room(legacy, "room-1")
    assert _rows(canonical) == [] and _ledger(canonical) is None


def test_missing_room_does_not_freeze_source(stores):
    canonical, legacy = stores
    legacy.append("room-missing", text="old")
    with pytest.raises(migration.RoomTranscriptConflict, match="missing"):
        canonical.import_legacy_room(legacy, "room-missing")
    assert legacy.append("room-missing", text="still writable") == 2


def test_source_cannot_be_adopted_by_another_database(stores, tmp_path):
    canonical, legacy = stores
    legacy.append("room-1", text="old")
    canonical.import_legacy_room(legacy, "room-1")
    other = CollaborationStore(tmp_path / "other")
    other.upsert_room("session-1", {"id": "room-1"})
    with pytest.raises(ValueError, match="different canonical"):
        other.import_legacy_room(legacy, "room-1")
    assert _rows(other) == [] and _ledger(other) is None


def test_v3_upgrade_backfills_room_cursors_without_changing_session_sequences(tmp_path):
    with sqlite3.connect(tmp_path / "collaboration.db") as conn:
        migrate(conn, CANONICAL_MIGRATIONS[:3], name="collaboration")
        conn.executemany(
            "INSERT INTO collaboration_messages(session_id,seq,room_id,text,ts,metadata_json) "
            "VALUES('session-1',?,?,?,'now',?)",
            [
                (1, "room-1", "first", '{"message_id":"first"}'),
                (2, "room-2", "other", "{}"),
                (7, "room-1", "last", '{"message_id":"last"}'),
            ],
        )
        conn.execute(
            "INSERT INTO collaboration_message_receipts VALUES('room-1','last','reader','read',7,'now')"
        )
    canonical = CollaborationStore(tmp_path)
    rows = _rows(canonical)
    assert [(row[0], row[1], row[2]) for row in rows] == [(1, 1, "first"), (7, 2, "last")]
    with canonical._connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 5
        assert conn.execute("SELECT seq FROM collaboration_message_receipts").fetchone()[0] == 2
        identity = conn.execute(
            "SELECT identity FROM collaboration_transcript_identity"
        ).fetchone()[0]
        # Reapplying an idempotent schema step must retain imported cursor order.
        conn.execute(
            "UPDATE collaboration_messages SET room_seq=room_seq+100 WHERE room_id='room-1'"
        )
        adopt_room_transcripts(conn)
        assert (
            conn.execute("SELECT identity FROM collaboration_transcript_identity").fetchone()[0]
            == identity
        )
    assert [row[1] for row in _rows(canonical)] == [101, 102]


def test_old_source_schema_upgrades_without_rewriting_history(tmp_path):
    with sqlite3.connect(tmp_path / "room_messages.db") as conn:
        migrate(conn, LEGACY_MIGRATIONS[:1], name="room_messages")
        conn.execute(
            "INSERT INTO room_messages(room_id,seq,text,ts) VALUES('room-1',1,'old','now')"
        )
    legacy = RoomMessageStore(tmp_path)
    assert legacy.history("room-1")[0]["text"] == "old"
    with legacy._connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
        assert conn.execute("SELECT COUNT(*) FROM room_message_retirements").fetchone()[0] == 0


def test_unknown_future_source_schema_is_refused_without_modification(tmp_path):
    legacy = RoomMessageStore(tmp_path)
    legacy.append("room-1", text="old")
    with legacy._connect() as conn:
        conn.execute("PRAGMA user_version=3")
    with pytest.raises(SchemaTooNewError, match="version 3"):
        RoomMessageStore(tmp_path)
    with sqlite3.connect(legacy._db) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
        assert conn.execute("SELECT text FROM room_messages").fetchone()[0] == "old"


def test_process_append_race_is_imported_or_rejected_never_silently_lost(stores):
    canonical, legacy = stores
    legacy.append("room-1", text="old", message_id="old")
    context = multiprocessing.get_context("spawn")
    start, results = context.Event(), context.Queue()
    writer = context.Process(
        target=_append_from_old_process, args=(legacy.base_dir, start, results)
    )
    writer.start()
    try:
        assert results.get(timeout=15) == "ready"
        start.set()
        canonical.import_legacy_room(legacy, "room-1")
        outcome = results.get(timeout=15)
        writer.join(15)
        assert writer.exitcode == 0
        assert [row[2] for row in _rows(canonical)] == (
            ["old", "racing late line"] if outcome == "committed" else ["old"]
        )
        assert outcome in {"committed", "fenced"}
    finally:
        if writer.is_alive():
            writer.terminate()
            writer.join(5)
        results.close()
        results.join_thread()


def test_canonical_message_from_another_session_cannot_be_adopted(stores):
    canonical, legacy = stores
    legacy.append("room-1", text="source history", message_id="source")
    with canonical._connect() as conn:
        conn.execute(
            "INSERT INTO collaboration_messages(session_id,seq,room_id,text,ts) "
            "VALUES('wrong-session',1,'room-1','unrelated history','now')"
        )
    before = _rows(canonical)
    with pytest.raises(migration.RoomTranscriptConflict, match="different Room session"):
        canonical.import_legacy_room(legacy, "room-1")
    assert _rows(canonical) == before and _ledger(canonical) is None
