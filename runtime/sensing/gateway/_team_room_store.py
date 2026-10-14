"""Versioned SQLite authority for rooms; JSON is a one-time import source."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from pathlib import Path

from runtime.platform.io import path_transaction
from runtime.platform.io.sqlite_schema import Migration, configure, migrate, schema_version

from ._team_rooms_state import _read_legacy_state, _room_storage_payload
from .team_rooms_models import TeamRoomWire

_MIGRATIONS = (
    Migration(
        1,
        """
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS room_store_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """,
    ),
)


def room_database_path(path: Path) -> Path:
    """Keep custom state filenames isolated, including filenames without suffixes."""
    return path.with_suffix(path.suffix + ".db")


def read_rooms(conn: sqlite3.Connection) -> dict[str, TeamRoomWire]:
    result: dict[str, TeamRoomWire] = {}
    for room_id, raw in conn.execute("SELECT id, payload FROM rooms ORDER BY id"):
        try:
            room = TeamRoomWire.model_validate(json.loads(raw))
        except (ValueError, TypeError) as exc:
            raise RuntimeError(f"invalid durable Team Room: {room_id}") from exc
        if room.id != room_id:
            raise RuntimeError(f"durable Team Room id mismatch: {room_id}")
        result[room_id] = room
    return result


def write_room_delta(
    conn: sqlite3.Connection,
    upserts: dict[str, TeamRoomWire],
    deleted: set[str],
) -> None:
    """Write only the caller's changed rows inside its existing transaction."""
    conn.executemany("DELETE FROM rooms WHERE id=?", ((key,) for key in sorted(deleted)))
    conn.executemany(
        "INSERT INTO rooms(id, payload) VALUES(?, ?) "
        "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
        (
            (key, json.dumps(_room_storage_payload(team), ensure_ascii=False, sort_keys=True))
            for key, team in sorted(upserts.items())
        ),
    )


def commit_room_delta(
    conn: sqlite3.Connection,
    upserts: dict[str, TeamRoomWire],
    deleted: set[str],
) -> None:
    """Commit the CAS check and delta together; exceptions roll back before commit."""
    write_room_delta(conn, upserts, deleted)
    conn.commit()


def _imported(conn: sqlite3.Connection) -> bool:
    return (
        conn.execute("SELECT 1 FROM room_store_meta WHERE key='legacy_imported'").fetchone()
        is not None
    )


def _import_legacy(
    conn: sqlite3.Connection,
    path: Path,
    resolver: Callable[[str | None], str] | None,
    *,
    strict: bool,
) -> None:
    if _imported(conn):
        return
    # The scrub acquires its own path lock. Do not nest it inside the import
    # lock: the transactional file lock deliberately is not re-entrant.
    from .team_invitations_router import scrub_legacy_room_invites

    scrub_legacy_room_invites(path)
    with path_transaction(path):
        conn.execute("BEGIN IMMEDIATE")
        if _imported(conn):
            conn.commit()
            return
        if conn.execute("SELECT 1 FROM rooms LIMIT 1").fetchone() is not None:
            raise RuntimeError("Team Room import marker missing from populated database")
        try:
            rooms = _read_legacy_state(path, legacy_tenant_for_owner=resolver, strict=True)
        except RuntimeError:
            conn.rollback()
            if strict:
                raise
            # Preserve tolerant startup without marking a corrupt source as
            # imported. The next strict runtime read still refuses it.
            return
        write_room_delta(conn, rooms, set())
        conn.execute("INSERT INTO room_store_meta(key, value) VALUES('legacy_imported', '1')")
        conn.commit()


@contextmanager
def room_connection(
    path: Path,
    resolver: Callable[[str | None], str] | None = None,
    *,
    strict: bool = True,
) -> Iterator[sqlite3.Connection]:
    db_path = room_database_path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path, timeout=10)) as conn:
        configure(conn, wal=False)
        if schema_version(conn) == 0:
            # Changing the journal mode races before SQLite's migration
            # transaction starts. Serialize bootstrap only; established
            # readers and heartbeats never take this file lock or set WAL.
            with path_transaction(db_path):
                configure(conn)
                migrate(conn, _MIGRATIONS, name="team_rooms")
        else:
            # Missing tables are corruption, not permission to rebuild an
            # authority and potentially restore a stale JSON backup.
            migrate(conn, _MIGRATIONS, name="team_rooms")
        _import_legacy(conn, path, resolver, strict=strict)
        with conn:
            yield conn
