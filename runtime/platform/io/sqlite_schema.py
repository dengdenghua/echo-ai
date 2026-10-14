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

The version normally lives in ``PRAGMA user_version``. When several stores
share one database file each keeps its own row in ``schema_versions`` instead
(``migrate(..., shared=True)``), so their step numbers never collide.
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


def execute_script(conn: sqlite3.Connection, script: str) -> None:
    """Run a multi-statement script inside the caller's transaction.

    ``Connection.executescript`` COMMITs first, which would split a migration
    step from its version bump.
    """
    for statement in _statements(script):
        conn.execute(statement)


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


_VERSIONS_TABLE = (
    "CREATE TABLE IF NOT EXISTS schema_versions "
    "(component TEXT PRIMARY KEY, version INTEGER NOT NULL)"
)


def _shared_version(conn: sqlite3.Connection, name: str) -> int:
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_versions'"
    ).fetchone()
    if not exists:
        return 0
    row = conn.execute("SELECT version FROM schema_versions WHERE component=?", (name,)).fetchone()
    return int(row[0]) if row else 0


def _record_version(conn: sqlite3.Connection, name: str, version: int, *, shared: bool) -> None:
    if not shared:
        conn.execute(f"PRAGMA user_version={int(version)}")
        return
    conn.execute(_VERSIONS_TABLE)
    conn.execute(
        "INSERT INTO schema_versions(component, version) VALUES(?, ?) "
        "ON CONFLICT(component) DO UPDATE SET version=excluded.version",
        (name, int(version)),
    )


def _missing_table(conn: sqlite3.Connection, tables: Sequence[str]) -> bool:
    if not tables:
        return False
    marks = ",".join("?" for _ in tables)
    found = conn.execute(
        f"SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ({marks})",  # nosec B608 - placeholders only
        tuple(tables),
    ).fetchone()[0]
    return int(found) < len(set(tables))


def migrate(
    conn: sqlite3.Connection,
    migrations: Sequence[Migration],
    *,
    name: str,
    shared: bool = False,
    expect_tables: Sequence[str] = (),
) -> int:
    """Bring *conn* to the newest version in *migrations*; return that version.

    A current database costs one read and leaves the connection untouched, so
    stores may call this on every connect. Pending steps need the connection
    outside a transaction. ``shared=True`` records the version under *name* in
    ``schema_versions`` for databases that more than one store writes to.
    If any of *expect_tables* is missing (a table dropped behind the store's
    back) every step runs again, which is safe because steps must already
    tolerate tables that exist.
    """
    versions = [step.version for step in migrations]
    if versions != list(range(1, len(versions) + 1)):
        raise ValueError(f"{name}: migrations must be numbered 1..N in order, got {versions}")
    latest = versions[-1] if versions else 0

    def stored() -> int:
        return _shared_version(conn, name) if shared else schema_version(conn)

    rebuild = _missing_table(conn, expect_tables)
    current = 0 if rebuild else stored()
    if current > latest:
        raise SchemaTooNewError(
            f"{name} database is at schema version {current}, newer than this build "
            f"({latest}); refusing to write to it"
        )
    if current == latest:
        return latest
    if conn.in_transaction:
        raise RuntimeError(f"{name}: run migrations before opening a transaction")
    previous_isolation = conn.isolation_level
    conn.isolation_level = None  # explicit BEGIN/COMMIT around each step
    try:
        for step in migrations[current:]:
            conn.execute("BEGIN IMMEDIATE")
            try:
                # Another process may have applied it while we waited.
                if not rebuild and stored() >= step.version:
                    conn.execute("COMMIT")
                    continue
                if isinstance(step.apply, str):
                    execute_script(conn, step.apply)
                else:
                    step.apply(conn)
                _record_version(conn, name, step.version, shared=shared)
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
    "execute_script",
    "has_column",
    "migrate",
    "schema_version",
]
