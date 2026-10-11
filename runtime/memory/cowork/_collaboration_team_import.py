"""Atomic, once-only import of legacy task JSON into canonical task rows."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from runtime.memory.cowork._collaboration_team_records import (
    TeamTaskConflict,
    TeamTaskStore,
    dump_payload,
    insert_task,
    normalize_task,
    room_binding,
)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate legacy task JSON key: {key}")
        result[key] = value
    return result


def _read_legacy(path: Path) -> tuple[list[dict[str, Any]], str]:
    data = path.read_bytes()
    if len(data) > 16 * 1024 * 1024:
        raise ValueError("legacy task file exceeds the 16 MiB import limit")
    raw = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object)
    if isinstance(raw, dict):
        if set(raw) - {"tasks", "updated_at"}:
            raise ValueError("unsupported legacy task file format")
        items = raw.get("tasks")
    else:
        items = raw
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise ValueError("legacy tasks must be a list of objects")
    ids: set[str] = set()
    for item in items:
        task_id = item.get("id")
        if not isinstance(task_id, str) or task_id in ids:
            raise ValueError("invalid or duplicate legacy task id")
        ids.add(task_id)
    return items, hashlib.sha256(data).hexdigest()


def import_legacy_tasks(store: TeamTaskStore, source_path: Path | str) -> int:
    """Preserve the file; reject every ambiguous collision or missing binding.

    A marker and all rows commit together. A later change to the retired JSON
    does not become a second authority or resurrect deleted canonical tasks.
    """
    from runtime.memory.cowork.collaboration_store import _normalize_task_payload

    path = Path(source_path).resolve()
    source = str(path)
    with store._lock, store._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute(
            "SELECT 1 FROM collaboration_team_task_imports WHERE source_path=?", (source,)
        ).fetchone():
            return 0
        if not path.exists():
            return 0
        items, digest = _read_legacy(path)
        stamp = datetime.now(UTC).isoformat()
        for item in items:
            room_id = item.get("room_id")
            bound = conn.execute(
                "SELECT session_id FROM collaboration_rooms WHERE room_id=?", (room_id,)
            ).fetchone()
            if bound is None:
                raise TeamTaskConflict("legacy task has no canonical room/session binding")
            session_id = str(bound[0])
            normalized = normalize_task(item, session_id)
            binding = room_binding(conn, session_id, normalized["room_id"])
            existing = conn.execute(
                "SELECT session_id,room_id,task_json,task_authority "
                "FROM collaboration_tasks WHERE task_id=?",
                (normalized["id"],),
            ).fetchone()
            if existing is not None:
                expected_projection = _normalize_task_payload(
                    item,
                    task_id=normalized["id"],
                    room_id=normalized["room_id"],
                    session_id=session_id,
                )
                if (
                    existing[0] != session_id
                    or existing[1] != normalized["room_id"]
                    or existing[3] != "projection"
                    or json.loads(existing[2]) != expected_projection
                ):
                    raise TeamTaskConflict("legacy task conflicts with an existing canonical task")
            if normalized["status"] == "running":
                # JSON has no durable process owner. Import does not claim that
                # an old worker survived cutover or authorize automatic retries.
                normalized.update(status="failed", updated_at=stamp, completed_at=stamp)
                normalized["metadata"].update(
                    failure_code="worker_lost_on_restart",
                    error="legacy task has no durable execution owner after migration",
                    recovered_at=stamp,
                )
            if existing is None:
                insert_task(conn, session_id, normalized)
            else:
                conn.execute(
                    "UPDATE collaboration_tasks SET task_json=?,status=?,updated_at=?,"
                    "task_authority='team',task_revision=1,team_binding_json=? WHERE task_id=?",
                    (
                        dump_payload(normalized),
                        normalized["status"],
                        normalized["updated_at"],
                        dump_payload(binding),
                        normalized["id"],
                    ),
                )
        conn.execute(
            "INSERT INTO collaboration_team_task_imports VALUES(?,?,?,?)",
            (source, digest, len(items), stamp),
        )
        return len(items)
