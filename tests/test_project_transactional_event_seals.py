"""Transactional source changes must publish ordered, verifiable audit events."""

import sqlite3
import time

import pytest

from runtime.projectos.model import Milestone, Project, Task
from runtime.projectos.store import ProjectStore

CASES = ["plan", "task_orphan", "phase_orphan", "message", "unbind", "restore", "delete"]


def _operation(tmp_path, case):
    store = ProjectStore(tmp_path)
    store.save_project(Project(id="P", name="project", goal="goal", status="planning"))
    store.save_milestone("P", Milestone(id="M", name="phase", goal="goal", status="in_progress"))
    store.append_event("P", kind="before", payload={"position": "before"})
    if case == "plan":
        return (
            store,
            "Q",
            lambda: store.create_project_plan(
                Project(id="Q", name="new", goal="goal"),
                [Milestone(id="N", name="new phase", goal="goal")],
            ),
        )
    if case in {"task_orphan", "phase_orphan"}:
        project = store.get_project("P")
        project.status = "running"
        store.save_project(project)
        if case == "task_orphan":
            store.save_task(Task(id="T", milestone_id="M", type="code", goal="work"))
            assert store.claim_task("T")
            return (
                store,
                "P",
                lambda: store.orphan_stale_task_claims(
                    "P", stale_before=time.time() + 10, cause="process_restart"
                ),
            )
        assert store.claim_milestone_decomposition("M")
        return (
            store,
            "P",
            lambda: store.orphan_stale_milestone_claims(
                "P", stale_before=time.time() + 10, cause="process_restart"
            ),
        )
    if case == "delete":
        return (
            store,
            "P",
            lambda: store.begin_project_delete("P", event_kind="project.delete_pending"),
        )
    if case == "restore":
        store.save_project(Project(id="OTHER", name="other", goal="goal"))
        store.bind_thread("old-thread", "OTHER")
        return (
            store,
            "P",
            lambda: store.restore_thread_bindings(
                "P", ["old-thread"], original_execution_thread_id="old-thread"
            ),
        )
    _, generation = store.bind_thread_versioned("thread", "P")
    if case == "unbind":
        return (
            store,
            "P",
            lambda: store.unbind_thread_versioned(
                "thread", expected_project_id="P", event_kind="project.group_unbound"
            ),
        )
    return (
        store,
        "P",
        lambda: store.commit_message_action(
            "P",
            event_id="message-action",
            kind="project.task_added_from_message",
            payload={"task_id": "NEW"},
            expected_thread_id="thread",
            expected_binding_generation=generation,
            task=Task(id="NEW", milestone_id="M", type="code", goal="new work"),
        ),
    )


@pytest.mark.parametrize("case", CASES)
def test_transactional_events_follow_prior_events_and_are_sealed(tmp_path, case):
    store, project_id, operation = _operation(tmp_path, case)
    before = store.events_for_project(project_id)
    operation()
    if case != "delete":
        store.append_event(project_id, kind="after", payload={"position": "after"})
    events = store.events_for_project(project_id)
    assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
    assert events[: len(before)] == before
    decision = events[len(before)]
    assert decision["kind"] not in {"before", "after"}
    if case != "delete":
        assert events[-1]["kind"] == "after"
    result = store.verify_event_chain(project_id)
    assert result["ok"] and result["sealed_rows"] == len(events)
    assert result["unsealed_prefix"] == 0
    # A modified payload in the transactional event must now break verification.
    with store._lock, store._conn() as conn:
        if case == "delete":
            # The production delete fence correctly rejects new writes. This
            # forensic test simulates offline tampering after dropping that guard.
            triggers = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='project_events'"
            ).fetchall()
            for (name,) in triggers:
                conn.execute('DROP TRIGGER "' + name.replace('"', '""') + '"')
        conn.execute(
            "UPDATE project_events SET payload=? WHERE id=?",
            ('{"tampered": true}', decision["id"]),
        )
    assert store.verify_event_chain(project_id)["ok"] is False


@pytest.mark.parametrize("case", CASES)
def test_event_write_failure_rolls_back_claims_tasks_bindings_and_delete_lease(tmp_path, case):
    store, _, operation = _operation(tmp_path, case)
    with store._lock, store._conn() as conn:
        conn.execute(
            "CREATE TRIGGER fail_audit BEFORE INSERT ON project_events "
            "BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
        )
        before = tuple(conn.iterdump())
    with pytest.raises(sqlite3.IntegrityError, match="audit unavailable"):
        operation()
    with store._lock, store._conn() as conn:
        assert tuple(conn.iterdump()) == before


def test_message_retry_does_not_append_another_sealed_decision(tmp_path):
    store, project_id, operation = _operation(tmp_path, "message")
    first, task, inserted = operation()
    assert inserted and task.id == "NEW"
    before = store.events_for_project(project_id)
    replay, _, inserted = operation()
    assert not inserted and replay["id"] == first["id"]
    assert store.events_for_project(project_id) == before
    assert store.verify_event_chain(project_id)["sealed_rows"] == len(before)
