"""SQLite commit boundaries for future shared project invalidations."""

import sqlite3

import pytest

from runtime.projectos.commit_notifications import connect_project_changes


@pytest.fixture
def database(tmp_path):
    path = str(tmp_path / "projects.db")
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE items (id INTEGER PRIMARY KEY)")
    return path


def test_context_commit_notifies_after_changes_are_visible_and_connection_closes(database):
    seen = []

    def notify():
        with sqlite3.connect(database) as reader:
            seen.append(reader.execute("SELECT id FROM items").fetchall())

    connection = connect_project_changes(database, notify)
    with connection:
        connection.execute("INSERT INTO items VALUES (1)")
        assert seen == []
    assert seen == [[(1,)]]
    with pytest.raises(sqlite3.ProgrammingError):
        connection.execute("SELECT 1")


def test_read_only_transaction_does_not_notify(database):
    seen = []
    with connect_project_changes(database, lambda: seen.append(True)) as connection:
        connection.execute("SELECT * FROM items").fetchall()
    assert seen == []


def test_exception_rolls_back_without_notification(database):
    seen = []
    with (
        pytest.raises(ValueError, match="abort"),
        connect_project_changes(database, lambda: seen.append(True)) as connection,
    ):
        connection.execute("INSERT INTO items VALUES (1)")
        raise ValueError("abort")
    assert seen == []
    with sqlite3.connect(database) as reader:
        assert reader.execute("SELECT * FROM items").fetchall() == []


def test_explicit_commit_is_not_notified_again_on_context_exit(database):
    seen = []
    with connect_project_changes(database, lambda: seen.append(True)) as connection:
        connection.execute("INSERT INTO items VALUES (1)")
        connection.commit()
        assert seen == [True]
    assert seen == [True]


def test_rollback_then_new_write_only_notifies_new_commit(database):
    seen = []
    with connect_project_changes(database, lambda: seen.append(True)) as connection:
        connection.execute("INSERT INTO items VALUES (1)")
        connection.rollback()
        assert seen == []
        connection.execute("INSERT INTO items VALUES (2)")
    assert seen == [True]
    with sqlite3.connect(database) as reader:
        assert reader.execute("SELECT id FROM items").fetchall() == [(2,)]


def test_explicit_rollback_context_exit_does_not_notify(database):
    seen = []
    with connect_project_changes(database, lambda: seen.append(True)) as connection:
        connection.execute("INSERT INTO items VALUES (1)")
        connection.rollback()
    assert seen == []


def test_commit_constraint_failure_closes_without_notification(database):
    seen = []
    connection = connect_project_changes(database, lambda: seen.append(True))
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute(
        "CREATE TABLE children (parent INTEGER REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED)"
    )
    with pytest.raises(sqlite3.IntegrityError), connection:
        connection.execute("INSERT INTO children VALUES (99)")
    assert seen == []
    with pytest.raises(sqlite3.ProgrammingError):
        connection.execute("SELECT 1")


def test_notification_failure_cannot_turn_a_committed_write_into_failure(database, caplog):
    def notify():
        raise RuntimeError("private-redis-url-must-not-be-logged")

    with connect_project_changes(database, notify) as connection:
        connection.execute("INSERT INTO items VALUES (1)")
    with sqlite3.connect(database) as reader:
        assert reader.execute("SELECT id FROM items").fetchall() == [(1,)]
    assert "canonical state remains committed" in caplog.text
    assert "private-redis-url" not in caplog.text


def test_existing_scoped_view_shares_subscription_and_unsubscribe(tmp_path):
    from runtime.projectos.model import Project
    from runtime.projectos.store import ProjectStore
    from runtime.safety.auth.scope import TenantScope

    store = ProjectStore(tmp_path)
    scoped = store.with_scope(TenantScope("tenant-a", "alice"))
    seen = []
    unsubscribe = store.bind_commit_listener(lambda: seen.append("committed"))
    project = Project(id="project-a", name="A", goal="goal", owner_id="alice", tenant_id="tenant-a")
    scoped.save_project(project)
    assert seen == ["committed"]
    assert scoped.get_project(project.id).name == "A"
    assert seen == ["committed"]
    unsubscribe()
    unsubscribe()
    project.name = "B"
    scoped.save_project(project)
    assert scoped.get_project(project.id).name == "B"
    assert seen == ["committed"]


def test_failed_store_listener_does_not_prevent_later_listener_or_commit(tmp_path):
    from runtime.projectos.model import Project
    from runtime.projectos.store import ProjectStore

    store = ProjectStore(tmp_path)

    def fail():
        raise RuntimeError("listener failed")

    seen = []
    store.bind_commit_listener(fail)
    store.bind_commit_listener(lambda: seen.append(True))
    store.save_project(Project(id="project-a", name="A", goal="goal"))
    assert seen == [True]
    assert store.get_project("project-a").name == "A"
