"""Resolve source/client retry identities inside the message write transaction."""

import json
import sqlite3
from typing import Any

from runtime.memory.cowork.ids import normalize_actor_id, optional_cowork_id


def existing_room_message(
    conn: sqlite3.Connection,
    *,
    session_id: str,
    room_id: str,
    participant_id: str,
    display_name: str,
    text: str,
    metadata: dict[str, Any],
) -> int | None:
    source_id = str(metadata.get("source_message_id") or "")
    client_id = normalize_actor_id(metadata.get("client_message_id"), label="client_message_id")
    message_id = optional_cowork_id(metadata.get("message_id"), label="message_id")
    if not source_id and not client_id and not message_id:
        return None
    rows = conn.execute(
        "SELECT seq,room_id,participant_id,display_name,text,metadata_json FROM collaboration_messages "
        "WHERE session_id=? AND json_valid(metadata_json) AND "
        "((?!='' AND json_extract(metadata_json,'$.source_message_id')=?) OR "
        "(room_id=? AND participant_id=? AND ?!='' AND json_extract(metadata_json,'$.client_message_id')=?) OR "
        "(room_id=? AND ?!='' AND json_extract(metadata_json,'$.message_id')=?))",
        (
            session_id,
            source_id,
            source_id,
            room_id,
            participant_id,
            client_id,
            client_id,
            room_id,
            message_id,
            message_id,
        ),
    ).fetchall()
    if not rows:
        return None
    if len(rows) != 1:
        raise ValueError("message retry identity is ambiguous")
    row = rows[0]
    if (row[1], row[2] or "", row[3] or "", row[4]) != (
        room_id,
        participant_id,
        display_name,
        text,
    ):
        raise ValueError(
            "source_message_id/client_message_id/message_id belongs to different content"
        )
    before = json.loads(row[5])
    for key in ("reply_to", "sender_kind", "sender_driver"):
        if metadata.get(key) not in (None, "", "unknown") and before.get(key) not in (
            None,
            "",
            "unknown",
            metadata[key],
        ):
            raise ValueError("message retry changes its attribution or reply")
    return int(row[0])
