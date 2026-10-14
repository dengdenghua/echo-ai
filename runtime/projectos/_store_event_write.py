"""Append a sealed project event inside an existing SQLite transaction."""

from __future__ import annotations

import json
from typing import Any

from runtime.platform.integrity.chain import GENESIS, seal_step


def insert_sealed_event(conn: Any, event: dict[str, Any]) -> dict[str, Any]:
    project_id = event["project_id"]
    last = conn.execute(
        "SELECT seq, seal FROM project_events WHERE project_id=? ORDER BY seq DESC LIMIT 1",
        (project_id,),
    ).fetchone()
    seq = int(last[0]) + 1 if last else 1
    previous = str(last[1]) if last and last[1] else GENESIS
    payload = json.dumps(event["payload"], ensure_ascii=False)
    event.update(
        seq=seq,
        seal_prev=previous,
        seal=seal_step(
            previous,
            scope=project_id,
            seq=seq,
            record_id=event["id"],
            payload=payload,
            ts=event["created_at"],
        ),
    )
    conn.execute(
        "INSERT INTO project_events(id, project_id, kind, payload, created_at, "
        "seq, seal_prev, seal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            event["id"],
            project_id,
            event["kind"],
            payload,
            event["created_at"],
            seq,
            previous,
            event["seal"],
        ),
    )
    return event
