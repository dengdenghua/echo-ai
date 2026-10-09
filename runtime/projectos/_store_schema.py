"""Project OS database schema and its versioned migrations."""

from __future__ import annotations

import sqlite3

from runtime.platform.io.sqlite_schema import Migration, add_column, execute_script, has_column
from runtime.projectos._store_project_deletion import ensure_project_delete_schema


def _migrate_project_event_seal_columns(conn: sqlite3.Connection) -> None:
    """Backfill the tamper-evident seal columns on older databases.

    ``seq`` is the per-project monotonic counter the chain folds in — without
    it, deleting a middle row would go undetected because the remaining rows
    re-seal consistently. Sealed rows keep their original seq; legacy unsealed
    rows (seq=0) are left alone and verified as a gap-free prefix failure.
    """
    if not has_column(conn, "project_events", "seq"):
        add_column(conn, "project_events", "seq", "INTEGER NOT NULL DEFAULT 0")
        # Legacy rows get their insertion order (rowid is monotonic on this
        # append-only table); new rows take MAX(seq)+1 per project from here on.
        conn.execute("UPDATE project_events SET seq = rowid WHERE seq = 0")
    add_column(conn, "project_events", "seal_prev", "TEXT NOT NULL DEFAULT ''")
    add_column(conn, "project_events", "seal", "TEXT NOT NULL DEFAULT ''")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, milestone_id TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_claims (
    task_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, claimed_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS milestone_claims (
    milestone_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, claimed_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_projects (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_project_generations (
    thread_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at REAL NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    seal_prev TEXT NOT NULL DEFAULT '',
    seal TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ms_project ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_task_ms ON tasks(milestone_id);
CREATE INDEX IF NOT EXISTS idx_project_events_project
    ON project_events(project_id, created_at);
"""


def _adopt_v1(conn: sqlite3.Connection) -> None:
    """Schema as of versioning, adopting databases from every earlier release."""
    execute_script(conn, _SCHEMA)
    ensure_project_delete_schema(conn)
    _migrate_project_event_seal_columns(conn)


_MIGRATIONS = (Migration(1, _adopt_v1),)
