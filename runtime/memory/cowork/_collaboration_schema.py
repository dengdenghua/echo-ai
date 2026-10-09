"""SQLite schema for collaboration sessions and their projections."""

import sqlite3

from runtime.memory.cowork.collaboration_collectors import (
    COLLABORATION_COLLECTOR_SCHEMA,
    ensure_collaboration_collector_schema,
)
from runtime.memory.cowork.collaboration_deliveries import COLLABORATION_DELIVERY_SCHEMA
from runtime.memory.cowork.collaboration_runs import COLLABORATION_RUN_SCHEMA
from runtime.memory.cowork.context_lifecycle import CONTEXT_LIFECYCLE_SCHEMA
from runtime.platform.io.sqlite_schema import Migration, add_column, execute_script

_SCHEMA = (
    """
CREATE TABLE IF NOT EXISTS collaboration_rooms (
    session_id TEXT PRIMARY KEY,
    room_id    TEXT NOT NULL UNIQUE,
    room_json  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_rooms_room ON collaboration_rooms(room_id);

CREATE TABLE IF NOT EXISTS collaboration_project_generations (
    session_id  TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL DEFAULT '',
    generation  INTEGER NOT NULL
);
INSERT OR IGNORE INTO collaboration_project_generations(session_id, project_id, generation)
SELECT
    session_id,
    CASE WHEN json_valid(room_json) THEN COALESCE(
            json_extract(room_json, '$.metadata.project_id'),
            json_extract(room_json, '$.project_id'),
            ''
        ) ELSE '' END,
    CASE
        WHEN json_valid(room_json) THEN CASE
            WHEN json_type(room_json, '$.metadata.project_binding_generation') = 'integer'
            THEN MAX(0, CAST(json_extract(
                room_json,
                '$.metadata.project_binding_generation'
            ) AS INTEGER))
            ELSE 0
        END
        ELSE 0
    END
FROM collaboration_rooms
WHERE CASE WHEN json_valid(room_json) THEN
    json_extract(room_json, '$.metadata.project_id') IS NOT NULL
    OR json_extract(room_json, '$.project_id') IS NOT NULL
    OR json_extract(room_json, '$.metadata.project_binding_generation') IS NOT NULL
    ELSE 0 END;

CREATE TABLE IF NOT EXISTS collaboration_room_owners (
    room_id     TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    project_id  TEXT NOT NULL DEFAULT '',
    generation  INTEGER NOT NULL
);
INSERT OR IGNORE INTO collaboration_room_owners(room_id, session_id, project_id, generation)
SELECT r.room_id, r.session_id, COALESCE(g.project_id, ''), COALESCE(g.generation, 0)
FROM collaboration_rooms r
LEFT JOIN collaboration_project_generations g ON g.session_id=r.session_id;

CREATE TABLE IF NOT EXISTS collaboration_project_room_bindings (
    project_id  TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    room_id     TEXT NOT NULL,
    generation  INTEGER NOT NULL,
    PRIMARY KEY (project_id, session_id)
);
CREATE TABLE IF NOT EXISTS collaboration_deleted_projects (
    project_id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    deleted_at TEXT NOT NULL
);
INSERT OR IGNORE INTO collaboration_project_room_bindings(
    project_id, session_id, room_id, generation
)
SELECT g.project_id, r.session_id, r.room_id, g.generation
FROM collaboration_rooms r
INNER JOIN collaboration_project_generations g ON g.session_id=r.session_id
WHERE g.project_id != '';

CREATE TABLE IF NOT EXISTS collaboration_tasks (
    task_id    TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    room_id    TEXT NOT NULL,
    status     TEXT NOT NULL,
    task_json  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_session ON collaboration_tasks(session_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_room ON collaboration_tasks(room_id, updated_at);

CREATE TABLE IF NOT EXISTS collaboration_messages (
    session_id     TEXT NOT NULL,
    seq            INTEGER NOT NULL,
    room_id        TEXT NOT NULL,
    participant_id TEXT,
    display_name   TEXT,
    text           TEXT NOT NULL,
    ts             TEXT NOT NULL,
    metadata_json  TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_collab_messages_session ON collaboration_messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_collab_messages_room ON collaboration_messages(room_id, seq);
CREATE TABLE IF NOT EXISTS collaboration_message_receipts (
    room_id        TEXT NOT NULL,
    message_id     TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    status         TEXT NOT NULL,
    seq            INTEGER,
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (room_id, message_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_message_receipts_room
ON collaboration_message_receipts(room_id, updated_at);

CREATE TABLE IF NOT EXISTS collaboration_annotations (
    annotation_id TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    room_id       TEXT NOT NULL,
    message_id    TEXT NOT NULL,
    author_id     TEXT NOT NULL DEFAULT '',
    author_json   TEXT NOT NULL DEFAULT '{}',
    body          TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    resolved      INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_annotations_session
ON collaboration_annotations(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_annotations_message
ON collaboration_annotations(session_id, message_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collaboration_annotation_replies (
    reply_id      TEXT PRIMARY KEY,
    annotation_id TEXT NOT NULL,
    author_id     TEXT NOT NULL DEFAULT '',
    author_json   TEXT NOT NULL DEFAULT '{}',
    body          TEXT NOT NULL,
    created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_annotation_replies_annotation
ON collaboration_annotation_replies(annotation_id, created_at);

CREATE TABLE IF NOT EXISTS collaboration_message_reactions (
    session_id     TEXT NOT NULL,
    room_id        TEXT NOT NULL,
    message_id     TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    emoji          TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    PRIMARY KEY (session_id, message_id, participant_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_collab_message_reactions_session
ON collaboration_message_reactions(session_id, message_id, emoji);

CREATE TABLE IF NOT EXISTS collaboration_pinned_messages (
    session_id     TEXT NOT NULL,
    room_id        TEXT NOT NULL,
    message_id     TEXT NOT NULL,
    pinned_by      TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    PRIMARY KEY (session_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_pinned_messages_session
ON collaboration_pinned_messages(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collaboration_member_runtime_sessions (
    collaboration_session_id TEXT NOT NULL,
    agent_id                 TEXT NOT NULL,
    subagent_session_id      TEXT NOT NULL,
    context_hashes_json      TEXT NOT NULL DEFAULT '{}',
    revision                 INTEGER NOT NULL DEFAULT 1,
    updated_at               TEXT NOT NULL,
    PRIMARY KEY (collaboration_session_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_member_runtime_subagent
ON collaboration_member_runtime_sessions(subagent_session_id);

CREATE TABLE IF NOT EXISTS collaboration_member_runtime_leases (
    collaboration_session_id TEXT NOT NULL,
    agent_id                  TEXT NOT NULL,
    owner_id                  TEXT NOT NULL,
    expires_at                REAL NOT NULL,
    updated_at                TEXT NOT NULL,
    PRIMARY KEY (collaboration_session_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_member_runtime_lease_expiry
ON collaboration_member_runtime_leases(expires_at);
"""
    + COLLABORATION_RUN_SCHEMA
    + COLLABORATION_DELIVERY_SCHEMA
    + COLLABORATION_COLLECTOR_SCHEMA
    + CONTEXT_LIFECYCLE_SCHEMA
)


def _adopt_v1(conn: sqlite3.Connection) -> None:
    """Schema as of versioning, adopting databases from every earlier release."""
    execute_script(conn, _SCHEMA)
    ensure_collaboration_collector_schema(conn)
    # Installations from before structured messages lack the metadata column.
    add_column(conn, "collaboration_messages", "metadata_json", "TEXT NOT NULL DEFAULT '{}'")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_messages_source "
        "ON collaboration_messages("
        "session_id, CASE WHEN json_valid(metadata_json) "
        "THEN json_extract(metadata_json, '$.source_message_id') END"
        ") WHERE CASE WHEN json_valid(metadata_json) "
        "THEN COALESCE(json_extract(metadata_json, '$.source_message_id'), '') != '' "
        "ELSE 0 END"
    )


_MIGRATIONS = (Migration(1, _adopt_v1),)
