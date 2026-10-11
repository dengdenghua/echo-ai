"""Read-only coordinate enumeration for authorized ledger projections."""

from __future__ import annotations

from runtime.memory.cowork.ids import require_cowork_id


def tasks_for_session(store, session_id: str, load) -> list[dict]:
    """Project persisted timestamps onto returned copies without changing the ledger."""
    if not session_id:
        return []
    session_id = require_cowork_id(session_id, label="session_id")
    with store._lock, store._connect() as conn:
        rows = conn.execute(
            "SELECT task_json, created_at, updated_at FROM collaboration_tasks WHERE session_id = ? "
            "ORDER BY updated_at DESC, created_at DESC",
            (session_id,),
        ).fetchall()
    tasks = []
    for row in rows:
        if (item := load(row[0])) is not None:
            item.setdefault("created_at", str(row[1]))
            item.setdefault("updated_at", str(row[2]))
            tasks.append(item)
    return tasks


def list_session_ids(store, *, limit: int = 500, offset: int = 0) -> list[str]:
    """Return room/task coordinates; callers must authorize before reading content."""
    bounded_limit = max(1, min(int(limit), 500))
    bounded_offset = max(0, int(offset))
    with store._lock, store._connect() as conn:
        rows = conn.execute(
            "SELECT session_id FROM collaboration_rooms "
            "UNION SELECT session_id FROM collaboration_tasks "
            "ORDER BY session_id LIMIT ? OFFSET ?",
            (bounded_limit, bounded_offset),
        ).fetchall()
    return [str(row[0]) for row in rows]
