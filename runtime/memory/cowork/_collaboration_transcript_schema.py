"""Canonical Room cursor and once-only legacy transcript import ledger."""

from __future__ import annotations

import sqlite3
from uuid import uuid4

from runtime.platform.io.sqlite_schema import add_column, execute_script


def adopt_room_transcripts(conn: sqlite3.Connection) -> None:
    add_column(conn, "collaboration_messages", "room_seq", "INTEGER NOT NULL DEFAULT 0")
    execute_script(
        conn,
        """
CREATE TABLE IF NOT EXISTS collaboration_transcript_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), identity TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collaboration_room_transcript_imports (
    room_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
    imported_count INTEGER NOT NULL, adopted_count INTEGER NOT NULL,
    receipt_count INTEGER NOT NULL, imported_at TEXT NOT NULL
);
WITH ordered AS MATERIALIZED (
    SELECT rowid AS rid,
      ROW_NUMBER() OVER(PARTITION BY room_id ORDER BY seq) + (
        SELECT COALESCE(MAX(prior.room_seq),0) FROM collaboration_messages prior
        WHERE prior.room_id=collaboration_messages.room_id
      ) AS n
    FROM collaboration_messages WHERE room_seq=0
)
UPDATE collaboration_messages SET room_seq=(SELECT n FROM ordered WHERE rid=collaboration_messages.rowid)
WHERE room_seq=0;
UPDATE collaboration_message_receipts SET seq=(
    SELECT message.room_seq FROM collaboration_messages message
    WHERE message.room_id=collaboration_message_receipts.room_id
      AND json_valid(message.metadata_json)
      AND json_extract(message.metadata_json,'$.message_id')=collaboration_message_receipts.message_id
) WHERE 1=(
    SELECT COUNT(*) FROM collaboration_messages message
    WHERE message.room_id=collaboration_message_receipts.room_id
      AND json_valid(message.metadata_json)
      AND json_extract(message.metadata_json,'$.message_id')=collaboration_message_receipts.message_id
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_room_cursor
ON collaboration_messages(room_id,room_seq) WHERE room_seq>0;
CREATE TRIGGER IF NOT EXISTS collab_room_cursor_on_insert
AFTER INSERT ON collaboration_messages WHEN NEW.room_seq=0
BEGIN
    UPDATE collaboration_messages SET room_seq=(
      SELECT COALESCE(MAX(room_seq),0)+1 FROM collaboration_messages WHERE room_id=NEW.room_id
    ) WHERE rowid=NEW.rowid;
END;
""",
    )
    conn.execute(
        "INSERT OR IGNORE INTO collaboration_transcript_identity VALUES(1,?)", (uuid4().hex,)
    )
