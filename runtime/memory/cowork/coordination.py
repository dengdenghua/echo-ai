"""Durable task-to-task coordination shared by all group response modes.

This is a mailbox and dependency ledger, not another agent scheduler. Existing
AsyncWorkStore tasks remain the execution authority. Messages never grant
permissions or implicitly create new work.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS coordination_recruitment (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL,
 payload TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS coordination_tasks (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, member_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
 dependencies TEXT NOT NULL DEFAULT '[]', result TEXT NOT NULL DEFAULT '',
 created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS coordination_tasks_thread ON coordination_tasks(thread_id, created_at);
CREATE TABLE IF NOT EXISTS coordination_context (
 task_id TEXT PRIMARY KEY, root_id TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coordination_messages (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, source_id TEXT NOT NULL,
 target_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
 artifacts TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL,
 created_at REAL NOT NULL, acknowledged_at REAL
);
CREATE INDEX IF NOT EXISTS coordination_inbox ON coordination_messages(target_id, state, created_at);
CREATE TABLE IF NOT EXISTS coordination_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL,
 task_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS coordination_events_thread ON coordination_events(thread_id, seq);
CREATE TABLE IF NOT EXISTS coordination_resources (
 resource TEXT PRIMARY KEY, thread_id TEXT NOT NULL, task_id TEXT NOT NULL,
 token TEXT NOT NULL, generation INTEGER NOT NULL, expires_at REAL NOT NULL,
 held INTEGER NOT NULL DEFAULT 0
);
"""
TERMINAL = {"done", "failed", "cancelled"}
# Total work per root (including nested tasks), independent of running worker slots.
MAX_TASKS_PER_ROOT = 64


