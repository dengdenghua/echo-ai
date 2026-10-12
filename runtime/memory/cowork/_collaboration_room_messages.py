"""Room-scoped access to messages in the canonical collaboration log."""

import sqlite3
from typing import Any

from runtime.memory.cowork.ids import normalize_search_query, require_cowork_id


def append_message_for_room(
    store: Any,
    room_id: str,
    *,
    text: str,
    participant_id: str = "",
    display_name: str = "",
    metadata: dict[str, Any] | None = None,
) -> int | None:
    room_id = require_cowork_id(room_id, label="room_id")
    session_id = store.session_id_for_room(room_id)
    if not session_id:
        return None
    return store.append_message(
        session_id,
        room_id=room_id,
        text=text,
        participant_id=participant_id,
        display_name=display_name,
        metadata=metadata,
    )


def room_message_rows(
    conn: sqlite3.Connection, room_id: str, *, limit: int, after_seq: int = 0, query: str = ""
) -> list[dict[str, Any]]:
    """Return Room order/cursors while retaining the Session action sequence."""
    from runtime.memory.cowork.collaboration_store import _message_from_row

    q = normalize_search_query(query)
    limit = max(1, min(2000, int(limit)))
    if q:
        rows = conn.execute(
            "SELECT session_id,seq,room_id,participant_id,display_name,text,ts,metadata_json,room_seq "
            "FROM collaboration_messages WHERE room_id=? AND "
            "(lower(text) LIKE ? OR lower(metadata_json) LIKE ?) ORDER BY room_seq DESC LIMIT ?",
            (room_id, f"%{q}%", f"%{q}%", limit),
        ).fetchall()
    elif after_seq > 0:
        rows = conn.execute(
            "SELECT session_id,seq,room_id,participant_id,display_name,text,ts,metadata_json,room_seq "
            "FROM collaboration_messages WHERE room_id=? AND room_seq>? ORDER BY room_seq LIMIT ?",
            (room_id, int(after_seq), limit),
        ).fetchall()
    else:
        rows = list(
            reversed(
                conn.execute(
                    "SELECT session_id,seq,room_id,participant_id,display_name,text,ts,metadata_json,room_seq "
                    "FROM collaboration_messages WHERE room_id=? ORDER BY room_seq DESC LIMIT ?",
                    (room_id, limit),
                ).fetchall()
            )
        )
    messages = []
    for row in rows:
        message = _message_from_row(row[:8])
        message["room_seq"] = int(row[8])
        receipts = conn.execute(
            "SELECT message_id,participant_id,status,seq,updated_at "
            "FROM collaboration_message_receipts WHERE room_id=? AND message_id=?",
            (room_id, str(message["metadata"].get("message_id") or "")),
        ).fetchall()
        message["receipts"] = [
            dict(message_id=r[0], participant_id=r[1], status=r[2], seq=r[3], updated_at=r[4])
            for r in receipts
        ]
        messages.append(message)
    return messages


def messages_for_room(
    store: Any, room_id: str, *, limit: int = 200, after_seq: int = 0
) -> list[dict[str, Any]]:
    if not room_id:
        return []
    room_id = require_cowork_id(room_id, label="room_id")
    with store._lock, store._connect() as conn:
        conn.execute("BEGIN")
        return room_message_rows(conn, room_id, limit=limit, after_seq=after_seq)


def search_messages_for_room(
    store: Any, room_id: str, query: str, *, limit: int = 50
) -> list[dict[str, Any]]:
    if not room_id or not normalize_search_query(query):
        return []
    room_id = require_cowork_id(room_id, label="room_id")
    with store._lock, store._connect() as conn:
        conn.execute("BEGIN")
        return room_message_rows(conn, room_id, limit=min(200, limit), query=query)


def move_room_messages(conn: sqlite3.Connection, room_id: str, session_id: str) -> None:
    """Allocate destination Session sequences without changing Room cursors."""
    rows = conn.execute(
        "SELECT rowid FROM collaboration_messages WHERE room_id=? ORDER BY room_seq", (room_id,)
    ).fetchall()
    last = int(
        conn.execute(
            "SELECT COALESCE(MAX(seq),0) FROM collaboration_messages WHERE session_id=?",
            (session_id,),
        ).fetchone()[0]
    )
    for offset, (rowid,) in enumerate(rows, 1):
        conn.execute(
            "UPDATE collaboration_messages SET session_id=?,seq=? WHERE rowid=?",
            (session_id, last + offset, rowid),
        )
    conn.execute(
        "UPDATE collaboration_annotations SET session_id=? WHERE room_id=?", (session_id, room_id)
    )
    conn.execute(
        "UPDATE collaboration_message_reactions SET session_id=? WHERE room_id=?",
        (session_id, room_id),
    )
    conn.execute(
        "UPDATE collaboration_pinned_messages SET session_id=? WHERE room_id=?",
        (session_id, room_id),
    )
