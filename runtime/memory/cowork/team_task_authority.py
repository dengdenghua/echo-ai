"""Single TeamTask payload authority backed by ``collaboration_tasks``.

Every write runs against a fresh row in one SQLite transaction. Run tokens
fence workers independently of task revisions; operator edits and process
events can therefore merge while stale preparations and old runs cannot win.
The gateway remains responsible for authenticating and authorizing the actor.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from runtime.memory.cowork._collaboration_team_claims import (
    TeamTaskClaim,
    lease_seconds,
    read_claim,
    reconcile_claims,
    require_claim,
)
from runtime.memory.cowork._collaboration_team_records import (
    TaskMutation,
    TeamTaskCapacity,
    TeamTaskConflict,
    TeamTaskSnapshot,
    insert_task,
    require_snapshot,
    snapshot,
    write_task,
)
from runtime.memory.cowork.ids import require_cowork_id
from runtime.platform.process.process_identity import claim_owner_alive, current_claim_owner

if TYPE_CHECKING:
    from runtime.memory.cowork.collaboration_store import CollaborationStore


class TeamTaskAuthority:
    """Own team rows in a supplied canonical collaboration database."""

    def __init__(self, store: CollaborationStore) -> None:
        self.store = store

    def get(self, task_id: str) -> TeamTaskSnapshot | None:
        task_id = require_cowork_id(task_id, label="task_id")
        with self.store._lock, self.store._connect() as conn:
            return snapshot(conn, task_id)

    def list(self, *, room_id: str | None = None) -> list[TeamTaskSnapshot]:
        with self.store._lock, self.store._connect() as conn:
            if room_id is None:
                rows = conn.execute(
                    "SELECT task_id FROM collaboration_tasks WHERE task_authority='team' "
                    "ORDER BY updated_at DESC,task_id"
                ).fetchall()
            else:
                room_id = require_cowork_id(room_id, label="room_id")
                rows = conn.execute(
                    "SELECT task_id FROM collaboration_tasks "
                    "WHERE task_authority='team' AND room_id=? ORDER BY updated_at DESC,task_id",
                    (room_id,),
                ).fetchall()
            return [require_snapshot(conn, str(row[0])) for row in rows]

    def create(self, session_id: str, task: dict[str, Any]) -> TeamTaskSnapshot:
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return insert_task(conn, session_id, task)

    def mutate(
        self,
        task_id: str,
        mutation: TaskMutation,
        *,
        expected_revision: int | None = None,
        run_token: str | None = None,
    ) -> TeamTaskSnapshot:
        """Merge a worker delta under its token, or an operator delta under CAS."""
        if expected_revision is None and run_token is None:
            raise ValueError("team task mutation requires a revision or run token")
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            current = require_snapshot(conn, task_id, expected_revision)
            if run_token is not None:
                require_claim(conn, task_id, run_token, time.time())
                if current.payload["status"] != "running":
                    raise TeamTaskConflict("team task is no longer running")
            return write_task(conn, current, mutation(current.payload))

    def delete(self, task_id: str, *, expected_revision: int) -> bool:
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            require_snapshot(conn, task_id, expected_revision)
            conn.execute(
                "DELETE FROM collaboration_tasks WHERE task_id=? AND task_authority='team'",
                (task_id,),
            )
            return True

    def claim(
        self,
        task_id: str,
        *,
        expected_revision: int,
        max_concurrent_runs: int,
        lease: float = 60.0,
        mutation: TaskMutation | None = None,
    ) -> tuple[TeamTaskSnapshot, TeamTaskClaim]:
        duration = lease_seconds(lease)
        if type(max_concurrent_runs) is not int or max_concurrent_runs < 1:
            raise ValueError("team task concurrency limit must be a positive integer")
        owner, token = current_claim_owner(), uuid4().hex
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            now = time.time()
            # Reconciliation is a separate operation: a stale preparation never
            # silently becomes permission to start after recovery changed a task.
            current = require_snapshot(conn, task_id, expected_revision)
            if read_claim(conn, task_id) is not None or current.payload["status"] == "running":
                raise TeamTaskConflict("team task already has an execution")
            count = int(
                conn.execute("SELECT COUNT(*) FROM collaboration_team_task_claims").fetchone()[0]
            )
            if count >= max_concurrent_runs:
                raise TeamTaskCapacity("shared team task execution limit reached")
            payload = mutation(current.payload) if mutation else dict(current.payload)
            stamp = datetime.fromtimestamp(now, UTC).isoformat()
            payload.update(status="running", updated_at=stamp, started_at=stamp, completed_at=None)
            started = write_task(conn, current, payload)
            conn.execute(
                "INSERT INTO collaboration_team_task_claims("
                "task_id,run_token,process_owner,expires_at) VALUES(?,?,?,?)",
                (task_id, token, owner, now + duration),
            )
            return started, TeamTaskClaim(task_id, token, now + duration, False)

    def heartbeat(
        self,
        task_id: str,
        run_token: str,
        *,
        lease: float = 60.0,
    ) -> TeamTaskClaim | None:
        duration = lease_seconds(lease)
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            now = time.time()
            claim = read_claim(conn, task_id)
            if claim is None or claim.run_token != run_token or claim.expires_at <= now:
                return None
            owner = conn.execute(
                "SELECT process_owner FROM collaboration_team_task_claims WHERE task_id=?",
                (task_id,),
            ).fetchone()
            if owner is None or claim_owner_alive(str(owner[0])) is False:
                return None
            try:
                current = snapshot(conn, task_id)
            except TeamTaskConflict:
                current = None
            cancelled = (
                claim.cancel_requested or current is None or current.payload["status"] != "running"
            )
            expires_at = claim.expires_at if cancelled else max(claim.expires_at, now + duration)
            conn.execute(
                "UPDATE collaboration_team_task_claims SET expires_at=?,cancel_requested=? "
                "WHERE task_id=? AND run_token=?",
                (expires_at, int(cancelled), task_id, run_token),
            )
            return TeamTaskClaim(task_id, run_token, expires_at, cancelled)

    def release(self, task_id: str, run_token: str) -> bool:
        """Acknowledge stopped execution without unlocking a newer run."""
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            claim = read_claim(conn, task_id)
            if claim is None or claim.run_token != run_token:
                return False
            try:
                current = snapshot(conn, task_id)
            except TeamTaskConflict:
                current = None
            if current is not None and current.payload["status"] == "running":
                stamp = datetime.now(UTC).isoformat()
                payload = dict(current.payload)
                payload.update(status="failed", updated_at=stamp, completed_at=stamp)
                payload["metadata"] = {
                    **payload.get("metadata", {}),
                    "failure_code": "worker_exited_without_terminal",
                }
                write_task(conn, current, payload)
            return bool(
                conn.execute(
                    "DELETE FROM collaboration_team_task_claims WHERE task_id=? AND run_token=?",
                    (task_id, run_token),
                ).rowcount
            )

    def reconcile(self) -> list[str]:
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return reconcile_claims(conn, time.time())

    def import_legacy(self, source_path: Path | str) -> int:
        from runtime.memory.cowork._collaboration_team_import import import_legacy_tasks

        return import_legacy_tasks(self.store, source_path)
