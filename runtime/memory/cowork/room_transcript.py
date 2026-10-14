"""One canonical Room transcript after recoverable, once-only legacy adoption."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from runtime.memory.cowork._collaboration_room_messages import room_message_rows
from runtime.memory.cowork._collaboration_team_records import room_binding
from runtime.memory.cowork._collaboration_transcript_import import RoomTranscriptConflict
from runtime.memory.cowork.ids import require_cowork_id


def transcript_epoch(conn: Any, room_id: str) -> str:
    room = conn.execute(
        "SELECT session_id,created_at FROM collaboration_rooms WHERE room_id=?", (room_id,)
    ).fetchone()
    if room is None:
        raise RoomTranscriptConflict("canonical Room is unavailable")
    binding = room_binding(conn, str(room[0]), room_id)
    imported = conn.execute(
        "SELECT source_id,source_sha256 FROM collaboration_room_transcript_imports WHERE room_id=?",
        (room_id,),
    ).fetchone()
    if imported is None:
        raise RoomTranscriptConflict("Room transcript has not been adopted")
    identity = conn.execute("SELECT identity FROM collaboration_transcript_identity").fetchone()[0]
    raw = json.dumps([identity, room_id, binding, room[1], *imported], sort_keys=True)
    return "room-v1-" + hashlib.sha256(raw.encode()).hexdigest()


def message_wire(message: dict[str, Any]) -> dict[str, Any]:
    metadata = message.get("metadata") or {}
    return {
        **message,
        "session_seq": message["seq"],
        "seq": message["room_seq"],
        "message_id": metadata.get("message_id") or "",
        "client_message_id": metadata.get("client_message_id") or "",
        "sender_kind": metadata.get("sender_kind") or "unknown",
        "sender_driver": metadata.get("sender_driver") or "unknown",
        **({"reply_to": metadata["reply_to"]} if metadata.get("reply_to") else {}),
    }


class RoomTranscript:
    def __init__(
        self,
        store: Any,
        legacy: Callable[[], Any],
        *,
        restore_room: Callable[[str], None] | None = None,
    ) -> None:
        self.store = store
        self.legacy = legacy
        self.restore_room = restore_room

    def ensure(self, room_id: str) -> None:
        room_id = require_cowork_id(room_id, label="room_id")
        if not self.store.session_id_for_room(room_id) and self.restore_room is not None:
            self.restore_room(room_id)
        with self.store._lock, self.store._connect() as conn:
            found = conn.execute(
                "SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=?", (room_id,)
            ).fetchone()
        if not found:
            self.store.import_legacy_room(self.legacy(), room_id)

    def epoch(self, room_id: str) -> str:
        self.ensure(room_id)
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN")
            return transcript_epoch(conn, room_id)

    def page(
        self,
        room_id: str,
        *,
        limit: int = 200,
        after_seq: int = 0,
        query: str = "",
        cursor_epoch: str = "",
    ) -> dict[str, Any]:
        self.ensure(room_id)
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN")
            epoch = transcript_epoch(conn, room_id)
            reset = bool(after_seq > 0 and cursor_epoch != epoch)
            after_seq = 0 if reset else max(0, after_seq)
            messages = room_message_rows(
                conn, room_id, limit=limit, after_seq=after_seq, query=query
            )
            last = max((message["room_seq"] for message in messages), default=after_seq)
            more = bool(
                not query
                and conn.execute(
                    "SELECT 1 FROM collaboration_messages WHERE room_id=? AND room_seq>? LIMIT 1",
                    (room_id, last),
                ).fetchone()
            )
        return dict(
            team_id=room_id,
            messages=[message_wire(m) for m in messages],
            cursor_epoch=epoch,
            cursor_reset=reset,
            next_after_seq=last,
            has_more=more,
        )

    def append(self, room_id: str, message: dict[str, Any]) -> dict[str, Any]:
        self.ensure(room_id)
        session_seq = self.store.append_message_for_room(room_id, **message)
        if session_seq is None:
            raise RoomTranscriptConflict("canonical Room is unavailable")
        metadata = message.get("metadata") or {}
        message_id, client_id = metadata.get("message_id"), metadata.get("client_message_id")
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN")
            epoch = transcript_epoch(conn, room_id)
            rows = conn.execute(
                "SELECT room_seq,metadata_json,seq,ts FROM collaboration_messages WHERE room_id=? AND "
                "((json_extract(metadata_json,'$.message_id')=?) OR "
                "(participant_id=? AND ?!='' AND json_extract(metadata_json,'$.client_message_id')=?))",
                (
                    room_id,
                    message_id,
                    message.get("participant_id") or "",
                    client_id or "",
                    client_id or "",
                ),
            ).fetchall()
        if len(rows) != 1:
            raise RoomTranscriptConflict("persisted Room message identity is ambiguous")
        saved = json.loads(rows[0][1])
        return dict(
            seq=int(rows[0][0]),
            message_id=saved["message_id"],
            client_message_id=saved.get("client_message_id") or "",
            cursor_epoch=epoch,
            session_seq=int(rows[0][2]),
            created_at=str(rows[0][3]),
        )

    def record_receipt(
        self,
        room_id: str,
        *,
        message_id: str,
        participant_id: str,
        status: str,
        seq: int | None = None,
    ) -> dict[str, Any]:
        self.ensure(room_id)
        message_id = require_cowork_id(message_id, label="message_id")
        participant_id = require_cowork_id(participant_id, label="participant_id")
        if status not in {"read", "delivered"}:
            raise ValueError("invalid receipt status")
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            epoch = transcript_epoch(conn, room_id)
            rows = conn.execute(
                "SELECT room_seq FROM collaboration_messages WHERE room_id=? AND "
                "json_valid(metadata_json) AND json_extract(metadata_json,'$.message_id')=?",
                (room_id, message_id),
            ).fetchall()
            if len(rows) != 1:
                raise ValueError("receipt message is missing or ambiguous")
            actual_seq = int(rows[0][0])
            prior = conn.execute(
                "SELECT status,updated_at FROM collaboration_message_receipts WHERE room_id=? AND message_id=? AND participant_id=?",
                (room_id, message_id, participant_id),
            ).fetchone()
            if prior and prior[0] == "read":
                status = "read"
            stamp = str(prior[1]) if prior and prior[0] == status else datetime.now(UTC).isoformat()
            conn.execute(
                "INSERT INTO collaboration_message_receipts VALUES(?,?,?,?,?,?) "
                "ON CONFLICT(room_id,message_id,participant_id) DO UPDATE SET status=excluded.status,seq=excluded.seq,updated_at=excluded.updated_at",
                (room_id, message_id, participant_id, status, actual_seq, stamp),
            )
        return dict(
            room_id=room_id,
            message_id=message_id,
            participant_id=participant_id,
            status=status,
            seq=actual_seq,
            updated_at=stamp,
            cursor_epoch=epoch,
        )
