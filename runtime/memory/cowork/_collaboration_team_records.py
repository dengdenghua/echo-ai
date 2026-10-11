"""Lossless task rows and exact room ownership fences for TeamTask writes."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from runtime.memory.cowork.ids import require_cowork_id

TEAM_STATUSES = frozenset({"pending", "running", "done", "failed", "cancelled"})


class TeamTaskConflict(RuntimeError):
    """The task revision, run claim, or room ownership changed."""


class TeamTaskCapacity(TeamTaskConflict):
    """The shared execution limit has been reached."""


class TeamTaskStore(Protocol):
    _lock: threading.Lock

    def _connect(self) -> sqlite3.Connection: ...


@dataclass(frozen=True)
class TeamTaskSnapshot:
    payload: dict[str, Any]
    revision: int
    binding: dict[str, Any]


TaskMutation = Callable[[dict[str, Any]], dict[str, Any]]


def dump_payload(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    if len(blob.encode("utf-8")) > 512 * 1024:
        raise ValueError("team task exceeds the 512 KiB payload limit")
    return blob


def normalize_task(task: dict[str, Any], session_id: str) -> dict[str, Any]:
    """Validate without the projection normalizer's 512-item truncation."""
    payload = json.loads(dump_payload(task))
    for key in ("id", "room_id"):
        require_cowork_id(payload.get(key), label=key)
    for key in ("title", "created_at", "updated_at"):
        if not isinstance(payload.get(key), str) or not payload[key].strip():
            raise ValueError(f"team task {key} must be a nonempty string")
    if payload.get("status") not in TEAM_STATUSES:
        raise ValueError("invalid team task status")
    for key in ("description", "sop_template"):
        if key in payload and not isinstance(payload[key], str):
            raise ValueError(f"team task {key} must be a string")
    for key in ("assignees", "produced_artifacts"):
        value = payload.get(key, [])
        if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
            raise ValueError(f"team task {key} must contain objects")
    metadata = payload.setdefault("metadata", {})
    if not isinstance(metadata, dict):
        raise ValueError("team task metadata must be an object")
    if metadata.get("collab_session_id", session_id) != session_id:
        raise TeamTaskConflict("team task metadata names another session")
    if str(metadata.get("source", "")).startswith("projectos") or any(
        key in metadata for key in ("project_binding_generation", "binding_generation")
    ):
        raise TeamTaskConflict("project tasks require the versioned project API")
    if payload.get("kind", "team") != "team":
        raise TeamTaskConflict("this authority only owns team tasks")
    metadata.setdefault("collab_session_id", session_id)
    metadata.setdefault("source", "collab_session")
    payload.setdefault("kind", "team")
    if "artifacts" not in payload and payload.get("produced_artifacts"):
        payload["artifacts"] = list(payload["produced_artifacts"])
    dump_payload(payload)
    return payload


def room_binding(conn: sqlite3.Connection, session_id: str, room_id: str) -> dict[str, Any]:
    """Do not invent a session for a missing room or accept a legacy orphan."""
    row = conn.execute(
        "SELECT r.session_id,o.session_id,o.project_id,o.generation "
        "FROM collaboration_rooms r LEFT JOIN collaboration_room_owners o "
        "ON o.room_id=r.room_id WHERE r.room_id=?",
        (room_id,),
    ).fetchone()
    if row is None or str(row[0]) != session_id or str(row[1]) != session_id:
        raise TeamTaskConflict("team task room/session binding is missing or changed")
    return {
        "session_id": session_id,
        "room_id": room_id,
        "project_id": str(row[2] or ""),
        "generation": int(row[3]),
    }


def snapshot(conn: sqlite3.Connection, task_id: str) -> TeamTaskSnapshot | None:
    row = conn.execute(
        "SELECT task_json,task_revision,team_binding_json FROM collaboration_tasks "
        "WHERE task_id=? AND task_authority='team'",
        (task_id,),
    ).fetchone()
    if row is None:
        return None
    binding = json.loads(row[2])
    if room_binding(conn, binding["session_id"], binding["room_id"]) != binding:
        raise TeamTaskConflict("team task room generation changed")
    return TeamTaskSnapshot(json.loads(row[0]), int(row[1]), binding)


def require_snapshot(
    conn: sqlite3.Connection, task_id: str, revision: int | None = None
) -> TeamTaskSnapshot:
    if revision is not None and (type(revision) is not int or revision < 1):
        raise ValueError("team task revision must be a positive integer")
    current = snapshot(conn, task_id)
    if current is None:
        raise TeamTaskConflict("team task no longer exists")
    if revision is not None and current.revision != revision:
        raise TeamTaskConflict("team task revision changed")
    return current


def write_task(
    conn: sqlite3.Connection, current: TeamTaskSnapshot, payload: dict[str, Any]
) -> TeamTaskSnapshot:
    if payload.get("produced_artifacts") != current.payload.get(
        "produced_artifacts"
    ) and payload.get("artifacts") == current.payload.get("artifacts"):
        payload = {**payload, "artifacts": list(payload.get("produced_artifacts", []))}
    normalized = normalize_task(payload, current.binding["session_id"])
    for key in ("id", "room_id", "created_at"):
        if normalized[key] != current.payload[key]:
            raise TeamTaskConflict(f"team task {key} is immutable")
    conn.execute(
        "UPDATE collaboration_tasks SET task_json=?,status=?,updated_at=?,task_revision=? "
        "WHERE task_id=? AND task_authority='team' AND task_revision=?",
        (
            dump_payload(normalized),
            normalized["status"],
            normalized["updated_at"],
            current.revision + 1,
            normalized["id"],
            current.revision,
        ),
    )
    if normalized["status"] != "running":
        conn.execute(
            "UPDATE collaboration_team_task_claims SET cancel_requested=1 WHERE task_id=?",
            (normalized["id"],),
        )
    return TeamTaskSnapshot(normalized, current.revision + 1, current.binding)


def insert_task(
    conn: sqlite3.Connection, session_id: str, payload: dict[str, Any]
) -> TeamTaskSnapshot:
    session_id = require_cowork_id(session_id, label="session_id")
    normalized = normalize_task(payload, session_id)
    binding = room_binding(conn, session_id, normalized["room_id"])
    if conn.execute(
        "SELECT 1 FROM collaboration_tasks WHERE task_id=?", (normalized["id"],)
    ).fetchone():
        raise TeamTaskConflict("task id already exists")
    # A deleted task's worker must acknowledge cancellation before this id is reused.
    if conn.execute(
        "SELECT 1 FROM collaboration_team_task_claims WHERE task_id=?", (normalized["id"],)
    ).fetchone():
        raise TeamTaskConflict("deleted task still has an execution claim")
    conn.execute(
        "INSERT INTO collaboration_tasks(task_id,session_id,room_id,status,task_json,"
        "created_at,updated_at,task_authority,task_revision,team_binding_json) "
        "VALUES(?,?,?,?,?,?,?,'team',1,?)",
        (
            normalized["id"],
            session_id,
            normalized["room_id"],
            normalized["status"],
            dump_payload(normalized),
            normalized["created_at"],
            normalized["updated_at"],
            dump_payload(binding),
        ),
    )
    return TeamTaskSnapshot(normalized, 1, binding)