def text(value: str, label: str, limit: int = 4000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{label} must be non-empty and at most {limit} characters")
    if any(ord(c) < 32 and c not in "\n\r\t" for c in value):
        raise ValueError(f"invalid {label}")
    return value.strip()


def task_row(row: Any) -> dict[str, Any]:
    keys = (
        "id",
        "thread_id",
        "member_id",
        "actor_id",
        "title",
        "status",
        "dependencies",
        "result",
        "created_at",
        "updated_at",
    )
    result = dict(zip(keys, row, strict=True))
    result["dependencies"] = json.loads(result["dependencies"])
    return result


def message_row(row: Any) -> dict[str, Any]:
    keys = (
        "id",
        "thread_id",
        "source_id",
        "target_id",
        "kind",
        "body",
        "artifacts",
        "digest",
        "state",
        "created_at",
        "acknowledged_at",
    )
    result = dict(zip(keys, row, strict=True))
    result["artifacts"] = json.loads(result["artifacts"])
    result.pop("digest")
    return result


class CoordinationStore:
    def __init__(self, collaboration_store: Any) -> None:
        self.store = collaboration_store
        with self.store._lock, self.store._connect() as conn:
            conn.executescript(SCHEMA)
            if "held" not in {
                r[1] for r in conn.execute("PRAGMA table_info(coordination_resources)")
            }:
                conn.execute(
                    "ALTER TABLE coordination_resources ADD COLUMN held INTEGER NOT NULL DEFAULT 0"
                )

    @staticmethod
    def _event(conn: Any, thread: str, task: str, kind: str, detail: str = "") -> None:
        conn.execute(
            "INSERT INTO coordination_events(thread_id,task_id,kind,detail,created_at) "
            "VALUES(?,?,?,?,?)",
            (thread, task, kind, detail[:4000], time.time()),
        )

    def create(
        self,
        *,
        task_id: str,
        thread_id: str,
        member_id: str,
        actor_id: str,
        title: str,
        dependencies: list[str] | None = None,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        values = [
            text(v, k, 160)
            for v, k in (
                (task_id, "task"),
                (thread_id, "thread"),
                (member_id, "member"),
                (actor_id, "actor"),
            )
        ]
        task_id, thread_id, member_id, actor_id = values
        title = text(title, "title", 12000)
        if dependencies is not None and (
            not isinstance(dependencies, list) or any(not isinstance(d, str) for d in dependencies)
        ):
            raise ValueError("dependencies must be task IDs")
        deps = sorted(set(dependencies or []))
        if len(deps) > 32 or task_id in deps:
            raise ValueError("invalid dependencies")
        now = time.time()
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            old = conn.execute("SELECT * FROM coordination_tasks WHERE id=?", (task_id,)).fetchone()
            if old:
                current = task_row(old)
                if any(
                    current[k] != v
                    for k, v in zip(
                        ("thread_id", "member_id", "actor_id", "title", "dependencies"),
                        (thread_id, member_id, actor_id, title, deps),
                        strict=True,
                    )
                ):
                    raise ValueError("task id already used with different content")
                return current
            for dep in deps:
                row = conn.execute(
                    "SELECT thread_id FROM coordination_tasks WHERE id=?", (dep,)
                ).fetchone()
                if row is None or row[0] != thread_id:
                    raise ValueError("dependency is not in this group")
            root_id = str((context or {}).get("root_id") or task_id)
            if (
                root_id != task_id
                and conn.execute(
                    "SELECT count(*) FROM coordination_context WHERE root_id=? AND task_id<>root_id",
                    (root_id,),
                ).fetchone()[0]
                >= MAX_TASKS_PER_ROOT
            ):
                raise ValueError(f"本轮分派已达到 {MAX_TASKS_PER_ROOT} 项，请先收敛已有工作")
            conn.execute(
                "INSERT INTO coordination_tasks VALUES(?,?,?,?,?,'pending',?,'',?,?)",
                (*values, title, json.dumps(deps), now, now),
            )
            conn.execute(
                "INSERT INTO coordination_context VALUES(?,?,?)",
                (task_id, root_id, json.dumps(context or {}, ensure_ascii=False)),
            )
            self._event(conn, thread_id, task_id, "created")
        return self.get(task_id)  # type: ignore[return-value]

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self.store._lock, self.store._connect() as conn:
            row = conn.execute("SELECT * FROM coordination_tasks WHERE id=?", (task_id,)).fetchone()
        return task_row(row) if row else None

    def context(self, task_id: str) -> dict[str, Any]:
        """Host-only execution policy. Never included in model/UI snapshots."""
        with self.store._lock, self.store._connect() as conn:
            row = conn.execute(
                "SELECT data FROM coordination_context WHERE task_id=?", (task_id,)
            ).fetchone()
        return json.loads(row[0]) if row else {}

    def contexts(self, thread_id: str) -> dict[str, dict[str, Any]]:
        with self.store._lock, self.store._connect() as conn:
            rows = conn.execute(
                "SELECT c.task_id,c.data FROM coordination_context c JOIN coordination_tasks t "
                "ON t.id=c.task_id WHERE t.thread_id=?",
                (thread_id,),
            ).fetchall()
        return {row[0]: json.loads(row[1]) for row in rows}

    def transition(self, task_id: str, status: str, result: str = "") -> dict[str, Any]:
        if status not in {"pending", "working", "waiting", "done", "failed", "cancelled"}:
            raise ValueError("invalid task status")
        if len(result) > 32000:
            raise ValueError("result too long")
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM coordination_tasks WHERE id=?", (task_id,)).fetchone()
            if not row:
                raise ValueError("task not found")
            current = task_row(row)
            if current["status"] in TERMINAL and current["status"] != status:
                raise ValueError("task is already terminal")
            if current["status"] == status and current["result"] == result:
                return current
            conn.execute(
                "UPDATE coordination_tasks SET status=?,result=?,updated_at=? WHERE id=?",
                (status, result, time.time(), task_id),
            )
            self._event(conn, current["thread_id"], task_id, status, result)
            # The actual handler releases its lease. Cancellation must not
            # unlock a physical device while a timed-out worker still uses it.
        return self.get(task_id)  # type: ignore[return-value]

    def send(
        self,
        *,
        message_id: str,
        source_id: str,
        target_id: str,
        body: str,
        kind: str = "message",
        artifacts: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        message_id = text(message_id, "message id", 160)
        body = text(body, "message", 12000)
        if kind not in {"message", "handoff", "blocker"}:
            raise ValueError("invalid message kind")
        files = artifacts or []
        if not isinstance(files, list) or any(not isinstance(a, dict) for a in files):
            raise ValueError("artifacts must be objects with path, version and verification")
        if len(files) > 32:
            raise ValueError("too many artifacts")
        files = [
            {k: text(a.get(k, ""), k, 2000) for k in ("path", "version", "verification")}
            for a in files
        ]
        if kind == "handoff" and not files:
            raise ValueError("handoff requires a versioned artifact and verification note")
        encoded = json.dumps(files, sort_keys=True, ensure_ascii=False)
        digest = hashlib.sha256(
            json.dumps([source_id, target_id, kind, body, files], sort_keys=True).encode()
        ).hexdigest()
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            source = conn.execute(
                "SELECT thread_id FROM coordination_tasks WHERE id=?", (source_id,)
            ).fetchone()
            target = conn.execute(
                "SELECT thread_id FROM coordination_tasks WHERE id=?", (target_id,)
            ).fetchone()
            if not source or not target or source[0] != target[0] or source_id == target_id:
                raise ValueError("messages must target another task in this group")
            old = conn.execute(
                "SELECT * FROM coordination_messages WHERE id=?", (message_id,)
            ).fetchone()
            if old:
                if old[7] != digest:
                    raise ValueError("message id already used with different content")
                return message_row(old)
            conn.execute(
                "INSERT INTO coordination_messages VALUES(?,?,?,?,?,?,?,?,'pending',?,NULL)",
                (
                    message_id,
                    source[0],
                    source_id,
                    target_id,
                    kind,
                    body,
                    encoded,
                    digest,
                    time.time(),
                ),
            )
            self._event(conn, source[0], source_id, kind, body)
            row = conn.execute(
                "SELECT * FROM coordination_messages WHERE id=?", (message_id,)
            ).fetchone()
        return message_row(row)

    def inbox(self, task_id: str) -> list[dict[str, Any]]:
        with self.store._lock, self.store._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM coordination_messages WHERE target_id=? AND state='pending' "
                "ORDER BY created_at LIMIT 100",
                (task_id,),
            ).fetchall()
        return [message_row(r) for r in rows]

    def acknowledge(self, task_id: str, message_id: str, *, actor: str = "") -> bool:
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT thread_id,state FROM coordination_messages WHERE id=? AND target_id=?",
                (message_id, task_id),
            ).fetchone()
            if not row:
                raise ValueError("message not found for this recipient")
            if row[1] == "acknowledged":
                return True
            conn.execute(
                "UPDATE coordination_messages SET state='acknowledged',acknowledged_at=? WHERE id=?",
                (time.time(), message_id),
            )
            self._event(
                conn,
                row[0],
                task_id,
                "acknowledged",
                json.dumps({"message_id": message_id, "actor_id": actor}, ensure_ascii=False),
            )
        return True

    def snapshot(self, thread_id: str) -> dict[str, Any]:
        with self.store._lock, self.store._connect() as conn:
            tasks = [
                task_row(r)
                for r in conn.execute(
                    "SELECT * FROM coordination_tasks WHERE thread_id=? ORDER BY created_at DESC LIMIT 200",
                    (thread_id,),
                )
            ]
            messages = [
                message_row(r)
                for r in conn.execute(
                    "SELECT * FROM coordination_messages WHERE thread_id=? ORDER BY created_at DESC LIMIT 100",
                    (thread_id,),
                )
            ]
            events = [
                dict(zip(("seq", "task_id", "kind", "detail", "created_at"), r, strict=True))
                for r in conn.execute(
                    "SELECT seq,task_id,kind,detail,created_at FROM coordination_events WHERE thread_id=? "
                    "ORDER BY seq DESC LIMIT 100",
                    (thread_id,),
                )
            ]
            resources = [
                dict(zip(("resource", "task_id", "expires_at"), r, strict=True))
                for r in conn.execute(
                    "SELECT resource,task_id,expires_at FROM coordination_resources WHERE thread_id=? AND expires_at>? AND resource NOT LIKE 'call:%'",
                    (thread_id, time.time()),
                )
            ]
        return {"tasks": tasks, "messages": messages, "events": events, "resources": resources}

    def acquire(
        self,
        resource: str,
        thread_id: str,
        task_id: str,
        token: str,
        ttl: float = 120,
        *,
        held: bool = False,
    ) -> bool:
        """Atomic host-wide exclusion. A stale token can neither renew nor release."""
        resource = text(resource, "resource", 240)
        now = time.time()
        ttl = max(5, min(ttl, 300))
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT token,expires_at,generation,held FROM coordination_resources WHERE resource=?",
                (resource,),
            ).fetchone()
            if row and row[1] > now and row[0] != token:
                return False
            generation = int(row[2]) + (row[0] != token) if row else 1
            hold = int(held or bool(row and row[0] == token and row[1] > now and row[3]))
            conn.execute(
                "INSERT INTO coordination_resources VALUES(?,?,?,?,?,?,?) ON CONFLICT(resource) "
                "DO UPDATE SET thread_id=excluded.thread_id,task_id=excluded.task_id,token=excluded.token,"
                "generation=excluded.generation,expires_at=excluded.expires_at,held=excluded.held",
                (resource, thread_id, task_id, token, generation, now + ttl, hold),
            )
            if not row or row[0] != token:
                self._event(conn, thread_id, task_id, "resource_acquired", resource)
        return True

    def renew(self, resource: str, token: str, ttl: float = 120) -> bool:
        with self.store._lock, self.store._connect() as conn:
            now = time.time()
            return (
                conn.execute(
                    "UPDATE coordination_resources SET expires_at=? WHERE resource=? "
                    "AND token=? AND expires_at>?",
                    (now + max(5, min(ttl, 300)), resource, token, now),
                ).rowcount
                > 0
            )

    def owner_token(self, resource: str, task_id: str) -> str | None:
        with self.store._lock, self.store._connect() as conn:
            row = conn.execute(
                "SELECT token FROM coordination_resources WHERE resource=? "
                "AND task_id=? AND expires_at>?",
                (resource, task_id, time.time()),
            ).fetchone()
        return row[0] if row else None

    def release(self, resource: str, token: str) -> bool:
        with self.store._lock, self.store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if (
                not resource.startswith("call:")
                and conn.execute(
                    "SELECT 1 FROM coordination_resources WHERE resource=? AND expires_at>?",
                    ("call:" + resource, time.time()),
                ).fetchone()
            ):
                return False
            row = conn.execute(
                "SELECT thread_id,task_id FROM coordination_resources WHERE resource=? AND token=? "
                "AND expires_at>0",
                (resource, token),
            ).fetchone()
            if not row:
                return False
            conn.execute(
                "UPDATE coordination_resources SET expires_at=0 WHERE resource=? AND token=?",
                (resource, token),
            )
            self._event(conn, row[0], row[1], "resource_released", resource)
        return True

    def is_held(self, resource: str, token: str) -> bool:
        with self.store._lock, self.store._connect() as conn:
            return (
                conn.execute(
                    "SELECT 1 FROM coordination_resources WHERE resource=? AND token=? "
                    "AND held=1 AND expires_at>?",
                    (resource, token, time.time()),
                ).fetchone()
                is not None
            )
