"""Version two: TeamTask authority on the existing collaboration task row."""

from __future__ import annotations

import sqlite3

from runtime.platform.io.sqlite_schema import add_column, execute_script


def adopt_team_task_authority(conn: sqlite3.Connection) -> None:
    add_column(conn, "collaboration_tasks", "task_authority", "TEXT NOT NULL DEFAULT 'projection'")
    add_column(conn, "collaboration_tasks", "task_revision", "INTEGER NOT NULL DEFAULT 0")
    add_column(conn, "collaboration_tasks", "team_binding_json", "TEXT NOT NULL DEFAULT '{}'")
    execute_script(
        conn,
        """
CREATE TABLE IF NOT EXISTS collaboration_team_task_claims (
    task_id TEXT PRIMARY KEY,
    run_token TEXT NOT NULL UNIQUE,
    process_owner TEXT NOT NULL,
    expires_at REAL NOT NULL,
    cancel_requested INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS collaboration_team_task_imports (
    source_path TEXT PRIMARY KEY,
    source_sha256 TEXT NOT NULL,
    imported_count INTEGER NOT NULL,
    imported_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS collab_team_task_revision_fence
BEFORE UPDATE ON collaboration_tasks
WHEN OLD.task_authority = 'team' AND (
    NEW.task_authority != 'team' OR
    NEW.task_revision != OLD.task_revision + 1 OR
    NEW.task_id != OLD.task_id OR
    NEW.session_id != OLD.session_id OR
    NEW.room_id != OLD.room_id OR
    NEW.team_binding_json != OLD.team_binding_json
)
BEGIN
    SELECT RAISE(ABORT, 'team task requires its versioned authority');
END;
CREATE TRIGGER IF NOT EXISTS collab_team_task_delete_cancel
AFTER DELETE ON collaboration_tasks
WHEN OLD.task_authority = 'team'
BEGIN
    UPDATE collaboration_team_task_claims SET cancel_requested=1
    WHERE task_id=OLD.task_id;
END;
""",
    )
