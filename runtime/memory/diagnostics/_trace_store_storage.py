"""SQLite storage mixin for the agent trace store."""

from __future__ import annotations

import contextlib
import sqlite3
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .trace_store import AgentTraceStore

from runtime.safety.auth.scope import TenantScope

from ._trace_store_models import (
    ApprovalDecision,
    TaskRunStatus,
    _clean_str,
    _json_dumps,
    _now_iso,
)
from ._trace_store_recovery import (
    _resume_proposal_from_checkpoint,
    _sanitize_resume_intent,
)
from ._trace_store_replay_storage import _TraceStoreReplayMixin
from ._trace_store_schema import _SCHEMA
from ._trace_store_sql import _decode_row, _TraceStoreSqlMixin
from ._trace_store_task_runs import _TraceStoreTaskRunMixin
from .execution_trace import build_execution_trace

TRACE_SCHEMA_VERSION = 2


def _optional_str(value: Any) -> str | None:
    text = _clean_str(value)
    return text or None


class _TraceStoreStorageMixin(_TraceStoreSqlMixin, _TraceStoreTaskRunMixin, _TraceStoreReplayMixin):
    """SQLite-backed read model for agent trace facts."""

    def __init__(self, db_path: str | Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._conn = sqlite3.connect(
            str(self._db_path),
            check_same_thread=False,
            isolation_level=None,
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._conn.execute("PRAGMA foreign_keys=ON;")
        # Scope indexes are deliberately created only *after* the additive
        # migration below. Older production databases have these tables but
        # not tenant_id/owner_actor_id; putting the indexes in ``_SCHEMA``
        # makes SQLite abort executescript before ALTER TABLE can run.
        self._conn.executescript(_SCHEMA)
        self._ensure_scope_columns()
        self._conn.execute(f"PRAGMA user_version={TRACE_SCHEMA_VERSION}")

    def schema_status(self) -> dict[str, Any]:
        """Return an explicit readiness receipt for lifecycle persistence."""

        required = {"tenant_id", "owner_actor_id"}
        tables = (
            "messages",
            "agui_events",
            "approvals",
            "agent_checkpoints",
            "llm_token_usage",
            "resume_requests",
        )
        missing: dict[str, list[str]] = {}
        with self._lock:
            version = int(self._conn.execute("PRAGMA user_version").fetchone()[0])
            for table in tables:
                columns = {
                    str(row[1])
                    for row in self._conn.execute(f"PRAGMA table_info({table})").fetchall()
                }
                absent = sorted(required - columns)
                if absent:
                    missing[table] = absent
        return {
            "ready": version >= TRACE_SCHEMA_VERSION and not missing,
            "version": version,
            "requiredVersion": TRACE_SCHEMA_VERSION,
            "missingColumns": missing,
        }

    def _ensure_scope_columns(self) -> None:
        """Migrate pre-Phase-1 trace databases without rewriting history."""
        tables = (
            "messages",
            "agui_events",
            "approvals",
            "agent_checkpoints",
            "llm_token_usage",
            "resume_requests",
        )
        with self._lock:
            for table in tables:
                columns = {
                    str(row[1])
                    for row in self._conn.execute(f"PRAGMA table_info({table})").fetchall()
                }
                if "tenant_id" not in columns:
                    self._conn.execute(f"ALTER TABLE {table} ADD COLUMN tenant_id TEXT")
                if "owner_actor_id" not in columns:
                    self._conn.execute(f"ALTER TABLE {table} ADD COLUMN owner_actor_id TEXT")
                self._conn.execute(
                    f"CREATE INDEX IF NOT EXISTS idx_{table}_scope "
                    f"ON {table}(tenant_id, owner_actor_id, id)"
                )

    @staticmethod
    def _scope_values(
        scope: TenantScope | None,
        tenant_id: str | None,
        owner_actor_id: str | None,
    ) -> tuple[str | None, str | None]:
        if scope is not None:
            return scope.tenant_id, scope.actor_id
        return _optional_str(tenant_id), _optional_str(owner_actor_id)

    @staticmethod
    def _scope_filters(scope: TenantScope | None) -> dict[str, str | None]:
        if scope is None or scope.allow_cross_tenant:
            return {}
        return {"tenant_id": scope.tenant_id, "owner_actor_id": scope.actor_id}

    def record_message(
        self,
        *,
        thread_id: str,
        role: str,
        content: str,
        turn_id: str | None = None,
        agent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        ts: str | None = None,
        tenant_id: str | None = None,
        owner_actor_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> int:
        tenant_id, owner_actor_id = self._scope_values(scope, tenant_id, owner_actor_id)
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO messages(ts, tenant_id, owner_actor_id, thread_id, turn_id, agent_id, role, content, metadata) "
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ts or _now_iso(),
                    tenant_id,
                    owner_actor_id,
                    _clean_str(thread_id),
                    _optional_str(turn_id),
                    _optional_str(agent_id),
                    _clean_str(role),
                    str(content or ""),
                    _json_dumps(metadata),
                ),
            )
            return int(cur.lastrowid)

    def record_event(
        self,
        *,
        event_type: str,
        payload: dict[str, Any] | None,
        thread_id: str | None = None,
        turn_id: str | None = None,
        task_id: str | None = None,
        agent_id: str | None = None,
        item_id: str | None = None,
        ts: str | None = None,
        tenant_id: str | None = None,
        owner_actor_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> int:
        tenant_id, owner_actor_id = self._scope_values(scope, tenant_id, owner_actor_id)
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO agui_events("
                "ts, tenant_id, owner_actor_id, thread_id, turn_id, task_id, agent_id, item_id, event_type, payload"
                ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ts or _now_iso(),
                    tenant_id,
                    owner_actor_id,
                    _optional_str(thread_id),
                    _optional_str(turn_id),
                    _optional_str(task_id),
                    _optional_str(agent_id),
                    _optional_str(item_id),
                    _clean_str(event_type),
                    _json_dumps(payload),
                ),
            )
            return int(cur.lastrowid)

    def record_task_run_started(
        self,
        *,
        task_id: str,
        thread_id: str | None = None,
        turn_id: str | None = None,
        agent_id: str | None = None,
        title: str = "",
        goal: str = "",
        mode: str = "",
        metadata: dict[str, Any] | None = None,
        ts: str | None = None,
        tenant_id: str | None = None,
        owner_actor_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> int:
        payload = {
            "schema": "echo.task_run.started.v1",
            "title": str(title or ""),
            "goal": str(goal or ""),
            "mode": str(mode or ""),
            "metadata": metadata or {},
        }
        return self.record_event(
            event_type="TASK_RUN_STARTED",
            payload=payload,
            thread_id=thread_id,
            turn_id=turn_id,
            task_id=task_id,
            agent_id=agent_id,
            ts=ts,
            tenant_id=tenant_id,
            owner_actor_id=owner_actor_id,
            scope=scope,
        )

    def record_task_run_finished(
        self,
        *,
        task_id: str,
        status: TaskRunStatus,
        thread_id: str | None = None,
        turn_id: str | None = None,
        agent_id: str | None = None,
        summary: str = "",
        reason: str = "",
        metadata: dict[str, Any] | None = None,
        ts: str | None = None,
        tenant_id: str | None = None,
        owner_actor_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> int:
        event_type = {
            "completed": "TASK_RUN_COMPLETED",
            "failed": "TASK_RUN_FAILED",
            "paused": "TASK_RUN_PAUSED",
            "interrupted": "TASK_RUN_INTERRUPTED",
            "cancelled": "TASK_RUN_CANCELLED",
        }.get(status, "TASK_RUN_FINISHED")
        payload = {
            "schema": "echo.task_run.finished.v1",
            "status": status,
            "summary": str(summary or ""),
            "reason": str(reason or ""),
            "metadata": metadata or {},
        }
        return self.record_event(
            event_type=event_type,
            payload=payload,
            thread_id=thread_id,
            turn_id=turn_id,
            task_id=task_id,
            agent_id=agent_id,
            ts=ts,
            tenant_id=tenant_id,
            owner_actor_id=owner_actor_id,
            scope=scope,
        )

    def record_approval(
        self,
        *,
        tool_name: str,
        tool_call_id: str,
        decision: ApprovalDecision,
        reason: str = "",
        args_preview: str = "",
        thread_id: str | None = None,
        turn_id: str | None = None,
        task_id: str | None = None,
        agent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        requested_at: str | None = None,
        decided_at: str | None = None,
        tenant_id: str | None = None,
        owner_actor_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> int:
        tenant_id, owner_actor_id = self._scope_values(scope, tenant_id, owner_actor_id)
        requested = requested_at or _now_iso()
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO approvals("
                "requested_at, decided_at, tenant_id, owner_actor_id, thread_id, turn_id, task_id, agent_id, "
                "tool_name, tool_call_id, args_preview, decision, reason, metadata"
                ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    requested,
                    decided_at or requested,
                    tenant_id,
                    owner_actor_id,
                    _optional_str(thread_id),
                    _optional_str(turn_id),
                    _optional_str(task_id),
                    _optional_str(agent_id),
                    _clean_str(tool_name),
                    _clean_str(tool_call_id),
                    str(args_preview or ""),
                    _clean_str(decision),
                    str(reason or ""),
                    _json_dumps(metadata),
                ),
            )
            return int(cur.lastrowid)

    def record_checkpoint(
        self,
        *,
        task_id: str,
        checkpoint_type: str,
        state: dict[str, Any],
        thread_id: str | None = None,
        turn_id: str | None = None,
        agent_id: str | None = None,
        iteration: int = 0,
        summary: str = "",
        ts: str | None = None,
        tenant_id: str | None = None,
        owner_actor_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> int:
        tenant_id, owner_actor_id = self._scope_values(scope, tenant_id, owner_actor_id)
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO agent_checkpoints("
                "ts, tenant_id, owner_actor_id, task_id, thread_id, turn_id, agent_id, checkpoint_type, iteration, summary, state"
                ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ts or _now_iso(),
                    tenant_id,
                    owner_actor_id,
                    _clean_str(task_id),
                    _optional_str(thread_id),
                    _optional_str(turn_id),
                    _optional_str(agent_id),
                    _clean_str(checkpoint_type),
                    int(iteration or 0),
                    str(summary or ""),
                    _json_dumps(state),
                ),
            )
            return int(cur.lastrowid)

    def record_token_usage(
        self,
        *,
        input_tokens: int,
        output_tokens: int,
        task_id: str | None = None,
        thread_id: str | None = None,
        turn_id: str | None = None,
        agent_id: str | None = None,
        iteration: int = 0,
        model: str = "",
        thinking_tokens: int = 0,
        cached_tokens: int = 0,
        cost_usd: float = 0.0,
        is_local: bool = False,
        metadata: dict[str, Any] | None = None,
        ts: str | None = None,
        tenant_id: str | None = None,
        owner_actor_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> int:
        tenant_id, owner_actor_id = self._scope_values(scope, tenant_id, owner_actor_id)
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO llm_token_usage("
                "ts, tenant_id, owner_actor_id, task_id, thread_id, turn_id, agent_id, iteration, model, "
                "input_tokens, output_tokens, thinking_tokens, cached_tokens, cost_usd, "
                "is_local, metadata"
                ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ts or _now_iso(),
                    tenant_id,
                    owner_actor_id,
                    _optional_str(task_id),
                    _optional_str(thread_id),
                    _optional_str(turn_id),
                    _optional_str(agent_id),
                    int(iteration or 0),
                    str(model or ""),
                    max(0, int(input_tokens or 0)),
                    max(0, int(output_tokens or 0)),
                    max(0, int(thinking_tokens or 0)),
                    max(0, int(cached_tokens or 0)),
                    float(cost_usd or 0.0),
                    1 if is_local else 0,
                    _json_dumps(metadata),
                ),
            )
            return int(cur.lastrowid)

    def record_resume_request(
        self,
        *,
        thread_id: str,
        checkpoint_id: int,
        task_id: str | None = None,
        status: str = "pending",
        intent: dict[str, Any] | None = None,
        confirmed_at: str | None = None,
        consumed_at: str | None = None,
        ts: str | None = None,
        tenant_id: str | None = None,
        owner_actor_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> int:
        tenant_id, owner_actor_id = self._scope_values(scope, tenant_id, owner_actor_id)
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO resume_requests("
                "ts, tenant_id, owner_actor_id, thread_id, checkpoint_id, task_id, status, intent, confirmed_at, consumed_at"
                ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ts or _now_iso(),
                    tenant_id,
                    owner_actor_id,
                    _clean_str(thread_id),
                    int(checkpoint_id or 0),
                    _optional_str(task_id),
                    _clean_str(status) or "pending",
                    _json_dumps(_sanitize_resume_intent(intent)),
                    _optional_str(confirmed_at),
                    _optional_str(consumed_at),
                ),
            )
            return int(cur.lastrowid)

    def messages(
        self,
        *,
        thread_id: str | None = None,
        turn_id: str | None = None,
        agent_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
        scope: TenantScope | None = None,
    ) -> list[dict[str, Any]]:
        filters = {
            "thread_id": thread_id,
            "turn_id": turn_id,
            "agent_id": agent_id,
        }
        filters.update(self._scope_filters(scope))
        rows = self._query(
            "messages",
            filters=filters,
            limit=limit,
            offset=offset,
        )
        return [_decode_row(row, json_fields=("metadata",)) for row in rows]

    def events(
        self,
        *,
        thread_id: str | None = None,
        turn_id: str | None = None,
        task_id: str | None = None,
        agent_id: str | None = None,
        event_type: str | None = None,
        limit: int = 100,
        offset: int = 0,
        scope: TenantScope | None = None,
    ) -> list[dict[str, Any]]:
        filters = {
            "thread_id": thread_id,
            "turn_id": turn_id,
            "task_id": task_id,
            "agent_id": agent_id,
            "event_type": event_type,
        }
        filters.update(self._scope_filters(scope))
        rows = self._query(
            "agui_events",
            filters=filters,
            limit=limit,
            offset=offset,
        )
        return [_decode_row(row, json_fields=("payload",)) for row in rows]

    def execution_trace(
        self,
        *,
        turn_id: str,
        thread_id: str | None = None,
        task_id: str | None = None,
        agent_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> dict[str, Any]:
        """Return one provider-neutral execution trace for a turn.

        This is a read model over the append-only ``agui_events`` table. It
        deliberately does not replay provider protocol objects or query UI
        state, so Codex and Native consumers see identical lifecycle facts.
        """

        events = self.events(
            turn_id=turn_id,
            thread_id=thread_id,
            task_id=task_id,
            agent_id=agent_id,
            limit=10000,
            scope=scope,
        )
        return build_execution_trace(
            events,
            thread_id=thread_id,
            turn_id=turn_id,
            task_id=task_id,
            agent_id=agent_id,
        )

    def approvals(
        self,
        *,
        thread_id: str | None = None,
        turn_id: str | None = None,
        task_id: str | None = None,
        agent_id: str | None = None,
        tool_call_id: str | None = None,
        decision: str | None = None,
        limit: int = 100,
        offset: int = 0,
        scope: TenantScope | None = None,
    ) -> list[dict[str, Any]]:
        filters = {
            "thread_id": thread_id,
            "turn_id": turn_id,
            "task_id": task_id,
            "agent_id": agent_id,
            "tool_call_id": tool_call_id,
            "decision": decision,
        }
        filters.update(self._scope_filters(scope))
        rows = self._query(
            "approvals",
            filters=filters,
            limit=limit,
            offset=offset,
        )
        return [_decode_row(row, json_fields=("metadata",)) for row in rows]

    def token_usage(
        self,
        *,
        task_id: str | None = None,
        thread_id: str | None = None,
        agent_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
        scope: TenantScope | None = None,
    ) -> list[dict[str, Any]]:
        filters = {
            "task_id": task_id,
            "thread_id": thread_id,
            "agent_id": agent_id,
        }
        filters.update(self._scope_filters(scope))
        rows = self._query(
            "llm_token_usage",
            filters=filters,
            limit=limit,
            offset=offset,
        )
        return [
            _decode_row(row, json_fields=("metadata",), bool_fields=("is_local",)) for row in rows
        ]

    def resume_requests(
        self,
        *,
        thread_id: str | None = None,
        checkpoint_id: int | None = None,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0,
        scope: TenantScope | None = None,
    ) -> list[dict[str, Any]]:
        filters: dict[str, str | None] = {}
        if thread_id is not None:
            filters["thread_id"] = thread_id
        if status is not None:
            filters["status"] = status
        filters.update(self._scope_filters(scope))
        rows = self._query(
            "resume_requests",
            filters=filters,
            limit=limit,
            offset=offset,
        )
        items = [_decode_row(row, json_fields=("intent",)) for row in rows]
        if checkpoint_id is not None:
            items = [
                row for row in items if int(row.get("checkpoint_id") or 0) == int(checkpoint_id)
            ]
        return items

    def latest_pending_resume_request(
        self,
        *,
        thread_id: str,
        scope: TenantScope | None = None,
    ) -> dict[str, Any] | None:
        rows = self.resume_requests(thread_id=thread_id, status="pending", limit=1, scope=scope)
        return rows[0] if rows else None

    def confirm_resume_request(
        self,
        *,
        thread_id: str,
        checkpoint_id: int,
        confirmation_text: str = "",
        scope: TenantScope | None = None,
    ) -> dict[str, Any] | None:
        request = self.latest_pending_resume_request(thread_id=thread_id, scope=scope)
        if request is None or int(request.get("checkpoint_id") or 0) != int(checkpoint_id or 0):
            return None
        intent = _sanitize_resume_intent(request.get("intent"))
        intent["requires_confirmation"] = False
        intent["confirmed"] = True
        if confirmation_text:
            intent["confirmation_text"] = confirmation_text
        confirmed_at = _now_iso()
        with self._lock:
            # Atomic compare-and-set: only the caller that flips a STILL-pending
            # request wins. The latest_pending lookup above can be stale across
            # connections, so the ``status = 'pending'`` guard (not just id) is
            # what stops two racing confirms from both succeeding (TOCTOU).
            cur = self._conn.execute(
                "UPDATE resume_requests SET status = ?, confirmed_at = ?, intent = ? "
                "WHERE id = ? AND status = ?",
                (
                    "confirmed",
                    confirmed_at,
                    _json_dumps(intent),
                    int(request["id"]),
                    "pending",
                ),
            )
            if cur.rowcount == 0:
                return None  # lost the race — already confirmed/consumed elsewhere
        confirmed_rows = self.resume_requests(
            thread_id=thread_id,
            checkpoint_id=checkpoint_id,
            status="confirmed",
            limit=1,
            scope=scope,
        )
        return confirmed_rows[0] if confirmed_rows else None

    def consume_resume_request(
        self, request_id: int, *, scope: TenantScope | None = None
    ) -> dict[str, Any] | None:
        scope_filters = self._scope_filters(scope)
        with self._lock:
            # Atomic single-consumer transition: the ``status != 'consumed'``
            # guard means only ONE connection's UPDATE matches the row, so a
            # racing second consume gets rowcount 0 and returns None instead of
            # re-running the resume (TOCTOU double-consume).
            updated = self._consume_resume_request_locked(request_id, _now_iso(), scope_filters)
        return _decode_row(updated, json_fields=("intent",)) if updated is not None else None

    def checkpoints(
        self,
        *,
        task_id: str | None = None,
        thread_id: str | None = None,
        turn_id: str | None = None,
        agent_id: str | None = None,
        checkpoint_type: str | None = None,
        limit: int = 100,
        offset: int = 0,
        scope: TenantScope | None = None,
    ) -> list[dict[str, Any]]:
        filters = {
            "task_id": task_id,
            "thread_id": thread_id,
            "turn_id": turn_id,
            "agent_id": agent_id,
            "checkpoint_type": checkpoint_type,
        }
        filters.update(self._scope_filters(scope))
        rows = self._query(
            "agent_checkpoints",
            filters=filters,
            limit=limit,
            offset=offset,
        )
        return [_decode_row(row, json_fields=("state",)) for row in rows]

    def latest_checkpoint(
        self,
        *,
        task_id: str,
        checkpoint_type: str | None = None,
        scope: TenantScope | None = None,
    ) -> dict[str, Any] | None:
        clauses = ["task_id = ?"]
        params: list[Any] = [task_id]
        if checkpoint_type is not None:
            clauses.append("checkpoint_type = ?")
            params.append(checkpoint_type)
        scope_filters = self._scope_filters(scope)
        for key, value in scope_filters.items():
            clauses.append(f"{key} = ?")
            params.append(value)
        sql = (
            "SELECT * FROM agent_checkpoints WHERE "  # nosec B608 — WHERE built from ? placeholders; values parameterized
            + " AND ".join(clauses)
            + " ORDER BY iteration DESC, id DESC LIMIT 1"
        )
        with self._lock:
            row = self._conn.execute(sql, params).fetchone()
        return _decode_row(row, json_fields=("state",)) if row is not None else None

    def checkpoint_by_id(
        self, checkpoint_id: int, *, scope: TenantScope | None = None
    ) -> dict[str, Any] | None:
        scope_filters = self._scope_filters(scope)
        with self._lock:
            row = self._scoped_row_by_id_locked("agent_checkpoints", checkpoint_id, scope_filters)
        return _decode_row(row, json_fields=("state",)) if row is not None else None

    def resume_proposal(
        self, checkpoint_id: int, *, scope: TenantScope | None = None
    ) -> dict[str, Any] | None:
        checkpoint = self.checkpoint_by_id(checkpoint_id, scope=scope)
        if checkpoint is None:
            return None
        return _resume_proposal_from_checkpoint(checkpoint)

    def resume_proposals(
        self,
        *,
        task_id: str | None = None,
        thread_id: str | None = None,
        turn_id: str | None = None,
        agent_id: str | None = None,
        checkpoint_type: str | None = None,
        limit: int = 5,
        offset: int = 0,
        scope: TenantScope | None = None,
    ) -> list[dict[str, Any]]:
        checkpoints = self.checkpoints(
            task_id=task_id,
            thread_id=thread_id,
            turn_id=turn_id,
            agent_id=agent_id,
            checkpoint_type=checkpoint_type,
            limit=limit,
            offset=offset,
            scope=scope,
        )
        return [_resume_proposal_from_checkpoint(checkpoint) for checkpoint in checkpoints]

    def close(self) -> None:
        with self._lock, contextlib.suppress(sqlite3.Error):
            self._conn.close()

    def __enter__(self) -> AgentTraceStore:
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()
