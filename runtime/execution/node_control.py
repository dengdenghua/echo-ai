"""Execution nodes use the existing collaboration ledger as their control plane.

Only the controller owns SQLite. Nodes communicate by HTTP; never put this DB
on SMB/NFS. Remote attempts work in private snapshots and publish fenced results.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from runtime.memory.cowork.collaboration_runs import (
    _RUN_COLUMNS,
    _run_from_row,
)
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.ids import require_cowork_id
from runtime.platform.io.sqlite_schema import Migration, migrate

_SCHEMA = """
CREATE TABLE IF NOT EXISTS execution_nodes (
 node_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 label TEXT NOT NULL, workspaces TEXT NOT NULL, roles TEXT NOT NULL,
 updated_at REAL NOT NULL
);
"""

_MIGRATIONS = (Migration(1, _SCHEMA),)


class ExecutionNodeControl:
    def __init__(self, store: CollaborationStore):
        self.store = store
        with store._connect() as conn:
            migrate(conn, _MIGRATIONS, name="node_control", shared=True)

    def advertise(
        self,
        *,
        node_id: str,
        tenant_id: str,
        actor_id: str,
        label: str,
        workspaces: list[str],
        roles: list[str],
    ) -> None:
        node_id = require_cowork_id(node_id, label="node_id")
        if ":" in node_id:
            raise ValueError("node_id must not contain the worker identity separator")
        for value in [*workspaces, *roles]:
            require_cowork_id(value, label="node capability")
        if not roles or len(roles) > 256 or len(workspaces) > 256:
            raise ValueError("node requires 1..256 roles and at most 256 workspaces")
        with self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT tenant_id,actor_id FROM execution_nodes WHERE node_id=?", (node_id,)
            ).fetchone()
            if row and tuple(row) != (tenant_id, actor_id):
                raise PermissionError("execution node belongs to another principal")
            conn.execute(
                "INSERT INTO execution_nodes VALUES (?,?,?,?,?,?,?) ON CONFLICT(node_id) "
                "DO UPDATE SET label=excluded.label,workspaces=excluded.workspaces,roles=excluded.roles,updated_at=excluded.updated_at",
                (
                    node_id,
                    tenant_id,
                    actor_id,
                    label[:120],
                    json.dumps(sorted(set(workspaces))),
                    json.dumps(sorted(set(roles))),
                    time.time(),
                ),
            )

    def nodes(self, tenant_id: str) -> list[dict[str, Any]]:
        with self.store._connect() as conn:
            rows = conn.execute(
                "SELECT node_id,label,workspaces,roles,updated_at FROM execution_nodes WHERE tenant_id=?",
                (tenant_id,),
            ).fetchall()
        return [
            {
                "node_id": r[0],
                "label": r[1],
                "workspace_ids": json.loads(r[2]),
                "roles": json.loads(r[3]),
                "online": time.time() - r[4] < 45,
            }
            for r in rows
        ]

    def verify_node(self, node_id: str, tenant_id: str, actor_id: str) -> dict[str, Any]:
        with self.store._connect() as conn:
            row = conn.execute(
                "SELECT actor_id FROM execution_nodes WHERE node_id=? AND tenant_id=?",
                (node_id, tenant_id),
            ).fetchone()
        if not row or row[0] != actor_id:
            raise PermissionError("execution node is not owned by this principal")
        return next(n for n in self.nodes(tenant_id) if n["node_id"] == node_id)

    def submit(
        self,
        *,
        tenant_id: str,
        actor_id: str,
        request_id: str,
        workspace_id: str,
        node_ids: list[str],
        goal: str,
        role: str,
        output_files: list[str],
        timeout_s: int = 900,
        snapshot_source: Path | None = None,
    ) -> dict[str, Any]:
        if not node_ids or len(node_ids) > 16 or not goal.strip() or len(goal) > 32000:
            raise ValueError("require a goal and 1..16 execution nodes")
        from runtime.execution.node_artifacts import relative_path

        if len(output_files) > 32:
            raise ValueError("at most 32 output files")
        output_files = [relative_path(name) for name in output_files]
        if len(set(output_files)) != len(output_files):
            raise ValueError("duplicate output paths")
        available = {n["node_id"]: n for n in self.nodes(tenant_id)}
        for node_id in node_ids:
            node = available.get(node_id)
            if not node or workspace_id not in node["workspace_ids"] or role not in node["roles"]:
                raise ValueError("node does not provide this workspace and installed role")
        key = json.dumps([tenant_id, actor_id, request_id], ensure_ascii=False)
        run_id = "exec-" + hashlib.sha256(key.encode()).hexdigest()[:32]
        payload = dict(
            tenant_id=tenant_id,
            actor_id=actor_id,
            workspace_id=workspace_id,
            node_ids=sorted(set(node_ids)),
            goal=goal,
            role=role,
            output_files=output_files,
            timeout_s=max(5, min(timeout_s, 3600)),
        )
        from runtime.execution.node_inputs import capture_input
        from runtime.platform.io.file_coordination import coordinate_file_mutations

        archive = self.input_archive(run_id)
        with coordinate_file_mutations([archive]):
            existing = self.store.collaboration_run(run_id)
            if existing:
                original = {
                    key: value
                    for key, value in existing["input"].items()
                    if key != "input_snapshot"
                }
                if original != payload:
                    raise ValueError("request_id was already used for a different task")
                return existing
            if snapshot_source is None:
                raise ValueError(
                    "mount the project on the controller before submitting a versioned task"
                )
            payload["input_snapshot"] = capture_input(snapshot_source, archive)
            return self.store.create_collaboration_run(
                run_id=run_id, session_id=run_id, kind="execution_node", input=payload
            )

    def input_archive(self, run_id: str) -> Path:
        return (
            self.store.base_dir
            / "execution-inputs"
            / require_cowork_id(run_id, label="run_id")
            / "input.zip"
        )

    def runs(
        self, *, tenant_id: str, actor_id: str | None = None, kind: str = "execution_node"
    ) -> list[dict[str, Any]]:
        self.reconcile()
        with self.store._connect() as conn:
            rows = conn.execute(
                f"SELECT {_RUN_COLUMNS} FROM collaboration_runs WHERE kind=? "
                "AND json_extract(input_json,'$.tenant_id')=? "
                "AND (? IS NULL OR json_extract(input_json,'$.actor_id')=?) ORDER BY created_at DESC LIMIT 500",
                (kind, tenant_id, actor_id, actor_id),
            ).fetchall()
        return [_run_from_row(row) for row in rows]

    def pending(self, *, tenant_id: str, node: dict[str, Any]) -> list[dict[str, Any]]:
        # Filter before LIMIT: completed jobs or jobs for another node must not
        # starve the oldest eligible task out of the polling window.
        self.reconcile()
        with self.store._connect() as conn:
            rows = conn.execute(
                f"SELECT {_RUN_COLUMNS} FROM collaboration_runs WHERE kind='execution_node' "
                "AND status IN ('queued','interrupted','running') "
                "AND json_extract(input_json,'$.tenant_id')=? "
                "AND EXISTS(SELECT 1 FROM json_each(input_json,'$.node_ids') WHERE value=?) "
                "AND json_extract(input_json,'$.workspace_id') IN (SELECT value FROM json_each(?)) "
                "AND json_extract(input_json,'$.role') IN (SELECT value FROM json_each(?)) "
                "ORDER BY created_at LIMIT 500",
                (
                    tenant_id,
                    node["node_id"],
                    json.dumps(node["workspace_ids"]),
                    json.dumps(node["roles"]),
                ),
            ).fetchall()
        return [_run_from_row(row) for row in rows]

    def reconcile(self) -> None:
        from runtime.memory.cowork import collaboration_runs

        timestamp = collaboration_runs._iso(collaboration_runs._now())
        with self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                "SELECT run_id,kind,attempt FROM collaboration_runs "
                "WHERE kind IN ('execution_node','engine_invocation') AND "
                "((status='running' AND lease_expires_at<=?) OR "
                "(kind='execution_node' AND status IN ('queued','interrupted') AND attempt>=3))",
                (timestamp,),
            ).fetchall()
            for run_id, kind, attempt in rows:
                exhausted = kind == "execution_node" and attempt >= 3
                status = "failed" if exhausted else "interrupted"
                error = "execution retry limit reached" if exhausted else "worker lease expired"
                conn.execute(
                    "UPDATE collaboration_runs SET status=?,error=?,version=version+1,"
                    "lease_owner=NULL,lease_expires_at=NULL,updated_at=?,completed_at=? WHERE run_id=?",
                    (status, error, timestamp, timestamp if exhausted else None, run_id),
                )
                self.store._append_run_event(
                    conn,
                    run_id=run_id,
                    event_type="retry_exhausted" if exhausted else "lease_expired",
                    status=status,
                    payload={"attempt": attempt},
                    created_at=timestamp,
                )

    def claim(self, run_id: str, *, node: dict[str, Any], instance_id: str) -> dict[str, Any]:
        run = self.store.collaboration_run(run_id)
        if not run or run["kind"] != "execution_node":
            raise KeyError(run_id)
        spec = run["input"]
        if (
            node["node_id"] not in spec["node_ids"]
            or spec["workspace_id"] not in node["workspace_ids"]
            or spec["role"] not in node["roles"]
        ):
            raise PermissionError("node is not eligible for this task")
        if run["status"] == "waiting":
            raise RuntimeError("task is paused")
        if run["attempt"] >= 3 and run["status"] != "running":
            raise RuntimeError("execution retry limit reached")
        worker_id = require_cowork_id(f"{node['node_id']}:{instance_id}", label="worker_id")
        return self.store.claim_collaboration_run(
            run_id, worker_id=worker_id, lease_seconds=15, max_attempts=3, allow_waiting=False
        )
