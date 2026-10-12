"""Fence old canonical writers from losing adopted message identities or receipts."""

import sqlite3

from runtime.platform.io.sqlite_schema import execute_script


def adopt_transcript_guards(conn: sqlite3.Connection) -> None:
    execute_script(
        conn,
        """
CREATE TABLE IF NOT EXISTS collaboration_room_transcript_cursors (
    room_id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL CHECK(last_seq>=0)
);
INSERT INTO collaboration_room_transcript_cursors
SELECT room_id,MAX(room_seq) FROM collaboration_messages GROUP BY room_id
ON CONFLICT(room_id) DO UPDATE SET last_seq=MAX(last_seq,excluded.last_seq);
DROP TRIGGER IF EXISTS collab_room_cursor_on_insert;
CREATE TRIGGER collab_room_cursor_on_insert
AFTER INSERT ON collaboration_messages
BEGIN
    UPDATE collaboration_messages SET room_seq=MAX(
      COALESCE((SELECT last_seq FROM collaboration_room_transcript_cursors WHERE room_id=NEW.room_id),0),
      (SELECT COALESCE(MAX(room_seq),0) FROM collaboration_messages WHERE room_id=NEW.room_id)
    )+1 WHERE rowid=NEW.rowid AND NEW.room_seq=0;
    INSERT INTO collaboration_room_transcript_cursors
    SELECT NEW.room_id,room_seq FROM collaboration_messages WHERE rowid=NEW.rowid
    ON CONFLICT(room_id) DO UPDATE SET last_seq=MAX(last_seq,excluded.last_seq);
END;
UPDATE collaboration_messages
SET metadata_json=json_set(metadata_json,'$.message_id','room-msg-'||lower(hex(randomblob(16))))
WHERE json_valid(metadata_json) AND COALESCE(json_extract(metadata_json,'$.message_id'),'')=''
  AND EXISTS(SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=collaboration_messages.room_id);
CREATE TRIGGER IF NOT EXISTS collab_adopted_message_identity
AFTER INSERT ON collaboration_messages
WHEN EXISTS(SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=NEW.room_id)
  AND json_valid(NEW.metadata_json) AND COALESCE(json_extract(NEW.metadata_json,'$.message_id'),'')=''
BEGIN
    UPDATE collaboration_messages
    SET metadata_json=json_set(metadata_json,'$.message_id','room-msg-'||lower(hex(randomblob(16))))
    WHERE rowid=NEW.rowid;
END;
CREATE TRIGGER IF NOT EXISTS collab_adopted_message_insert_valid
BEFORE INSERT ON collaboration_messages
WHEN EXISTS(SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=NEW.room_id)
BEGIN
    SELECT CASE WHEN NOT json_valid(NEW.metadata_json) THEN RAISE(ABORT,'invalid adopted Room metadata') END;
    SELECT CASE WHEN json_type(NEW.metadata_json)!='object' THEN RAISE(ABORT,'invalid adopted Room metadata') END;
    SELECT CASE WHEN json_type(NEW.metadata_json,'$.message_id') NOT IN ('text','null')
      THEN RAISE(ABORT,'invalid adopted Room message identity') END;
    SELECT CASE WHEN length(CAST(NEW.metadata_json AS BLOB))>524288 OR (
      COALESCE(json_extract(NEW.metadata_json,'$.message_id'),'')='' AND
      length(CAST(json_set(NEW.metadata_json,'$.message_id','room-msg-'||lower(hex(zeroblob(16)))) AS BLOB))>524288
    ) THEN RAISE(ABORT,'adopted Room metadata is too large') END;
    SELECT CASE WHEN NEW.room_seq>0 AND NEW.room_seq<=COALESCE(
      (SELECT last_seq FROM collaboration_room_transcript_cursors WHERE room_id=NEW.room_id),0
    ) THEN RAISE(ABORT,'adopted Room cursor cannot be reused') END;
    SELECT CASE WHEN COALESCE(json_extract(NEW.metadata_json,'$.message_id'),'')!='' AND EXISTS(
      SELECT 1 FROM collaboration_messages WHERE room_id=NEW.room_id AND json_valid(metadata_json)
        AND json_extract(metadata_json,'$.message_id')=json_extract(NEW.metadata_json,'$.message_id')
    ) THEN RAISE(ABORT,'adopted Room message identity is duplicated') END;
END;
CREATE TRIGGER IF NOT EXISTS collab_adopted_message_cursor_update
BEFORE UPDATE OF room_seq ON collaboration_messages
WHEN OLD.room_seq>0 AND OLD.room_seq!=NEW.room_seq
  AND EXISTS(SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=OLD.room_id)
BEGIN
    SELECT RAISE(ABORT,'adopted Room cursor is immutable');
END;
CREATE TRIGGER IF NOT EXISTS collab_adopted_message_room_update
BEFORE UPDATE OF room_id ON collaboration_messages
WHEN OLD.room_id!=NEW.room_id AND (
  EXISTS(SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=OLD.room_id) OR
  EXISTS(SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=NEW.room_id))
BEGIN
    SELECT RAISE(ABORT,'adopted Room message cannot change Room');
END;
CREATE TRIGGER IF NOT EXISTS collab_adopted_message_identity_update
BEFORE UPDATE OF metadata_json ON collaboration_messages
WHEN EXISTS(SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=OLD.room_id)
  AND COALESCE(json_extract(OLD.metadata_json,'$.message_id'),'')!=''
BEGIN
    SELECT CASE WHEN NOT json_valid(NEW.metadata_json)
      OR COALESCE(json_extract(NEW.metadata_json,'$.message_id'),'')!=json_extract(OLD.metadata_json,'$.message_id')
      THEN RAISE(ABORT,'adopted Room message identity is immutable') END;
END;
CREATE TRIGGER IF NOT EXISTS collab_adopted_receipt_insert
BEFORE INSERT ON collaboration_message_receipts
WHEN EXISTS(SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=NEW.room_id)
BEGIN
    SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM collaboration_messages WHERE room_id=NEW.room_id AND room_seq=NEW.seq
        AND json_valid(metadata_json) AND json_extract(metadata_json,'$.message_id')=NEW.message_id
    ) THEN RAISE(ABORT,'receipt does not identify an adopted Room message') END;
END;
CREATE TRIGGER IF NOT EXISTS collab_adopted_receipt_update
BEFORE UPDATE ON collaboration_message_receipts
WHEN EXISTS(SELECT 1 FROM collaboration_room_transcript_imports WHERE room_id=NEW.room_id)
BEGIN
    SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM collaboration_messages WHERE room_id=NEW.room_id AND room_seq=NEW.seq
        AND json_valid(metadata_json) AND json_extract(metadata_json,'$.message_id')=NEW.message_id
    ) THEN RAISE(ABORT,'receipt does not identify an adopted Room message') END;
END;
""",
    )
