"""Freeze legacy Room logs before taking a complete, validated import snapshot."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from runtime.memory.cowork.ids import (
    normalize_actor_id,
    normalize_display_name,
    optional_cowork_id,
    require_cowork_id,
    require_message_text,
)
from runtime.platform.integrity.chain import canonical, verify_chain
from runtime.platform.io.sqlite_schema import execute_script


@dataclass(frozen=True)
class LegacyRoomTranscript:
    source_id: str
    room_id: str
    messages: list[dict[str, Any]]
    receipts: list[dict[str, Any]]
    sha256: str


def adopt_retirement(conn: sqlite3.Connection) -> None:
    execute_script(
        conn,
        """
CREATE TABLE IF NOT EXISTS room_message_source_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), identity TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS room_message_retirements (
    room_id TEXT PRIMARY KEY, target_id TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS retired_room_message_insert BEFORE INSERT ON room_messages
WHEN EXISTS(SELECT 1 FROM room_message_retirements WHERE room_id=NEW.room_id)
BEGIN SELECT RAISE(ABORT,'room transcript retired to canonical authority'); END;
CREATE TRIGGER IF NOT EXISTS retired_room_message_update BEFORE UPDATE ON room_messages
WHEN EXISTS(SELECT 1 FROM room_message_retirements WHERE room_id=OLD.room_id OR room_id=NEW.room_id)
BEGIN SELECT RAISE(ABORT,'room transcript retired to canonical authority'); END;
CREATE TRIGGER IF NOT EXISTS retired_room_message_delete BEFORE DELETE ON room_messages
WHEN EXISTS(SELECT 1 FROM room_message_retirements WHERE room_id=OLD.room_id)
BEGIN SELECT RAISE(ABORT,'room transcript retired to canonical authority'); END;
CREATE TRIGGER IF NOT EXISTS retired_room_receipt_insert BEFORE INSERT ON room_message_receipts
WHEN EXISTS(SELECT 1 FROM room_message_retirements WHERE room_id=NEW.room_id)
BEGIN SELECT RAISE(ABORT,'room transcript retired to canonical authority'); END;
CREATE TRIGGER IF NOT EXISTS retired_room_receipt_update BEFORE UPDATE ON room_message_receipts
WHEN EXISTS(SELECT 1 FROM room_message_retirements WHERE room_id=OLD.room_id OR room_id=NEW.room_id)
BEGIN SELECT RAISE(ABORT,'room transcript retired to canonical authority'); END;
CREATE TRIGGER IF NOT EXISTS retired_room_receipt_delete BEFORE DELETE ON room_message_receipts
WHEN EXISTS(SELECT 1 FROM room_message_retirements WHERE room_id=OLD.room_id)
BEGIN SELECT RAISE(ABORT,'room transcript retired to canonical authority'); END;
""",
    )
    conn.execute("INSERT OR IGNORE INTO room_message_source_identity VALUES(1,?)", (uuid4().hex,))


def _validate(messages: list[dict[str, Any]], receipts: list[dict[str, Any]], room_id: str) -> None:
    ids: set[str] = set()
    client_ids: set[tuple[str, str]] = set()
    sealed = []
    previous_seq = 0
    for row in messages:
        if type(row["seq"]) is not int or row["seq"] <= previous_seq:
            raise ValueError("legacy Room sequence must be positive and increasing")
        previous_seq = row["seq"]
        require_message_text(row["text"])
        optional_cowork_id(row["participant_id"], label="participant_id")
        client_id = normalize_actor_id(row["client_message_id"], label="client_message_id")
        if client_id:
            client_key = (row["participant_id"] or "", client_id)
            if client_key in client_ids:
                raise ValueError("duplicate legacy client message ID")
            client_ids.add(client_key)
        normalize_display_name(row["display_name"])
        if row["sender_kind"] not in {None, "", "agent", "role", "human", "unknown"}:
            raise ValueError("invalid legacy sender kind")
        if row["sender_driver"] not in {None, "", "ai", "human", "unknown"}:
            raise ValueError("invalid legacy sender driver")
        if not isinstance(row["ts"], str) or not row["ts"]:
            raise ValueError("legacy Room timestamp is missing")
        message_id = optional_cowork_id(row["message_id"], label="message_id")
        if message_id:
            if message_id in ids:
                raise ValueError("duplicate legacy message ID")
            ids.add(message_id)
        if row["seal"]:
            sealed.append(
                dict(
                    seq=row["seq"],
                    record_id=row["message_id"]
                    or row["client_message_id"]
                    or f"room:{room_id}:{row['seq']}",
                    payload=canonical(row["text"]),
                    ts=row["ts"],
                    prev_seal=row["seal_prev"],
                    seal=row["seal"],
                )
            )
        elif sealed:
            raise ValueError("unsealed message follows the sealed legacy history")
    if not verify_chain(sealed, scope=room_id)["ok"]:
        raise ValueError("legacy Room seal verification failed")
    sequence_by_id = {row["message_id"]: row["seq"] for row in messages if row["message_id"]}
    for row in receipts:
        require_cowork_id(row["participant_id"], label="participant_id")
        if row["message_id"] not in sequence_by_id:
            raise ValueError("legacy receipt refers to an unknown message")
        if (
            row["status"] not in {"delivered", "read"}
            or not isinstance(row["updated_at"], str)
            or not row["updated_at"]
        ):
            raise ValueError("invalid legacy receipt")
        if row["seq"] is not None and row["seq"] != sequence_by_id[row["message_id"]]:
            raise ValueError("legacy receipt sequence does not match its message")


def freeze_legacy_room(store: Any, room_id: str, target_id: str) -> LegacyRoomTranscript:
    """Commit the write fence first; a failed destination import can safely retry."""
    room_id = require_cowork_id(room_id, label="room_id")
    with store._lock, store._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        source_id = str(
            conn.execute(
                "SELECT identity FROM room_message_source_identity WHERE singleton=1"
            ).fetchone()[0]
        )
        retired = conn.execute(
            "SELECT target_id FROM room_message_retirements WHERE room_id=?", (room_id,)
        ).fetchone()
        if retired is not None and retired[0] != target_id:
            raise ValueError("legacy Room was retired to a different canonical database")
        columns = [
            "seq",
            "participant_id",
            "display_name",
            "text",
            "ts",
            "message_id",
            "client_message_id",
            "sender_kind",
            "sender_driver",
            "seal_prev",
            "seal",
        ]
        messages = [
            dict(zip(columns, row, strict=True))
            for row in conn.execute(
                "SELECT seq,participant_id,display_name,text,ts,message_id,client_message_id,sender_kind,sender_driver,seal_prev,seal FROM room_messages WHERE room_id=? ORDER BY seq",
                (room_id,),
            ).fetchall()
        ]
        receipt_columns = ["message_id", "participant_id", "status", "seq", "updated_at"]
        receipts = [
            dict(zip(receipt_columns, row, strict=True))
            for row in conn.execute(
                "SELECT message_id,participant_id,status,seq,updated_at FROM room_message_receipts WHERE room_id=? ORDER BY message_id,participant_id",
                (room_id,),
            ).fetchall()
        ]
        _validate(messages, receipts, room_id)
        digest = hashlib.sha256(
            json.dumps(
                dict(messages=messages, receipts=receipts),
                sort_keys=True,
                ensure_ascii=False,
                allow_nan=False,
            ).encode("utf-8")
        ).hexdigest()
        conn.execute(
            "INSERT OR IGNORE INTO room_message_retirements VALUES(?,?)", (room_id, target_id)
        )
    return LegacyRoomTranscript(source_id, room_id, messages, receipts, digest)
