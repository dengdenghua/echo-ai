"""Versioned SQLite schemas: ordered migrations recorded in ``user_version``.

Stores used to run ``CREATE TABLE IF NOT EXISTS`` and then sniff
``PRAGMA table_info`` to decide which ``ALTER TABLE`` to apply. That cannot
tell a database written by a newer build from one that merely lacks a column,
and every store invented its own variant. A store now declares its schema as
numbered steps::

    MIGRATIONS = (
        Migration(1, "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY)"),
        Migration(2, lambda conn: add_column(conn, "items", "tenant_id",
                                             "TEXT NOT NULL DEFAULT ''")),
    )
    migrate(conn, MIGRATIONS, name="items")

Each step runs in its own transaction together with the version bump, so a
crash mid-upgrade leaves the database at the last completed version. Steps
must be safe on databases created before versioning existed (version 0 with
the tables already present): use ``IF NOT EXISTS`` and ``add_column``.
A database whose version is newer than the code is refused instead of being
written with a schema the code does not understand.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass


class SchemaTooNewError(RuntimeError):
    """The database was upgraded by a newer build than the running one."""


@dataclass(frozen=True)
class Migration:
    version: int
    apply: str | Callable[[sqlite3.Connection], None]


def configure(
    conn: sqlite3.Connection, *, wal: bool = True, busy_timeout_ms: int = 10_000
) -> sqlite3.Connection:
    """Apply the connection settings every store should share."""
    conn.execute(f"PRAGMA busy_timeout={int(busy_timeout_ms)}")
    if wal:
        conn.execute("PRAGMA journal_mode=WAL")
    return conn


def schema_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in conn.execute(f'PRAGMA table_info("{table}")'))


def add_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    """``ALTER TABLE … ADD COLUMN`` unless the column already exists."""
    if not has_column(conn, table, column):
        conn.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}')


def _run_step(conn: sqlite3.Connection, step: Migration) -> None:
    if isinstance(step.apply, str):
        # executescript would COMMIT first; run statements inside our transaction.
        for statement in _statements(step.apply):
            conn.execute(statement)
    else:
        step.apply(conn)
    conn.execute(f"PRAGMA user_version={int(step.version)}")


def _statements(script: str) -> list[str]:
    statements: list[str] = []
    buffer = ""
    for line in script.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            if buffer.strip():
                statements.append(buffer.strip())
            buffer = ""
    if buffer.strip():
        statements.append(buffer.strip())
    return statements


def migrate(conn: sqlite3.Connection, migrations: Sequence[Migration], *, name: str) -> int:
    """Bring *conn* to the newest version in *migrations*; return that version."""
    versions = [step.version for step in migrations]
    if versions != list(range(1, len(versions) + 1)):
        raise ValueError(f"{name}: migrations must be numbered 1..N in order, got {versions}")
    latest = versions[-1] if versions else 0
    current = schema_version(conn)
    if current > latest:
        raise SchemaTooNewError(
            f"{name} database is at schema version {current}, newer than this build "
            f"({latest}); refusing to write to it"
        )
    previous_isolation = conn.isolation_level
    conn.isolation_level = None  # explicit BEGIN/COMMIT around each step
    try:
        for step in migrations[current:]:
            conn.execute("BEGIN IMMEDIATE")
            try:
                _run_step(conn, step)
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
    finally:
        conn.isolation_level = previous_isolation
    return latest


__all__ = [
    "Migration",
    "SchemaTooNewError",
    "add_column",
    "configure",
    "has_column",
    "migrate",
    "schema_version",
]
