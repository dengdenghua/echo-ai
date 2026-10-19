"""Durable fan-out result collectors for multi-agent collaboration runs.

Workers may finish on different processes, and the coordinator may restart
between dispatch and synthesis.  A collector therefore stores each child
outcome independently, applies the completion policy transactionally, and
keeps terminal settlement immutable.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from runtime.memory.cowork.ids import normalize_actor_id, require_cowork_id
from runtime.platform.io.sqlite_schema import add_column, has_column

COLLABORATION_COLLECTOR_SCHEMA = """
CREATE TABLE IF NOT EXISTS collaboration_collectors (
    run_id              TEXT PRIMARY KEY,
    completion_policy   TEXT NOT NULL,
    completion_target   INTEGER NOT NULL,
    expected_json       TEXT NOT NULL,
    cancelled_json      TEXT NOT NULL DEFAULT '[]',
    retry_json          TEXT NOT NULL DEFAULT '[]',
    status              TEXT NOT NULL,
    policy_satisfied    INTEGER NOT NULL DEFAULT 0,
    generation          INTEGER NOT NULL DEFAULT 1,
    revision            INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    settled_at          TEXT,
    updated_at          TEXT NOT NULL,
    archived_at         TEXT,
    archive_json        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_collab_collectors_status
ON collaboration_collectors(status, updated_at);

CREATE TABLE IF NOT EXISTS collaboration_collector_results (
    run_id       TEXT NOT NULL,
    child_id     TEXT NOT NULL,
    attempt      INTEGER NOT NULL DEFAULT 1,
    ordinal      INTEGER NOT NULL,
    status       TEXT NOT NULL,
    result_json  TEXT NOT NULL,
    result_sha256 TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (run_id, child_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_collab_collector_results_run
ON collaboration_collector_results(run_id, ordinal);

CREATE TABLE IF NOT EXISTS collaboration_collector_retry_tasks (
    task_id    TEXT PRIMARY KEY,
    run_id     TEXT NOT NULL,
    child_id   TEXT NOT NULL,
    generation INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_collector_retry_tasks_run
ON collaboration_collector_retry_tasks(run_id, generation);

CREATE TABLE IF NOT EXISTS collaboration_collector_steering (
    run_id       TEXT NOT NULL,
    child_id     TEXT NOT NULL,
    generation   INTEGER NOT NULL,
    seq          INTEGER NOT NULL,
    text         TEXT NOT NULL,
    actor_id     TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (run_id, child_id, generation, seq)
);
CREATE INDEX IF NOT EXISTS idx_collab_collector_steering_run
ON collaboration_collector_steering(run_id, child_id, generation, seq);
"""

_COLLECTOR_SCHEMA = "echo.collaboration_collector.v1"
_CHILD_SCHEMA = "echo.collaboration_collector_child.v1"
_POLICIES = frozenset({"all", "first_completed", "first_success", "quorum"})
_CHILD_STATUSES = frozenset({"success", "failed", "cancelled"})
_TERMINAL = frozenset({"completed", "failed", "cancelled"})
_MAX_CHILDREN = 512
_MAX_CHILD_RESULT_BYTES = 64 * 1024
_MAX_COLLECTOR_RESULT_BYTES = 4 * 1024 * 1024
_MAX_STEERING_TEXT_LENGTH = 20_000


class CollaborationSteeringConflictError(ValueError):
    """A member result was produced before the newest accepted correction."""


def ensure_collaboration_collector_schema(conn: Any) -> None:
    """Apply the additive/rebuild migration for pre-attempt collectors."""

    table = "collaboration_collectors"
    add_column(conn, table, "retry_json", "TEXT NOT NULL DEFAULT '[]'")
    add_column(conn, table, "generation", "INTEGER NOT NULL DEFAULT 1")
    add_column(conn, table, "archived_at", "TEXT")
    add_column(conn, table, "archive_json", "TEXT NOT NULL DEFAULT '{}'")
    results = "collaboration_collector_results"
    if has_column(conn, results, "run_id") and not has_column(conn, results, "attempt"):
        conn.execute(
            "ALTER TABLE collaboration_collector_results "
            "RENAME TO collaboration_collector_results_v1"
        )
        conn.execute(
            "CREATE TABLE collaboration_collector_results ("
            "run_id TEXT NOT NULL,child_id TEXT NOT NULL,"
            "attempt INTEGER NOT NULL DEFAULT 1,ordinal INTEGER NOT NULL,"
            "status TEXT NOT NULL,result_json TEXT NOT NULL,result_sha256 TEXT NOT NULL,"
            "completed_at TEXT NOT NULL,PRIMARY KEY (run_id,child_id,attempt))"
        )
        conn.execute(
            "INSERT INTO collaboration_collector_results"
            "(run_id,child_id,attempt,ordinal,status,result_json,result_sha256,completed_at) "
            "SELECT run_id,child_id,1,ordinal,status,result_json,result_sha256,completed_at "
            "FROM collaboration_collector_results_v1"
        )
        conn.execute("DROP TABLE collaboration_collector_results_v1")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_collab_collector_results_run "
            "ON collaboration_collector_results(run_id,ordinal)"
        )


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _load_object(value: Any) -> dict[str, Any]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def _load_list(value: Any) -> list[str]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        return []
    return [str(item) for item in decoded] if isinstance(decoded, list) else []


def _normalize_result(value: Any) -> tuple[dict[str, Any], str, str]:
    if value is None:
        payload: dict[str, Any] = {}
    elif isinstance(value, dict):
        payload = value
    else:
        raise ValueError("collector child result must be an object")
    try:
        blob = _dump(payload)
    except (TypeError, ValueError) as exc:
        raise ValueError("collector child result must be JSON serializable") from exc
    if len(blob.encode("utf-8")) > _MAX_CHILD_RESULT_BYTES:
        raise ValueError(f"collector child result exceeds {_MAX_CHILD_RESULT_BYTES} bytes")
    normalized = json.loads(blob)
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()
    return normalized, blob, digest


def _normalize_children(child_ids: list[str] | tuple[str, ...]) -> list[str]:
    if not isinstance(child_ids, (list, tuple)):
        raise ValueError("child_ids must be a list")
    children = list(
        dict.fromkeys(
            require_cowork_id(child_id, label="collector child_id") for child_id in child_ids
        )
    )
    if not children:
        raise ValueError("collector requires at least one child")
    if len(children) > _MAX_CHILDREN:
        raise ValueError(f"collector supports at most {_MAX_CHILDREN} children")
    return children


def _normalize_steering_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("steering text is required")
    if len(text) > _MAX_STEERING_TEXT_LENGTH:
        raise ValueError(f"steering text must be at most {_MAX_STEERING_TEXT_LENGTH} characters")
    if any((ord(char) < 32 and char not in "\n\r\t") or ord(char) == 127 for char in text):
        raise ValueError("steering text contains unsupported control characters")
    return text


def _effective_results(
    results: list[dict[str, Any]],
    *,
    retrying: list[str],
    generation: int,
) -> list[dict[str, Any]]:
    retry_set = set(retrying)
    return [
        result
        for result in results
        if result["child_id"] not in retry_set or int(result.get("attempt") or 1) >= generation
    ]


def _collector_from_row(row: tuple[Any, ...], results: list[dict[str, Any]]) -> dict[str, Any]:
    archived_at = str(row[13]) if len(row) > 13 and row[13] else None
    if archived_at:
        archive = _load_object(row[14] if len(row) > 14 else "{}")
        archived = archive.get("snapshot")
        archived = dict(archived) if isinstance(archived, dict) else {}
        archived.update(
            {
                "schema": _COLLECTOR_SCHEMA,
                "run_id": str(row[0]),
                "revision": int(row[9]),
                "updated_at": str(row[12]),
                "archived": True,
                "archived_at": archived_at,
            }
        )
        return archived
    expected = _load_list(row[3])
    cancelled = _load_list(row[4])
    retrying = _load_list(row[5])
    generation = int(row[8])
    effective = _effective_results(results, retrying=retrying, generation=generation)
    successes = sum(1 for result in effective if result["status"] == "success")
    failures = sum(1 for result in effective if result["status"] == "failed")
    child_cancelled = sum(1 for result in effective if result["status"] == "cancelled")
    completed = len(effective)
    completed_ids = {str(result["child_id"]) for result in effective}
    remaining = [child_id for child_id in expected if child_id not in completed_ids]
    retry_set = set(retrying)
    projected_results = [
        {
            **result,
            "pending_retry": (
                result["child_id"] in retry_set and int(result.get("attempt") or 1) < generation
            ),
        }
        for result in results
    ]
    return {
        "schema": _COLLECTOR_SCHEMA,
        "run_id": str(row[0]),
        "completion_policy": str(row[1]),
        "completion_target": int(row[2]),
        "expected_child_ids": expected,
        "expected_count": len(expected),
        "status": str(row[6]),
        "policy_satisfied": bool(row[7]),
        "generation": generation,
        "revision": int(row[9]),
        "created_at": str(row[10]),
        "settled_at": str(row[11]) if row[11] else None,
        "updated_at": str(row[12]),
        "archived": False,
        "archived_at": None,
        "success_count": successes,
        "failure_count": failures,
        "child_cancelled_count": child_cancelled,
        "completed_count": completed,
        "remaining_count": len(remaining),
        "remaining_child_ids": remaining,
        "cancellation_requested_child_ids": cancelled,
        "active_retry_child_ids": retrying,
        "results": projected_results,
    }


_COLLECTOR_COLUMNS = (
    "run_id,completion_policy,completion_target,expected_json,cancelled_json,retry_json,status,"
    "policy_satisfied,generation,revision,created_at,settled_at,updated_at,"
    "archived_at,archive_json"
)


class CollaborationCollectorStoreMixin:
    """SQLite-backed collector mixed into the canonical collaboration store."""

    _lock: Any
    _connect: Any
    _append_run_event: Any

    @staticmethod
    def _collector_results(conn: Any, run_id: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            "SELECT r.child_id,r.attempt,r.ordinal,r.status,r.result_json,r.result_sha256,"
            "r.completed_at FROM collaboration_collector_results r "
            "INNER JOIN (SELECT child_id,MAX(attempt) AS attempt "
            "FROM collaboration_collector_results WHERE run_id=? GROUP BY child_id) latest "
            "ON latest.child_id=r.child_id AND latest.attempt=r.attempt "
            "WHERE r.run_id=? ORDER BY r.ordinal",
            (run_id, run_id),
        ).fetchall()
        return [
            {
                "schema": _CHILD_SCHEMA,
                "child_id": str(child_id),
                "attempt": int(attempt),
                "ordinal": int(ordinal),
                "status": str(status),
                "result": _load_object(result_json),
                "result_sha256": str(result_sha256),
                "completed_at": str(completed_at),
            }
            for child_id, attempt, ordinal, status, result_json, result_sha256, completed_at in rows
        ]

    @classmethod
    def _collector_snapshot(cls, conn: Any, run_id: str) -> dict[str, Any] | None:
        row = conn.execute(
            f"SELECT {_COLLECTOR_COLUMNS} FROM collaboration_collectors WHERE run_id=?",  # nosec B608 # literal column list; query values are bound
            (run_id,),
        ).fetchone()
        if row is None:
            return None
        snapshot = _collector_from_row(row, cls._collector_results(conn, run_id))
        if not snapshot.get("archived"):
            snapshot["attempt_count"] = int(
                conn.execute(
                    "SELECT COUNT(*) FROM collaboration_collector_results WHERE run_id=?",
                    (run_id,),
                ).fetchone()[0]
            )
        return snapshot

    @staticmethod
    def _collector_attempts(conn: Any, run_id: str) -> list[dict[str, Any]]:
        archive_row = conn.execute(
            "SELECT archived_at,archive_json FROM collaboration_collectors WHERE run_id=?",
            (run_id,),
        ).fetchone()
        if archive_row is not None and archive_row[0]:
            archive = _load_object(archive_row[1])
            attempts = archive.get("attempts")
            return (
                [dict(item) for item in attempts if isinstance(item, dict)]
                if isinstance(attempts, list)
                else []
            )
        rows = conn.execute(
            "SELECT child_id,attempt,ordinal,status,result_json,result_sha256,completed_at "
            "FROM collaboration_collector_results WHERE run_id=? ORDER BY ordinal,attempt",
            (run_id,),
        ).fetchall()
        return [
            {
                "schema": _CHILD_SCHEMA,
                "child_id": str(child_id),
                "attempt": int(attempt),
                "ordinal": int(ordinal),
                "status": str(status),
                "result": _load_object(result_json),
                "result_sha256": str(result_sha256),
                "completed_at": str(completed_at),
            }
            for child_id, attempt, ordinal, status, result_json, result_sha256, completed_at in rows
        ]

    def create_collaboration_collector(
        self,
        *,
        run_id: str,
        child_ids: list[str] | tuple[str, ...],
        completion_policy: str = "all",
        quorum: int | None = None,
    ) -> dict[str, Any]:
        run_id = require_cowork_id(run_id, label="run_id")
        children = _normalize_children(child_ids)
        policy = str(completion_policy or "all").strip().lower().replace("-", "_")
        if policy == "first":
            policy = "first_completed"
        if policy not in _POLICIES:
            raise ValueError(
                "completion_policy must be all | first_completed | first_success | quorum"
            )
        if policy == "quorum":
            try:
                target = int(quorum) if quorum is not None else len(children) // 2 + 1
            except (TypeError, ValueError) as exc:
                raise ValueError("quorum must be an integer") from exc
            target = max(1, min(target, len(children)))
        else:
            target = len(children) if policy == "all" else 1
        timestamp = _now()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            run_status_row = conn.execute(
                "SELECT status FROM collaboration_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if run_status_row is None:
                raise KeyError(f"collaboration run not found: {run_id}")
            current = self._collector_snapshot(conn, run_id)
            if current is not None:
                identity = (
                    current["completion_policy"],
                    current["completion_target"],
                    current["expected_child_ids"],
                )
                if identity != (policy, target, children):
                    raise ValueError("run_id already belongs to a different collector")
                return current
            conn.execute(
                "INSERT INTO collaboration_collectors"
                "(run_id,completion_policy,completion_target,expected_json,status,created_at,updated_at) "
                "VALUES (?,?,?,?,'collecting',?,?)",
                (run_id, policy, target, _dump(children), timestamp, timestamp),
            )
            self._append_run_event(
                conn,
                run_id=run_id,
                event_type="collector_created",
                status=str(run_status_row[0]),
                payload={
                    "completion_policy": policy,
                    "completion_target": target,
                    "expected_count": len(children),
                },
                created_at=timestamp,
            )
            snapshot = self._collector_snapshot(conn, run_id)
        assert snapshot is not None
        return snapshot

    def close_collaboration_collector(
        self,
        run_id: str,
        *,
        status: str = "cancelled",
        reason: str = "collector closed before every child completed",
    ) -> dict[str, Any] | None:
        """Settle an incomplete collector when its parent run terminates."""

        run_id = require_cowork_id(run_id, label="run_id")
        target = str(status or "").strip().lower()
        if target not in {"failed", "cancelled"}:
            raise ValueError("collector close status must be failed | cancelled")
        timestamp = _now()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            current = self._collector_snapshot(conn, run_id)
            if current is None or current["status"] in _TERMINAL:
                return current
            cancel_ids = list(current["remaining_child_ids"])
            conn.execute(
                "UPDATE collaboration_collectors SET status=?,policy_satisfied=0,"
                "cancelled_json=?,revision=revision+1,settled_at=?,updated_at=? WHERE run_id=?",
                (target, _dump(cancel_ids), timestamp, timestamp, run_id),
            )
            run_status_row = conn.execute(
                "SELECT status FROM collaboration_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            self._append_run_event(
                conn,
                run_id=run_id,
                event_type="collector_closed",
                status=str(run_status_row[0]) if run_status_row else target,
                payload={
                    "collector_status": target,
                    "reason": str(reason or "")[:1000],
                    "cancellation_requested_count": len(cancel_ids),
                },
                created_at=timestamp,
            )
            snapshot = self._collector_snapshot(conn, run_id)
        assert snapshot is not None
        return snapshot

    def collaboration_collector(self, run_id: str) -> dict[str, Any] | None:
        run_id = require_cowork_id(run_id, label="run_id")
        with self._lock, self._connect() as conn:
            return self._collector_snapshot(conn, run_id)

    def collaboration_collector_attempts(self, run_id: str) -> list[dict[str, Any]]:
        run_id = require_cowork_id(run_id, label="run_id")
        with self._lock, self._connect() as conn:
            return self._collector_attempts(conn, run_id)

    def submit_collaboration_collector_steering(
        self,
        run_id: str,
        *,
        child_id: str,
        text: str,
        actor_id: str = "user",
    ) -> dict[str, Any]:
        """Persist one ordered correction for an active collector member.

        Delivery is cursor based rather than destructively consumed. A worker
        restart therefore replays the current generation from sequence zero,
        while one live worker advances only its in-memory cursor.
        """

        run_id = require_cowork_id(run_id, label="run_id")
        child_id = require_cowork_id(child_id, label="collector child_id")
        correction = _normalize_steering_text(text)
        actor = normalize_actor_id(actor_id or "user", label="actor_id") or "user"
        timestamp = _now()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            collector = self._collector_snapshot(conn, run_id)
            if collector is None:
                raise KeyError(f"collaboration collector not found: {run_id}")
            if collector.get("archived") or collector.get("status") != "collecting":
                raise ValueError("collaboration collector is not accepting steering")
            if child_id not in collector.get("expected_child_ids", []):
                raise ValueError("child_id is not registered with this collector")
            if child_id not in collector.get("remaining_child_ids", []):
                raise ValueError("collector child has already settled")
            generation = int(collector.get("generation") or 1)
            seq = int(
                conn.execute(
                    "SELECT COALESCE(MAX(seq),0)+1 FROM collaboration_collector_steering "
                    "WHERE run_id=? AND child_id=? AND generation=?",
                    (run_id, child_id, generation),
                ).fetchone()[0]
            )
            conn.execute(
                "INSERT INTO collaboration_collector_steering"
                "(run_id,child_id,generation,seq,text,actor_id,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (run_id, child_id, generation, seq, correction, actor, timestamp),
            )
            conn.execute(
                "UPDATE collaboration_collectors SET revision=revision+1,updated_at=? "
                "WHERE run_id=?",
                (timestamp, run_id),
            )
            run_status_row = conn.execute(
                "SELECT status FROM collaboration_runs WHERE run_id=?",
                (run_id,),
            ).fetchone()
            self._append_run_event(
                conn,
                run_id=run_id,
                event_type="collector_child_steered",
                status=str(run_status_row[0]) if run_status_row else "running",
                payload={
                    "child_id": child_id,
                    "generation": generation,
                    "seq": seq,
                    "actor_id": actor,
                    "text_chars": len(correction),
                    "text_sha256": hashlib.sha256(correction.encode("utf-8")).hexdigest(),
                },
                created_at=timestamp,
            )
            updated = self._collector_snapshot(conn, run_id)
        assert updated is not None
        return {
            "steering": {
                "schema": "echo.collaboration_steering.v1",
                "run_id": run_id,
                "child_id": child_id,
                "generation": generation,
                "seq": seq,
                "text": correction,
                "actor_id": actor,
                "created_at": timestamp,
            },
            "collector": updated,
        }

    def collaboration_collector_steering(
        self,
        run_id: str,
        *,
        child_id: str | None = None,
        generation: int | None = None,
        after_seq: int = 0,
    ) -> list[dict[str, Any]]:
        """Read an ordered steering stream without consuming durable rows."""

        run_id = require_cowork_id(run_id, label="run_id")
        normalized_child = (
            require_cowork_id(child_id, label="collector child_id") if child_id else None
        )
        try:
            after = max(0, int(after_seq))
        except (TypeError, ValueError):
            after = 0
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT generation,archived_at,archive_json FROM collaboration_collectors "
                "WHERE run_id=?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise KeyError(f"collaboration collector not found: {run_id}")
            selected_generation = int(generation if generation is not None else row[0])
            if row[1]:
                archived = _load_object(row[2]).get("steering")
                values = (
                    [dict(item) for item in archived if isinstance(item, dict)]
                    if isinstance(archived, list)
                    else []
                )
                return [
                    item
                    for item in values
                    if int(item.get("generation") or 0) == selected_generation
                    and int(item.get("seq") or 0) > after
                    and (normalized_child is None or item.get("child_id") == normalized_child)
                ]
            clauses = ["run_id=?", "generation=?", "seq>?"]
            params: list[Any] = [run_id, selected_generation, after]
            if normalized_child is not None:
                clauses.append("child_id=?")
                params.append(normalized_child)
            rows = conn.execute(
                "SELECT child_id,generation,seq,text,actor_id,created_at "  # nosec B608 # fixed predicates; all steering values are bound
                "FROM collaboration_collector_steering WHERE "
                + " AND ".join(clauses)
                + " ORDER BY seq,child_id",
                params,
            ).fetchall()
        return [
            {
                "schema": "echo.collaboration_steering.v1",
                "run_id": run_id,
                "child_id": str(row[0]),
                "generation": int(row[1]),
                "seq": int(row[2]),
                "text": str(row[3]),
                "actor_id": str(row[4]),
                "created_at": str(row[5]),
            }
            for row in rows
        ]

    def record_collaboration_collector_result(
        self,
        run_id: str,
        *,
        child_id: str,
        status: str,
        result: dict[str, Any] | None = None,
        expected_generation: int | None = None,
        expected_steering_seq: int | None = None,
    ) -> dict[str, Any]:
        run_id = require_cowork_id(run_id, label="run_id")
        child_id = require_cowork_id(child_id, label="collector child_id")
        child_status = str(status or "").strip().lower()
        if child_status not in _CHILD_STATUSES:
            raise ValueError("collector child status must be success | failed | cancelled")
        _payload, result_blob, digest = _normalize_result(result)
        timestamp = _now()
        with self._lock, self._connect() as conn:
            # Serialize policy settlement across independent worker processes,
            # not merely threads sharing one CollaborationStore instance.
            conn.execute("BEGIN IMMEDIATE")
            collector = conn.execute(
                f"SELECT {_COLLECTOR_COLUMNS} FROM collaboration_collectors WHERE run_id=?",  # nosec B608 # literal column list; query values are bound
                (run_id,),
            ).fetchone()
            if collector is None:
                raise KeyError(f"collaboration collector not found: {run_id}")
            expected = _load_list(collector[3])
            if child_id not in expected:
                raise ValueError("child_id is not registered with this collector")
            collector_status = str(collector[6])
            generation = int(collector[8])
            if expected_generation is not None and int(expected_generation) != generation:
                raise ValueError("collector retry task belongs to a stale generation")
            if expected_steering_seq is not None:
                latest_steering_seq = int(
                    conn.execute(
                        "SELECT COALESCE(MAX(seq),0) "
                        "FROM collaboration_collector_steering "
                        "WHERE run_id=? AND child_id=? AND generation=?",
                        (run_id, child_id, generation),
                    ).fetchone()[0]
                )
                if int(expected_steering_seq) != latest_steering_seq:
                    raise CollaborationSteeringConflictError(
                        "collector member result predates accepted steering"
                    )
            existing = conn.execute(
                "SELECT status,result_sha256 FROM collaboration_collector_results "
                "WHERE run_id=? AND child_id=? AND attempt=?",
                (run_id, child_id, generation),
            ).fetchone()
            if existing is not None:
                if (str(existing[0]), str(existing[1])) != (child_status, digest):
                    raise ValueError("collector child result is immutable")
                snapshot = self._collector_snapshot(conn, run_id)
                assert snapshot is not None
                return snapshot
            if collector_status in _TERMINAL:
                latest = conn.execute(
                    "SELECT status,result_sha256 FROM collaboration_collector_results "
                    "WHERE run_id=? AND child_id=? ORDER BY attempt DESC LIMIT 1",
                    (run_id, child_id),
                ).fetchone()
                if latest is not None and (str(latest[0]), str(latest[1])) == (
                    child_status,
                    digest,
                ):
                    snapshot = self._collector_snapshot(conn, run_id)
                    assert snapshot is not None
                    return snapshot
                raise ValueError("collector is already settled")
            retrying = _load_list(collector[5])
            if retrying and child_id not in retrying:
                raise ValueError("child_id is not active in this collector retry generation")
            stored_bytes = int(
                conn.execute(
                    "SELECT COALESCE(SUM(length(CAST(result_json AS BLOB))),0) "
                    "FROM collaboration_collector_results WHERE run_id=?",
                    (run_id,),
                ).fetchone()[0]
            )
            if stored_bytes + len(result_blob.encode("utf-8")) > _MAX_COLLECTOR_RESULT_BYTES:
                raise ValueError("collector aggregate results exceed 4194304 bytes")
            conn.execute(
                "INSERT INTO collaboration_collector_results"
                "(run_id,child_id,attempt,ordinal,status,result_json,result_sha256,completed_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    run_id,
                    child_id,
                    generation,
                    expected.index(child_id),
                    child_status,
                    result_blob,
                    digest,
                    timestamp,
                ),
            )
            latest_results = self._collector_results(conn, run_id)
            effective_results = _effective_results(
                latest_results,
                retrying=retrying,
                generation=generation,
            )
            success_count = sum(1 for item in effective_results if item["status"] == "success")
            completed_count = len(effective_results)
            remaining_count = len(expected) - completed_count
            policy = str(collector[1])
            target = int(collector[2])
            policy_satisfied = False
            impossible = False
            if policy == "all":
                policy_satisfied = remaining_count == 0
            elif policy == "first_completed":
                policy_satisfied = completed_count >= 1
            elif policy == "first_success":
                policy_satisfied = success_count >= 1
                impossible = remaining_count == 0 and not policy_satisfied
            else:
                policy_satisfied = success_count >= target
                impossible = success_count + remaining_count < target
            next_status = (
                "completed" if policy_satisfied else "failed" if impossible else "collecting"
            )
            completed_ids = {str(item["child_id"]) for item in effective_results}
            cancel_ids = (
                [registered for registered in expected if registered not in completed_ids]
                if next_status in _TERMINAL
                else []
            )
            conn.execute(
                "UPDATE collaboration_collectors SET status=?,policy_satisfied=?,"
                "cancelled_json=?,retry_json=?,revision=revision+1,settled_at=?,updated_at=? "
                "WHERE run_id=?",
                (
                    next_status,
                    int(policy_satisfied),
                    _dump(cancel_ids),
                    "[]" if next_status in _TERMINAL else _dump(retrying),
                    timestamp if next_status in _TERMINAL else None,
                    timestamp,
                    run_id,
                ),
            )
            run_status_row = conn.execute(
                "SELECT status FROM collaboration_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            self._append_run_event(
                conn,
                run_id=run_id,
                event_type="collector_child_recorded",
                status=str(run_status_row[0]) if run_status_row else "running",
                payload={
                    "child_id": child_id,
                    "attempt": generation,
                    "child_status": child_status,
                    "result_sha256": digest,
                    "completed_count": completed_count,
                    "success_count": success_count,
                    "collector_status": next_status,
                    "policy_satisfied": policy_satisfied,
                    "cancellation_requested_count": len(cancel_ids),
                },
                created_at=timestamp,
            )
            snapshot = self._collector_snapshot(conn, run_id)
        assert snapshot is not None
        return snapshot


__all__ = [
    "COLLABORATION_COLLECTOR_SCHEMA",
    "CollaborationCollectorStoreMixin",
    "ensure_collaboration_collector_schema",
]
