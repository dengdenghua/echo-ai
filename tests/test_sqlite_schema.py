from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from runtime.platform.io.sqlite_schema import (
    Migration,
    SchemaTooNewError,
    add_column,
    has_column,
    migrate,
    schema_version,
)

STEPS = (
    Migration(1, "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY);\n"),
    Migration(2, lambda conn: add_column(conn, "items", "tenant_id", "TEXT NOT NULL DEFAULT ''")),
)


def _db(tmp_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(tmp_path / "items.db")


def test_fresh_database_reaches_the_latest_version(tmp_path: Path) -> None:
    conn = _db(tmp_path)
    assert migrate(conn, STEPS, name="items") == 2
    assert schema_version(conn) == 2 and has_column(conn, "items", "tenant_id")


def test_pre_versioning_database_is_adopted_without_errors(tmp_path: Path) -> None:
    conn = _db(tmp_path)
    conn.execute("CREATE TABLE items (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '')")
    conn.execute("INSERT INTO items VALUES ('a', 't1')")
    conn.commit()

    migrate(conn, STEPS, name="items")

    assert schema_version(conn) == 2
    assert conn.execute("SELECT tenant_id FROM items").fetchall() == [("t1",)]


def test_running_again_is_a_no_op(tmp_path: Path) -> None:
    conn = _db(tmp_path)
    migrate(conn, STEPS, name="items")
    calls: list[int] = []
    tracked = (*STEPS[:1], Migration(2, lambda c: calls.append(2)))
    migrate(conn, tracked, name="items")
    assert calls == []


def test_a_failed_step_keeps_the_last_completed_version(tmp_path: Path) -> None:
    conn = _db(tmp_path)

    def broken(c: sqlite3.Connection) -> None:
        c.execute("CREATE TABLE half_done (x)")
        raise RuntimeError("disk full")

    with pytest.raises(RuntimeError, match="disk full"):
        migrate(conn, (STEPS[0], Migration(2, broken)), name="items")

    assert schema_version(conn) == 1
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master")}
    assert "half_done" not in tables  # the failed step rolled back


def test_database_from_a_newer_build_is_refused(tmp_path: Path) -> None:
    conn = _db(tmp_path)
    conn.execute("PRAGMA user_version=7")
    with pytest.raises(SchemaTooNewError, match="version 7"):
        migrate(conn, STEPS, name="items")


def test_migrations_must_be_numbered_in_order(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="1..N"):
        migrate(_db(tmp_path), (Migration(2, "SELECT 1"),), name="items")


def test_stores_sharing_a_database_keep_separate_versions(tmp_path: Path) -> None:
    conn = _db(tmp_path)
    migrate(conn, STEPS, name="items")
    guest = (Migration(1, "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY);\n"),)

    assert migrate(conn, guest, name="notes", shared=True) == 1
    assert schema_version(conn) == 2  # the owner's user_version is untouched
    rows = conn.execute("SELECT component, version FROM schema_versions").fetchall()
    assert rows == [("notes", 1)]


def test_a_dropped_table_is_rebuilt_by_rerunning_every_step(tmp_path: Path) -> None:
    conn = _db(tmp_path)
    migrate(conn, STEPS, name="items")
    conn.execute("DROP TABLE items")

    migrate(conn, STEPS, name="items", expect_tables=("items",))

    assert has_column(conn, "items", "tenant_id")


def test_a_current_database_leaves_an_open_transaction_alone(tmp_path: Path) -> None:
    conn = _db(tmp_path)
    migrate(conn, STEPS, name="items")
    conn.execute("INSERT INTO items(id) VALUES ('pending')")
    assert conn.in_transaction

    migrate(conn, STEPS, name="items")

    assert conn.in_transaction  # not committed behind the caller's back
    conn.rollback()
    assert conn.execute("SELECT COUNT(*) FROM items").fetchone()[0] == 0


def test_pending_steps_refuse_to_run_inside_a_transaction(tmp_path: Path) -> None:
    conn = _db(tmp_path)
    conn.execute("CREATE TABLE other (x)")
    conn.execute("INSERT INTO other VALUES (1)")
    with pytest.raises(RuntimeError, match="before opening a transaction"):
        migrate(conn, STEPS, name="items")
