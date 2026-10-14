import time
from threading import Event

import pytest

from runtime.projectos.engine import ProjectEngine
from runtime.projectos.model import Milestone, Project, Task
from runtime.projectos.store import ProjectStore
from runtime.safety.approval.cancellation import OperationCancelled, current_cancellation_token


def setup_project(tmp_path):
    store = ProjectStore(base_dir=tmp_path)
    project = store.save_project(
        Project(
            id="P",
            name="project",
            goal="test",
            status="running",
            current_ms="M",
            milestone_ids=["M"],
        )
    )
    milestone = store.save_milestone(
        "P", Milestone(id="M", name="phase", goal="test", status="in_progress", task_ids=["T"])
    )
    store.save_task(Task(id="T", milestone_id="M", type="code", goal="work"))
    return store, project, milestone


def engine(store, execute, qa=lambda *_: {"approved": True}):
    return ProjectEngine(
        store,
        generate_milestones=lambda _: [],
        decompose_tasks=lambda _: [],
        execute_task=execute,
        qa_task=qa,
        task_claim_timeout_seconds=1,
    )


def test_live_execution_and_qa_renew_claim(tmp_path, monkeypatch):
    store, project, milestone = setup_project(tmp_path)
    renewed = Event()
    real = store.heartbeat_task_claim
    started = Event()

    def heartbeat(*args, **kwargs):
        valid = real(*args, **kwargs)
        if started.is_set():
            renewed.set()
        return valid

    monkeypatch.setattr(store, "heartbeat_task_claim", heartbeat)

    def wait_for_renewal():
        renewed.clear()
        started.set()
        before = time.time()
        assert renewed.wait(3)
        assert store.orphan_stale_task_claims("P", stale_before=before) == []
        assert store.get_task("T").status == "running"

    def execute(*_):
        wait_for_renewal()
        return "output"

    def qa(*_):
        wait_for_renewal()
        return {"approved": True}

    engine(store, execute, qa)._run_frontier(project, milestone, [])
    assert store.get_task("T").status == "done"


@pytest.mark.parametrize("during_qa", [False, True])
def test_stopped_project_discards_output_even_before_next_heartbeat(tmp_path, during_qa):
    store, project, milestone = setup_project(tmp_path)
    qa_calls = []

    def stop():
        current = store.get_project("P")
        current.status = "blocked"
        store.save_project(current)

    def execute(*_):
        if not during_qa:
            stop()
        return "late output"

    def qa(*_):
        qa_calls.append(True)
        stop()
        return {"approved": True}

    events = []
    if during_qa:
        engine(store, execute, qa)._run_frontier(project, milestone, events)
    else:
        with pytest.raises(OperationCancelled):
            engine(store, execute, qa)._run_frontier(project, milestone, events)
    current = store.get_task("T")
    assert current.status == "blocked"
    assert current.output is None
    assert not current.qa_verdict["approved"]
    assert len(qa_calls) == int(during_qa)
    assert "task_done:T" not in events


def test_store_rejects_expired_renewal_and_completion_without_sweeper(tmp_path):
    store, _, _ = setup_project(tmp_path)
    task, claim_id = store.claim_task("T")
    with store._lock, store._conn() as conn:
        conn.execute("UPDATE task_claims SET claimed_at=0")
    assert not store.heartbeat_task_claim("T", claim_id, stale_before=time.time() - 1)
    task.status = "done"
    task.output = "expired"
    assert not store.finalize_task_claim(task, claim_id, stale_before=time.time() - 1)[1]
    assert store.get_task("T").output is None
    assert len(store.orphan_stale_task_claims("P", stale_before=time.time() - 1)) == 1


def test_obsolete_claim_cannot_renew_or_publish(tmp_path):
    store, _, _ = setup_project(tmp_path)
    old, old_id = store.claim_task("T")
    old.status = "pending"
    assert store.finalize_task_claim(old, old_id)[1]
    new, new_id = store.claim_task("T")
    assert not store.heartbeat_task_claim("T", old_id, stale_before=0)
    old.status = "done"
    old.output = "obsolete"
    assert not store.finalize_task_claim(old, old_id)[1]
    assert store.heartbeat_task_claim("T", new_id, stale_before=0)
    new.status = "done"
    new.output = "replacement"
    assert store.finalize_task_claim(new, new_id)[1]


def test_expiry_during_qa_cannot_publish_before_next_heartbeat(tmp_path):
    store, project, milestone = setup_project(tmp_path)

    def qa(*_):
        with store._lock, store._conn() as conn:
            conn.execute("UPDATE task_claims SET claimed_at=0")
        return {"approved": True}

    events = []
    engine(store, lambda *_: "expired output", qa)._run_frontier(project, milestone, events)
    assert store.get_task("T").output is None
    assert "task_stale_result_ignored:T" in events
    assert "task_done:T" not in events


def test_heartbeat_cannot_cross_tenant_scope(tmp_path):
    from runtime.safety.auth.scope import TenantScope

    store, project, _ = setup_project(tmp_path)
    project.owner_id = "alice"
    project.tenant_id = "team-a"
    store.save_project(project)
    _, claim_id = store.claim_task("T")
    other = store.with_scope(TenantScope(tenant_id="team-b", actor_id="alice"))
    with pytest.raises(PermissionError):
        other.heartbeat_task_claim("T", claim_id, stale_before=0)
    assert store.heartbeat_task_claim("T", claim_id, stale_before=0)


def test_heartbeat_storage_failure_stops_live_executor(tmp_path, monkeypatch):
    store, project, milestone = setup_project(tmp_path)
    real = store.heartbeat_task_claim
    running = Event()
    cancelled = Event()

    def heartbeat(*args, **kwargs):
        if running.is_set():
            raise OSError("database unavailable")
        return real(*args, **kwargs)

    monkeypatch.setattr(store, "heartbeat_task_claim", heartbeat)

    def execute(*_):
        unlink = current_cancellation_token().on_cancelled(lambda _: cancelled.set())
        try:
            running.set()
            assert cancelled.wait(3)
            return "late output"
        finally:
            unlink()

    with pytest.raises(OperationCancelled):
        engine(store, execute, lambda *_: pytest.fail("QA ran after loss"))._run_frontier(
            project, milestone, []
        )
    assert store.get_task("T").status == "blocked"
    assert store.get_task("T").output is None
