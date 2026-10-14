"""Revisioned Room/session transfer of the existing canonical TeamTask rows."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from runtime.memory.cowork._collaboration_team_records import (
    TeamTaskConflict,
    dump_payload,
    normalize_task,
    room_binding,
)


def check_transfer_binding(
    conn: sqlite3.Connection, room_id: str, expected: dict[str, Any]
) -> None:
    if room_binding(conn, expected["session_id"], room_id) != expected:
        raise TeamTaskConflict("room ownership changed before task transfer")
    rows = conn.execute(
        "SELECT team_binding_json FROM collaboration_tasks WHERE room_id=? AND task_authority='team'",
        (room_id,),
    ).fetchall()
    if any(json.loads(row[0]) != expected for row in rows):
        raise TeamTaskConflict("team task generation changed before room transfer")


def transfer_team_rows(
    conn: sqlite3.Connection, room_id: str, session_id: str, expected: dict[str, Any], stamp: str
) -> None:
    binding = room_binding(conn, session_id, room_id)
    if binding == expected:
        return
    rows = conn.execute(
        "SELECT task_id,task_json,task_revision FROM collaboration_tasks "
        "WHERE room_id=? AND task_authority='team'",
        (room_id,),
    ).fetchall()
    for task_id, task_json, revision in rows:
        payload = json.loads(task_json)
        payload["metadata"] = {**payload.get("metadata", {}), "collab_session_id": session_id}
        if payload["status"] == "running":
            payload.update(status="cancelled", completed_at=stamp)
            payload["metadata"].update(
                failure_code="room_binding_changed",
                error="room moved to another collaboration session; retry explicitly",
            )
        payload["updated_at"] = stamp
        payload = normalize_task(payload, session_id)
        conn.execute(
            "UPDATE collaboration_tasks SET session_id=?,task_json=?,status=?,updated_at=?,"
            "task_revision=?,team_binding_json=? WHERE task_id=? AND task_revision=?",
            (
                session_id,
                dump_payload(payload),
                payload["status"],
                stamp,
                int(revision) + 1,
                dump_payload(binding),
                task_id,
                revision,
            ),
        )


def prepare_room_projection(store: Any, room_id: str) -> Any:
    """Capture the transfer fence before changing the external Team Room."""
    from runtime.memory.cowork._collaboration_room_write import upsert_room
    from runtime.memory.cowork.collaboration_store import CollaborationStore

    if not isinstance(store, CollaborationStore):
        return store.upsert_room
    with store._lock, store._connect() as conn:
        row = conn.execute(
            "SELECT session_id FROM collaboration_tasks WHERE room_id=? AND task_authority='team' LIMIT 1",
            (room_id,),
        ).fetchone()
        expected = room_binding(conn, str(row[0]), room_id) if row else None
    if expected is None:
        return store.upsert_room

    def project(session_id: str, room: dict[str, Any]) -> dict[str, Any]:
        return upsert_room(store, session_id, room, expected_team_binding=expected)

    return project
