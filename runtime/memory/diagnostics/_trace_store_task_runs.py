"""Task-run aggregation and summary-stats read methods for the trace store."""

from __future__ import annotations

import sqlite3
from typing import Any

from runtime.safety.auth.scope import TenantScope

from ._trace_store_models import (
    TaskRunStatus,
    _clean_str,
    _task_run_from_rows,
)
from ._trace_store_sql import _decode_row


class _TraceStoreTaskRunMixin:
    def task_run(
        self: Any, task_id: str, *, scope: TenantScope | None = None
    ) -> dict[str, Any] | None:
        task_id = _clean_str(task_id)
        if not task_id:
            return None
        events = self.events(task_id=task_id, limit=10000, scope=scope)
        checkpoints = self.checkpoints(task_id=task_id, limit=10000, scope=scope)
        token_rows = self.token_usage(task_id=task_id, limit=10000, scope=scope)
        if not events and not checkpoints and not token_rows:
            return None
        approvals = self._approvals_for_task(task_id, scope=scope)
        return _task_run_from_rows(
            task_id=task_id,
            events=events,
            checkpoints=checkpoints,
            token_rows=token_rows,
            approvals=approvals,
            include_events=True,
        )

    def task_runs(
        self: Any,
        *,
        thread_id: str | None = None,
        turn_id: str | None = None,
        agent_id: str | None = None,
        status: TaskRunStatus | None = None,
        limit: int = 100,
        offset: int = 0,
        scope: TenantScope | None = None,
    ) -> list[dict[str, Any]]:
        rows = self._task_run_ids(
            thread_id=thread_id,
            turn_id=turn_id,
            agent_id=agent_id,
            limit=limit if status is None else None,
            offset=offset if status is None else 0,
            scope=scope,
        )
        runs: list[dict[str, Any]] = []
        for row in rows:
            # Keep the unscoped call shape compatible with integrations that
            # instrument ``task_run``; authenticated callers still receive
            # the explicit scope below.
            run = (
                self.task_run(str(row["task_id"]))
                if scope is None
                else self.task_run(str(row["task_id"]), scope=scope)
            )
            if run is None:
                continue
            if status is not None and run.get("status") != status:
                continue
            run.pop("events", None)
            runs.append(run)
        if status is None:
            return runs
        start = max(0, int(offset or 0))
        end = start + max(0, int(limit or 0))
        return runs[start:end]

    def stats(
        self: Any,
        *,
        thread_id: str | None = None,
        task_id: str | None = None,
        agent_id: str | None = None,
        turn_id: str | None = None,
        scope: TenantScope | None = None,
    ) -> dict[str, Any]:
        scope_filters = self._scope_filters(scope)
        with self._lock:
            counts = {
                "messages": self._count_locked(
                    "messages",
                    {
                        "thread_id": thread_id,
                        "turn_id": turn_id,
                        "agent_id": agent_id,
                    }
                    | scope_filters,
                ),
                "events": self._count_locked(
                    "agui_events",
                    {
                        "thread_id": thread_id,
                        "turn_id": turn_id,
                        "task_id": task_id,
                        "agent_id": agent_id,
                    }
                    | scope_filters,
                ),
                "approvals": self._count_locked(
                    "approvals",
                    {
                        "thread_id": thread_id,
                        "turn_id": turn_id,
                        "task_id": task_id,
                        "agent_id": agent_id,
                    }
                    | scope_filters,
                ),
                "checkpoints": self._count_locked(
                    "agent_checkpoints",
                    {
                        "thread_id": thread_id,
                        "turn_id": turn_id,
                        "task_id": task_id,
                        "agent_id": agent_id,
                    }
                    | scope_filters,
                ),
                "token_usage": self._count_locked(
                    "llm_token_usage",
                    {
                        "thread_id": thread_id,
                        "turn_id": turn_id,
                        "task_id": task_id,
                        "agent_id": agent_id,
                    }
                    | scope_filters,
                ),
                "resume_requests": self._count_locked(
                    "resume_requests",
                    {
                        "thread_id": thread_id,
                    }
                    | scope_filters,
                ),
            }
            token_where, token_params = self._where_params(
                {
                    "thread_id": thread_id,
                    "turn_id": turn_id,
                    "task_id": task_id,
                    "agent_id": agent_id,
                }
                | scope_filters
            )
            token_row = self._conn.execute(
                "SELECT "  # nosec B608 — WHERE built from ? placeholders; values parameterized
                "COALESCE(SUM(input_tokens), 0) AS input_tokens, "
                "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
                "COALESCE(SUM(thinking_tokens), 0) AS thinking_tokens, "
                "COALESCE(SUM(cached_tokens), 0) AS cached_tokens, "
                "COALESCE(SUM(cost_usd), 0) AS cost_usd "
                f"FROM llm_token_usage{token_where}",
                token_params,
            ).fetchone()
        return {
            **counts,
            "token_totals": {
                "input_tokens": int(token_row["input_tokens"]) if token_row else 0,
                "output_tokens": int(token_row["output_tokens"]) if token_row else 0,
                "thinking_tokens": int(token_row["thinking_tokens"]) if token_row else 0,
                "cached_tokens": int(token_row["cached_tokens"]) if token_row else 0,
                "cost_usd": float(token_row["cost_usd"]) if token_row else 0.0,
            },
        }

    def _task_run_ids(
        self: Any,
        *,
        thread_id: str | None = None,
        turn_id: str | None = None,
        agent_id: str | None = None,
        limit: int | None = None,
        offset: int = 0,
        scope: TenantScope | None = None,
    ) -> list[sqlite3.Row]:
        parts: list[str] = []
        params: list[Any] = []
        for table in ("agui_events", "agent_checkpoints", "llm_token_usage"):
            clauses = ["task_id IS NOT NULL", "task_id != ''"]
            for key, value in (
                ("thread_id", thread_id),
                ("turn_id", turn_id),
                ("agent_id", agent_id),
                *self._scope_filters(scope).items(),
            ):
                if value is not None:
                    clauses.append(f"{key} = ?")
                    params.append(value)
            parts.append(
                f"SELECT task_id, MAX(ts) AS updated_at FROM {table} "  # nosec B608 — table is internal literal; WHERE uses ? placeholders
                f"WHERE {' AND '.join(clauses)} GROUP BY task_id"
            )
        sql = (
            "SELECT task_id, MAX(updated_at) AS updated_at FROM ("  # nosec B608 — parts built from ? placeholders; values parameterized
            + " UNION ALL ".join(parts)
            + ") GROUP BY task_id ORDER BY updated_at DESC, task_id ASC"
        )
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params.extend([max(0, int(limit or 0)), max(0, int(offset or 0))])
        with self._lock:
            return list(self._conn.execute(sql, params).fetchall())

    def _approvals_for_task(
        self: Any, task_id: str, *, scope: TenantScope | None = None
    ) -> list[dict[str, Any]]:
        rows = self._query(
            "approvals",
            filters={"task_id": task_id} | self._scope_filters(scope),
            limit=10000,
            offset=0,
        )
        return [_decode_row(row, json_fields=("metadata",)) for row in rows]


__all__ = ["_TraceStoreTaskRunMixin"]
