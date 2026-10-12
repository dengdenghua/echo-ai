"""Room adoption, cursor recovery, identity fences, and cross-session moves."""

from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.room_messages import RoomMessageStore
from runtime.memory.cowork.room_transcript import RoomTranscript


@pytest.fixture
def transcript(tmp_path):
    store = CollaborationStore(tmp_path / "canonical")
    store.upsert_room("session-1", {"id": "room-1"})
    legacy = RoomMessageStore(tmp_path / "legacy")
    return RoomTranscript(store, lambda: legacy), legacy


def _message(number, *, participant="sender", client_id=""):
    return dict(
        text=f"line {number}",
        participant_id=participant,
        display_name=participant,
        metadata={"message_id": f"message-{participant}-{number}", "client_message_id": client_id},
    )


def test_missing_or_foreign_epoch_resets_but_matching_cursor_catches_up_without_holes(transcript):
    authority, legacy = transcript
    legacy.append("room-1", text="original", message_id="original")
    authority.store.append_message_for_room("room-1", text="canonical first")
    initial = authority.page("room-1")
    assert [m["text"] for m in initial["messages"]] == ["original", "canonical first"]
    assert [m["session_seq"] for m in initial["messages"]] == [2, 1]
    for number in range(3, 10):
        authority.append("room-1", _message(number))
    epoch = initial["cursor_epoch"]
    seen, cursor = [], 2
    while True:
        page = authority.page("room-1", limit=2, after_seq=cursor, cursor_epoch=epoch)
        assert not page["cursor_reset"]
        seen.extend(m["seq"] for m in page["messages"])
        cursor = page["next_after_seq"]
        if not page["has_more"]:
            break
    assert seen == list(range(3, 10))
    for foreign in ("", "another-store"):
        reset = authority.page("room-1", limit=3, after_seq=999, cursor_epoch=foreign)
        assert reset["cursor_reset"] and [m["seq"] for m in reset["messages"]] == [7, 8, 9]


def test_deletion_and_restart_never_reuse_a_room_cursor(transcript):
    authority, _ = transcript
    for number in range(1, 4):
        authority.append("room-1", _message(number))
    epoch = authority.epoch("room-1")
    with authority.store._connect() as conn:
        conn.execute("DELETE FROM collaboration_messages WHERE room_id='room-1'")
    restarted = CollaborationStore(authority.store.base_dir)

    def retired_source():
        raise AssertionError("successful empty source must not be re-imported")

    authority = RoomTranscript(restarted, retired_source)
    assert authority.page("room-1")["messages"] == []
    saved = authority.append("room-1", _message(4))
    assert saved["seq"] == 4 and saved["cursor_epoch"] == epoch
    page = authority.page("room-1", after_seq=3, cursor_epoch=epoch)
    assert [m["seq"] for m in page["messages"]] == [4]


def test_concurrent_imported_client_retry_returns_original_identity_once(transcript):
    authority, legacy = transcript
    legacy.append(
        "room-1",
        text="line 1",
        participant_id="sender",
        display_name="sender",
        message_id="original-id",
        client_message_id="same-client",
    )
    authority.ensure("room-1")
    message = _message(1, client_id="same-client")
    with ThreadPoolExecutor(max_workers=8) as pool:
        saved = list(pool.map(lambda _: authority.append("room-1", message), range(24)))
    assert {m["message_id"] for m in saved} == {"original-id"}
    assert {m["seq"] for m in saved} == {1}
    other = authority.append("room-1", _message(1, participant="other", client_id="same-client"))
    assert other["seq"] == 2
    with pytest.raises(ValueError):
        authority.append("room-1", {**message, "text": "different content"})
    assert len(authority.page("room-1")["messages"]) == 2


def test_receipt_uses_actual_cursor_and_sql_fences_old_writers(transcript):
    authority, _ = transcript
    saved = authority.append("room-1", _message(1))
    receipt = authority.record_receipt(
        "room-1", message_id=saved["message_id"], participant_id="reader", status="read", seq=999
    )
    assert receipt["seq"] == 1
    delayed = authority.record_receipt(
        "room-1", message_id=saved["message_id"], participant_id="reader", status="delivered", seq=0
    )
    assert delayed == receipt
    with pytest.raises(ValueError):
        authority.record_receipt(
            "room-1", message_id="missing", participant_id="reader", status="read", seq=1
        )
    with authority.store._connect() as conn:
        for sql, params in (
            ("UPDATE collaboration_messages SET metadata_json='{}' WHERE room_id='room-1'", ()),
            ("UPDATE collaboration_messages SET room_id='other' WHERE room_id='room-1'", ()),
            ("UPDATE collaboration_message_receipts SET seq=999 WHERE room_id='room-1'", ()),
            ("UPDATE collaboration_messages SET room_seq=999 WHERE room_id='room-1'", ()),
            (
                "INSERT INTO collaboration_messages(session_id,seq,room_id,text,ts,metadata_json) "
                "VALUES('session-1',2,'room-1','bad','now',?)",
                ("invalid JSON",),
            ),
            (
                "INSERT INTO collaboration_messages(session_id,seq,room_id,text,ts,metadata_json) "
                "VALUES('session-1',2,'room-1','duplicate','now',?)",
                (json.dumps({"message_id": saved["message_id"]}),),
            ),
        ):
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(sql, params)
    assert authority.page("room-1")["messages"][0]["receipts"][0]["status"] == "read"


def test_move_allocates_session_sequences_and_retains_room_cursors_and_social_state(transcript):
    authority, _ = transcript
    saved = [authority.append("room-1", _message(i)) for i in (1, 2)]
    before = authority.epoch("room-1")
    store = authority.store
    store.add_annotation(
        "session-1",
        room_id="room-1",
        message_id=saved[0]["message_id"],
        author_id="reader",
        author={},
        body="retain comment",
    )
    store.toggle_message_reaction(
        "session-1",
        room_id="room-1",
        message_id=saved[0]["message_id"],
        participant_id="reader",
        emoji="+",
    )
    store.toggle_pinned_message(
        "session-1", room_id="room-1", message_id=saved[0]["message_id"], participant_id="reader"
    )
    with store._connect() as conn:
        conn.execute(
            "INSERT INTO collaboration_messages(session_id,seq,room_id,text,ts) "
            "VALUES('destination',1,'prior-room','existing target','now')"
        )
    store.upsert_room("destination", {"id": "room-1"})
    page = authority.page("room-1", after_seq=2, cursor_epoch=before)
    assert page["cursor_reset"] and page["cursor_epoch"] != before
    assert [m["seq"] for m in page["messages"]] == [1, 2]
    assert [m["session_seq"] for m in page["messages"]] == [2, 3]
    assert store.annotations_for_session("destination")[0]["body"] == "retain comment"
    assert store.reactions_for_session("destination") and store.pinned_messages_for_session(
        "destination"
    )
    assert store.annotations_for_session("session-1") == []
    assert store.messages_for_session("destination")[0]["text"] == "existing target"
