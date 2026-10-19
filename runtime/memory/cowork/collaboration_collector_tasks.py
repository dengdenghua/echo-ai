"""Archive/retention and retry-task operations for collaboration collectors.

Split out of ``collaboration_collectors`` to keep that module under the
god-file threshold. Inherits :class:`CollaborationCollectorStoreMixin` so
``self`` keeps resolving the shared helpers and connection attributes;
``CollaborationStore`` mixes this class in instead of the base directly.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

from runtime.memory.cowork.collaboration_collectors import (
    _TERMINAL,
    CollaborationCollectorStoreMixin,
    _dump,
    _normalize_children,
    _now,
)
from runtime.memory.cowork.ids import require_cowork_id


class CollaborationCollectorLifecycleMixin(CollaborationCollectorStoreMixin):
    """Archival, retention, and retry-task store operations."""

    @staticmethod
    def _archived_result(item: dict[str, Any]) -> dict[str, Any]:
        """Retain audit identity and hashes while dropping provider payloads."""

        return {
            key: value for key, value in item.items() if key not in {"result", "pending_retry"}
        } | {"result": {"archived": True}}

    def _archive_collector_in_connection(
        self,
        conn: Any,
        run_id: str,
        *,
        reason: str,
        timestamp: str,
    ) -> dict[str, Any]:
        current = self._collector_snapshot(conn, run_id)
        if current is None:
            raise KeyError(f"collaboration collector not found: {run_id}")
        if current.get("archived"):
            return current
        if current["status"] not in _TERMINAL:
            raise ValueError("only terminal collaboration collectors can be archived")
        run_status_row = conn.execute(
            "SELECT status FROM collaboration_runs WHERE run_id=?",
            (run_id,),
        ).fetchone()
        if run_status_row is None:
            raise KeyError(f"collaboration run not found: {run_id}")
        if str(run_status_row[0]) not in {"completed", "failed", "cancelled"}:
            raise ValueError("collector cannot be archived before its parent run is terminal")
        attempts = self._collector_attempts(conn, run_id)
        steering_rows = conn.execute(
            "SELECT child_id,generation,seq,text,actor_id,created_at "
            "FROM collaboration_collector_steering WHERE run_id=? "
            "ORDER BY generation,seq,child_id",
            (run_id,),
        ).fetchall()
        archived_steering = [
            {
                "schema": "echo.collaboration_steering.v1",
                "run_id": run_id,
                "child_id": str(child_id),
                "generation": int(generation),
                "seq": int(seq),
                "actor_id": str(actor_id),
                "created_at": str(created_at),
                "text_chars": len(str(text)),
                "text_sha256": hashlib.sha256(str(text).encode("utf-8")).hexdigest(),
                "archived": True,
            }
            for child_id, generation, seq, text, actor_id, created_at in steering_rows
        ]
        archived_snapshot = {
            **current,
            "active_retry_child_ids": [],
            "archived": True,
            "archived_at": timestamp,
            "results": [self._archived_result(item) for item in current.get("results") or []],
        }
        archive_payload = {
            "schema": "echo.collaboration_collector_archive.v1",
            "reason": str(reason or "collector retention policy")[:1000],
            "snapshot": archived_snapshot,
            "attempts": [self._archived_result(item) for item in attempts],
            "steering": archived_steering,
        }
        conn.execute(
            "UPDATE collaboration_collectors SET archived_at=?,archive_json=?,retry_json='[]',"
            "revision=revision+1,updated_at=? WHERE run_id=? AND archived_at IS NULL",
            (timestamp, _dump(archive_payload), timestamp, run_id),
        )
        # The compact archive retains child identity, status, attempt, hash and
        # timestamps, but releases potentially large model bodies and obsolete
        # retry bindings.
        conn.execute("DELETE FROM collaboration_collector_results WHERE run_id=?", (run_id,))
        conn.execute(
            "DELETE FROM collaboration_collector_retry_tasks WHERE run_id=?",
            (run_id,),
        )
        conn.execute("DELETE FROM collaboration_collector_steering WHERE run_id=?", (run_id,))
        self._append_run_event(
            conn,
            run_id=run_id,
            event_type="collector_archived",
            status=str(run_status_row[0]) if run_status_row else str(current["status"]),
            payload={
                "reason": archive_payload["reason"],
                "attempt_count": int(current.get("attempt_count") or 0),
                "result_count": len(current.get("results") or []),
                "steering_count": len(archived_steering),
            },
            created_at=timestamp,
        )
        archived = self._collector_snapshot(conn, run_id)
        assert archived is not None
        return archived

    def archive_collaboration_collectors(
        self,
        run_ids: list[str] | tuple[str, ...],
        *,
        reason: str = "collector archived by user",
    ) -> list[dict[str, Any]]:
        """Compact a batch of terminal collectors in one SQLite transaction."""

        normalized = list(
            dict.fromkeys(require_cowork_id(run_id, label="run_id") for run_id in run_ids)
        )
        if not normalized:
            return []
        timestamp = _now()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return [
                self._archive_collector_in_connection(
                    conn,
                    run_id,
                    reason=reason,
                    timestamp=timestamp,
                )
                for run_id in normalized
            ]

    def apply_collaboration_collector_retention(
        self,
        *,
        session_id: str | None = None,
        ttl_seconds: int = 90 * 24 * 60 * 60,
        max_collectors_per_session: int = 1000,
    ) -> dict[str, Any]:
        """Archive old terminal collectors by age and per-session count.

        ``0`` disables the corresponding axis. Active collectors are always
        pinned. The operation is idempotent and safe to run at startup or from
        the operations read path.
        """

        session = (
            require_cowork_id(session_id, label="session_id") if session_id is not None else None
        )
        ttl = max(0, int(ttl_seconds))
        cap = max(0, int(max_collectors_per_session))
        if ttl == 0 and cap == 0:
            return {"archived": 0, "run_ids": []}
        now = datetime.now(UTC)
        cutoff = now - timedelta(seconds=ttl) if ttl else None
        timestamp = now.isoformat()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            sql = (
                "SELECT c.run_id,r.session_id,c.updated_at "
                "FROM collaboration_collectors c "
                "INNER JOIN collaboration_runs r ON r.run_id=c.run_id "
                "WHERE c.archived_at IS NULL AND c.status IN ('completed','failed','cancelled') "
                "AND r.status IN ('completed','failed','cancelled')"
            )
            params: tuple[Any, ...] = ()
            if session is not None:
                sql += " AND r.session_id=?"
                params = (session,)
            sql += " ORDER BY r.session_id,c.updated_at DESC,c.run_id DESC"
            rows = conn.execute(sql, params).fetchall()
            ranks: dict[str, int] = {}
            selected: list[str] = []
            for run_id, row_session, updated_at in rows:
                session_key = str(row_session)
                rank = ranks.get(session_key, 0)
                ranks[session_key] = rank + 1
                over_cap = cap > 0 and rank >= cap
                expired = False
                if cutoff is not None:
                    try:
                        updated = datetime.fromisoformat(str(updated_at))
                        if updated.tzinfo is None:
                            updated = updated.replace(tzinfo=UTC)
                        expired = updated.astimezone(UTC) <= cutoff
                    except (TypeError, ValueError):
                        expired = False
                if over_cap or expired:
                    selected.append(str(run_id))
            archived = [
                self._archive_collector_in_connection(
                    conn,
                    run_id,
                    reason="collector retention policy",
                    timestamp=timestamp,
                )
                for run_id in selected
            ]
        return {
            "archived": len(archived),
            "run_ids": [str(item["run_id"]) for item in archived],
        }

    def bind_collaboration_collector_retry_task(
        self,
        run_id: str,
        *,
        child_id: str,
        task_id: str,
    ) -> dict[str, Any]:
        """Durably connect a task to an active or next retry generation.

        A terminal collector accepts a pre-binding for its next generation.
        This closes the crash window between reopening the collector and
        making the staged background batch runnable.
        """

        run_id = require_cowork_id(run_id, label="run_id")
        child_id = require_cowork_id(child_id, label="collector child_id")
        task_id = require_cowork_id(task_id, label="task_id")
        timestamp = _now()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            collector = self._collector_snapshot(conn, run_id)
            if collector is None:
                raise KeyError(f"collaboration collector not found: {run_id}")
            if collector.get("archived"):
                raise ValueError("archived collaboration collector cannot be retried")
            if collector["status"] == "collecting":
                if child_id not in collector["active_retry_child_ids"]:
                    raise ValueError("child_id is not active in this collector retry generation")
                generation = int(collector["generation"])
            elif collector["status"] in _TERMINAL:
                retryable = [
                    str(item["child_id"])
                    for item in collector["results"]
                    if item["status"] in {"failed", "cancelled"}
                ]
                retryable.extend(collector["cancellation_requested_child_ids"])
                if child_id not in retryable:
                    raise ValueError("child_id does not have a retryable result")
                generation = int(collector["generation"]) + 1
            else:
                raise ValueError("collector is not accepting retry tasks")
            existing = conn.execute(
                "SELECT run_id,child_id,generation,created_at "
                "FROM collaboration_collector_retry_tasks WHERE task_id=?",
                (task_id,),
            ).fetchone()
            identity = (run_id, child_id, generation)
            if existing is not None:
                if tuple(existing[:3]) != identity:
                    raise ValueError("task_id already belongs to a different collector retry")
                return {
                    "task_id": task_id,
                    "run_id": str(existing[0]),
                    "child_id": str(existing[1]),
                    "generation": int(existing[2]),
                    "created_at": str(existing[3]),
                }
            occupied = conn.execute(
                "SELECT task_id,created_at FROM collaboration_collector_retry_tasks "
                "WHERE run_id=? AND child_id=? AND generation=? LIMIT 1",
                identity,
            ).fetchone()
            if occupied is not None:
                raise ValueError(f"collector retry lane already has a task: {str(occupied[0])}")
            conn.execute(
                "INSERT INTO collaboration_collector_retry_tasks"
                "(task_id,run_id,child_id,generation,created_at) VALUES (?,?,?,?,?)",
                (task_id, run_id, child_id, generation, timestamp),
            )
        return {
            "task_id": task_id,
            "run_id": run_id,
            "child_id": child_id,
            "generation": generation,
            "created_at": timestamp,
        }

    def collaboration_collector_retry_task(self, task_id: str) -> dict[str, Any] | None:
        task_id = require_cowork_id(task_id, label="task_id")
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT run_id,child_id,generation,created_at "
                "FROM collaboration_collector_retry_tasks WHERE task_id=?",
                (task_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "task_id": task_id,
            "run_id": str(row[0]),
            "child_id": str(row[1]),
            "generation": int(row[2]),
            "created_at": str(row[3]),
        }

    def collaboration_collector_retry_tasks(
        self,
        run_id: str,
        *,
        generation: int | None = None,
    ) -> list[dict[str, Any]]:
        """Return durable queue bindings for one collector attempt."""

        run_id = require_cowork_id(run_id, label="run_id")
        params: list[Any] = [run_id]
        sql = (
            "SELECT task_id,child_id,generation,created_at "
            "FROM collaboration_collector_retry_tasks WHERE run_id=?"
        )
        if generation is not None:
            generation = max(1, int(generation))
            sql += " AND generation=?"
            params.append(generation)
        sql += " ORDER BY generation,created_at,task_id"
        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        return [
            {
                "task_id": str(row[0]),
                "run_id": run_id,
                "child_id": str(row[1]),
                "generation": int(row[2]),
                "created_at": str(row[3]),
            }
            for row in rows
        ]

    def discard_collaboration_collector_retry_tasks(
        self,
        task_ids: list[str] | tuple[str, ...],
    ) -> int:
        """Release pre-bindings for a batch that never became runnable."""

        normalized = list(
            dict.fromkeys(require_cowork_id(task_id, label="task_id") for task_id in task_ids)
        )
        if not normalized:
            return 0
        placeholders = ",".join("?" for _ in normalized)
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            deleted = conn.execute(
                "DELETE FROM collaboration_collector_retry_tasks "
                f"WHERE task_id IN ({placeholders})",  # nosec B608 - placeholders only
                normalized,
            ).rowcount
        return int(deleted or 0)

    def reopen_collaboration_collector(
        self,
        run_id: str,
        *,
        child_ids: list[str] | tuple[str, ...] | None = None,
    ) -> dict[str, Any]:
        """Open a new attempt for failed or explicitly cancelled children.

        Previous attempts remain append-only. The current snapshot projects
        only the latest attempt per child, so a successful retry replaces a
        failed lane for policy calculation without erasing its audit trail.
        """

        run_id = require_cowork_id(run_id, label="run_id")
        timestamp = _now()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            current = self._collector_snapshot(conn, run_id)
            if current is None:
                raise KeyError(f"collaboration collector not found: {run_id}")
            if current.get("archived"):
                raise ValueError("archived collaboration collector cannot be reopened")
            if current["status"] not in _TERMINAL:
                raise ValueError("collector must be settled before reopening")
            expected = list(current["expected_child_ids"])
            retryable = [
                str(item["child_id"])
                for item in current["results"]
                if item["status"] in {"failed", "cancelled"}
            ]
            retryable.extend(current["cancellation_requested_child_ids"])
            retryable = list(dict.fromkeys(retryable))
            retrying = retryable if child_ids is None else _normalize_children(child_ids)
            unknown = [child_id for child_id in retrying if child_id not in expected]
            if unknown:
                raise ValueError(f"child_id is not registered with this collector: {unknown[0]}")
            not_retryable = [child_id for child_id in retrying if child_id not in retryable]
            if not_retryable:
                raise ValueError(f"child_id already has a successful result: {not_retryable[0]}")
            if not retrying:
                raise ValueError("collector has no failed or cancelled children to retry")
            generation = int(current["generation"]) + 1
            conn.execute(
                "UPDATE collaboration_collectors SET status='collecting',policy_satisfied=0,"
                "generation=?,revision=revision+1,cancelled_json='[]',retry_json=?,"
                "settled_at=NULL,updated_at=? WHERE run_id=?",
                (generation, _dump(retrying), timestamp, run_id),
            )
            run_status_row = conn.execute(
                "SELECT status FROM collaboration_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            self._append_run_event(
                conn,
                run_id=run_id,
                event_type="collector_reopened",
                status=str(run_status_row[0]) if run_status_row else "running",
                payload={"generation": generation, "child_ids": retrying},
                created_at=timestamp,
            )
            snapshot = self._collector_snapshot(conn, run_id)
        assert snapshot is not None
        return snapshot
