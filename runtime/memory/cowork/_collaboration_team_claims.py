"""Process-incarnation leases and cancellation fences for canonical TeamTasks."""

from __future__ import annotations

import math
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime

from runtime.memory.cowork._collaboration_team_records import (
    TeamTaskConflict,
    snapshot,
    write_task,
)
from runtime.platform.process.process_identity import claim_owner_alive


@dataclass(frozen=True)
class TeamTaskClaim:
    task_id: str
    run_token: str
    expires_at: float
    cancel_requested: bool


def lease_seconds(value: float) -> float:
    if isinstance(value, bool) or not math.isfinite(value) or value <= 0:
        raise ValueError("team task lease must be finite and positive")
    return float(value)


def read_claim(conn: sqlite3.Connection, task_id: str) -> TeamTaskClaim | None:
    row = conn.execute(
        "SELECT run_token,expires_at,cancel_requested "
        "FROM collaboration_team_task_claims WHERE task_id=?",
        (task_id,),
    ).fetchone()
    return TeamTaskClaim(task_id, str(row[0]), float(row[1]), bool(row[2])) if row else None


def require_claim(
    conn: sqlite3.Connection, task_id: str, run_token: str, now: float
) -> TeamTaskClaim:
    claim = read_claim(conn, task_id)
    if (
        claim is None
        or claim.run_token != run_token
        or claim.expires_at <= now
        or claim.cancel_requested
    ):
        raise TeamTaskConflict("team task run claim is no longer writable")
    owner = conn.execute(
        "SELECT process_owner FROM collaboration_team_task_claims WHERE task_id=?", (task_id,)
    ).fetchone()
    if owner is None or claim_owner_alive(str(owner[0])) is False:
        raise TeamTaskConflict("team task execution owner is dead")
    return claim


def reconcile_claims(conn: sqlite3.Connection, now: float) -> list[str]:
    """Recover only expired or confirmed dead incarnations, without rerunning."""
    rows = conn.execute(
        "SELECT task_id,process_owner,expires_at FROM collaboration_team_task_claims"
    ).fetchall()
    recovered: list[str] = []
    for task_id, owner, expires_at in rows:
        expired = float(expires_at) <= now or claim_owner_alive(str(owner)) is False
        try:
            current = snapshot(conn, str(task_id))
        except TeamTaskConflict:
            current = None
        if current is None:
            conn.execute(
                "UPDATE collaboration_team_task_claims SET cancel_requested=1 WHERE task_id=?",
                (task_id,),
            )
        if not expired:
            continue
        if current is not None and current.payload["status"] == "running":
            payload = dict(current.payload)
            stamp = datetime.fromtimestamp(now, UTC).isoformat()
            payload.update(status="failed", updated_at=stamp, completed_at=stamp)
            payload["metadata"] = {
                **payload.get("metadata", {}),
                "failure_code": "worker_lost_on_restart",
                "error": "task execution owner died or its lease expired",
                "recovered_at": stamp,
            }
            write_task(conn, current, payload)
            recovered.append(str(task_id))
        conn.execute("DELETE FROM collaboration_team_task_claims WHERE task_id=?", (task_id,))
    return recovered
