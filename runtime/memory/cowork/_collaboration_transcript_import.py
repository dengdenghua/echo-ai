"""Import frozen Room messages and receipts into the existing canonical tables."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from runtime.memory.cowork._collaboration_team_records import TeamTaskConflict, room_binding
from runtime.memory.cowork._room_message_retirement import LegacyRoomTranscript, freeze_legacy_room
from runtime.memory.cowork.ids import require_cowork_id


class RoomTranscriptConflict(RuntimeError):
    """The Room, source identity, or message ID changed during migration."""


def _blob(value: Any) -> str:
    blob = json.dumps(value, ensure_ascii=False, allow_nan=False)
    if len(blob.encode("utf-8")) > 512 * 1024:
        raise ValueError("Room message metadata exceeds its limit")
    return blob


def _source_message_id(source: LegacyRoomTranscript, message: dict[str, Any]) -> str:
    return (
        "legacy-room-"
        + hashlib.sha256(
            f"{source.source_id}:{source.room_id}:{message['seq']}".encode()
        ).hexdigest()
    )


def _match(source: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    matches = []
    for row in rows:
        metadata = row["metadata"]
        same_id = bool(source["message_id"]) and source["message_id"] == metadata.get("message_id")
        same_client = (
            bool(source["client_message_id"])
            and source["client_message_id"] == metadata.get("client_message_id")
            and (source["participant_id"] or "") == row["participant_id"]
        )
        if same_id or same_client:
            matches.append(row)
    if len(matches) > 1:
        raise RoomTranscriptConflict("legacy message resolves to multiple canonical rows")
    if not matches:
        return None
    row = matches[0]
    if any((source[key] or "") != row[key] for key in ("participant_id", "display_name", "text")):
        raise RoomTranscriptConflict("message ID has conflicting canonical content")
    metadata = row["metadata"]
    if source["message_id"] and metadata.get("message_id") not in {None, "", source["message_id"]}:
        raise RoomTranscriptConflict("client message ID belongs to a different canonical message")
    for key in ("sender_kind", "sender_driver"):
        if source[key] not in {None, "", "unknown"} and metadata.get(key) not in {
            None,
            "",
            "unknown",
            source[key],
        }:
            raise RoomTranscriptConflict("message sender attribution conflicts")
    return row


def _import_messages(
    conn: sqlite3.Connection, source: LegacyRoomTranscript, session_id: str
) -> tuple[int, int, dict[str, int]]:
    rows = []
    for row in conn.execute(
        "SELECT rowid,seq,room_seq,participant_id,display_name,text,metadata_json,session_id FROM collaboration_messages WHERE room_id=? ORDER BY room_seq",
        (source.room_id,),
    ).fetchall():
        if row[7] != session_id:
            raise RoomTranscriptConflict("canonical message belongs to a different Room session")
        metadata = json.loads(row[6])
        if not isinstance(metadata, dict):
            raise ValueError("canonical message metadata must be an object")
        rows.append(
            dict(
                rowid=row[0],
                seq=row[1],
                room_seq=row[2],
                participant_id=row[3] or "",
                display_name=row[4] or "",
                text=row[5],
                metadata=metadata,
            )
        )
    original = list(rows)
    ordered = []
    used_rowids: set[int] = set()
    imported = adopted = 0
    for message in source.messages:
        matched = _match(message, original)
        provenance = {"source_id": source.source_id, **message}
        stable_id = _source_message_id(source, message)
        message_id = message["message_id"] or stable_id
        if matched is None:
            metadata = dict(
                message_id=message_id,
                source_message_id=stable_id,
                client_message_id=message["client_message_id"] or "",
                sender_kind=message["sender_kind"] or "unknown",
                sender_driver=message["sender_driver"] or "unknown",
                legacy_history=provenance,
            )
            result = conn.execute(
                "INSERT INTO collaboration_messages(session_id,seq,room_id,participant_id,display_name,text,ts,metadata_json) VALUES(?,(SELECT COALESCE(MAX(seq),0)+1 FROM collaboration_messages WHERE session_id=?),?,?,?,?,?,?) RETURNING rowid,seq",
                (
                    session_id,
                    session_id,
                    source.room_id,
                    message["participant_id"],
                    message["display_name"],
                    message["text"],
                    message["ts"],
                    _blob(metadata),
                ),
            ).fetchone()
            matched = dict(rowid=result[0], seq=result[1], metadata=metadata)
            imported += 1
        else:
            if matched["rowid"] in used_rowids:
                raise RoomTranscriptConflict(
                    "multiple legacy messages resolve to one canonical row"
                )
            metadata = {**matched["metadata"], "legacy_history": provenance}
            if not metadata.get("message_id"):
                metadata["message_id"] = message_id
            for key in ("client_message_id", "sender_kind", "sender_driver"):
                if not metadata.get(key) or metadata[key] == "unknown":
                    metadata[key] = message[key] or (
                        "" if key == "client_message_id" else "unknown"
                    )
            conn.execute(
                "UPDATE collaboration_messages SET metadata_json=? WHERE rowid=?",
                (_blob(metadata), matched["rowid"]),
            )
            matched = {**matched, "metadata": metadata}
            adopted += 1
        used_rowids.add(matched["rowid"])
        ordered.append(matched)
    used = {row["rowid"] for row in ordered}
    ordered.extend(row for row in original if row["rowid"] not in used)
    conn.execute("UPDATE collaboration_messages SET room_seq=0 WHERE room_id=?", (source.room_id,))
    cursor_by_id = {}
    existing_receipts = conn.execute(
        "SELECT message_id FROM collaboration_message_receipts WHERE room_id=?", (source.room_id,)
    ).fetchall()
    all_ids = {str(row["metadata"].get("message_id") or "") for row in ordered}
    if any(receipt[0] not in all_ids or not receipt[0] for receipt in existing_receipts):
        raise RoomTranscriptConflict("canonical receipt refers to an unknown message ID")
    for cursor, row in enumerate(ordered, 1):
        conn.execute(
            "UPDATE collaboration_messages SET room_seq=? WHERE rowid=?", (cursor, row["rowid"])
        )
        message_id = str(row["metadata"].get("message_id") or "")
        if message_id:
            if message_id in cursor_by_id:
                raise RoomTranscriptConflict("duplicate canonical message ID")
            cursor_by_id[message_id] = cursor
            conn.execute(
                "UPDATE collaboration_message_receipts SET seq=? WHERE room_id=? AND message_id=?",
                (cursor, source.room_id, message_id),
            )
    return imported, adopted, cursor_by_id


def _import_receipts(
    conn: sqlite3.Connection, source: LegacyRoomTranscript, cursors: dict[str, int]
) -> None:
    rank = {"delivered": 1, "read": 2}
    for receipt in source.receipts:
        prior = conn.execute(
            "SELECT status,updated_at FROM collaboration_message_receipts WHERE room_id=? AND message_id=? AND participant_id=?",
            (source.room_id, receipt["message_id"], receipt["participant_id"]),
        ).fetchone()
        status = max((receipt["status"], prior[0] if prior else "delivered"), key=rank.__getitem__)
        stamp = max(receipt["updated_at"], str(prior[1]) if prior else "")
        conn.execute(
            "INSERT INTO collaboration_message_receipts(room_id,message_id,participant_id,status,seq,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(room_id,message_id,participant_id) DO UPDATE SET status=excluded.status,seq=excluded.seq,updated_at=excluded.updated_at",
            (
                source.room_id,
                receipt["message_id"],
                receipt["participant_id"],
                status,
                cursors[receipt["message_id"]],
                stamp,
            ),
        )


def import_legacy_room(store: Any, legacy: Any, room_id: str) -> int:
    """Fence source writes, then atomically import every row and the success marker."""
    room_id = require_cowork_id(room_id, label="room_id")
    with store._lock, store._connect() as conn:
        if conn.execute(
            "SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=?", (room_id,)
        ).fetchone():
            return 0
        room = conn.execute(
            "SELECT session_id FROM collaboration_rooms WHERE room_id=?", (room_id,)
        ).fetchone()
        if room is None:
            raise RoomTranscriptConflict("cannot import history for a missing canonical Room")
        expected = room_binding(conn, str(room[0]), room_id)
        identity = str(
            conn.execute(
                "SELECT identity FROM collaboration_transcript_identity WHERE singleton=1"
            ).fetchone()[0]
        )
    source = freeze_legacy_room(legacy, room_id, identity)
    with store._lock, store._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute(
            "SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=?", (room_id,)
        ).fetchone():
            return 0
        try:
            current_binding = room_binding(conn, expected["session_id"], room_id)
        except TeamTaskConflict as exc:
            raise RoomTranscriptConflict("Room ownership changed during transcript import") from exc
        if current_binding != expected:
            raise RoomTranscriptConflict("Room ownership changed during transcript import")
        imported, adopted, cursors = _import_messages(conn, source, expected["session_id"])
        _import_receipts(conn, source, cursors)
        conn.execute(
            "INSERT INTO collaboration_room_transcript_imports VALUES(?,?,?,?,?,?,?)",
            (
                room_id,
                source.source_id,
                source.sha256,
                imported,
                adopted,
                len(source.receipts),
                datetime.now(UTC).isoformat(),
            ),
        )
    return imported
