"""A new backend must distinguish a live executor from a crashed process."""

from __future__ import annotations

import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from multiprocessing import get_context
from pathlib import Path

import pytest

from runtime.platform.io.sqlite_schema import migrate
from runtime.platform.process.task_supervisor import TaskSupervisor
from runtime.projectos._claim_process import claim_owner_alive, current_claim_owner
from runtime.projectos._store_schema import _MIGRATIONS
from runtime.projectos.engine import ProjectEngine
from runtime.projectos.http_dispatcher import ProjectHTTPDispatcher
from runtime.projectos.model import Milestone, Project, Task
from runtime.projectos.restart_sweep import sweep_projects_interrupted_by_restart
from runtime.projectos.store import ProjectStore


def _claim_and_wait(base_dir, ready, stopped, via_http=False):
    store = ProjectStore(base_dir)

    def work():
        task = store.claim_task("T")
        phase = store.claim_milestone_decomposition("D")
        ready.put((task[1], phase[1]))
        stopped.wait(30)
        return {}

    if via_http:
        dispatcher = ProjectHTTPDispatcher(TaskSupervisor.from_path(Path(base_dir) / "jobs.json"))
        dispatcher.submit(store.get_project("P"), work)
        stopped.wait(30)
        dispatcher.close()
    else:
        work()


@contextmanager
def _claimed_process(tmp_path, *, via_http=False):
    context = get_context("spawn")
    ready, stopped = context.Queue(), context.Event()
    process = context.Process(
        target=_claim_and_wait, args=(str(tmp_path), ready, stopped, via_http)
    )
    try:
        process.start()
        claims = ready.get(timeout=15)
        assert process.is_alive()
        yield process, claims
    finally:
        if process.pid is not None:
            if process.is_alive():
                # A killed process can leave the multiprocessing Event's
                # condition counters locked. Never signal that dead waiter.
                stopped.set()
            process.join(5)
            if process.is_alive():
                process.terminate()
                process.join(5)
        ready.close()
        ready.join_thread()


def _seed(tmp_path):
    store = ProjectStore(tmp_path)
    store.save_project(
        Project(
            id="P",
            name="project",
            goal="goal",
            status="running",
            current_ms="M",
            milestone_ids=["M", "D"],
        )
    )
    store.save_milestone(
        "P", Milestone(id="M", name="task phase", goal="goal", status="in_progress")
    )
    store.save_milestone(
        "P", Milestone(id="D", name="planning phase", goal="goal", status="active")
    )
    store.save_task(Task(id="T", milestone_id="M", type="code", goal="work"))
    return store


def test_starting_another_backend_does_not_orphan_real_live_executor(tmp_path):
    store = _seed(tmp_path)
    with _claimed_process(tmp_path) as (_process, (task_claim, phase_claim)):
        restarted = ProjectStore(tmp_path)
        assert sweep_projects_interrupted_by_restart(restarted) == []
        assert restarted.get_task("T").status == "running"
        assert restarted.get_milestone("D").status == "active"
        assert store.heartbeat_task_claim("T", task_claim, stale_before=0)
        assert store.finalize_milestone_decomposition(
            "P", "D", [Task(id="DT", milestone_id="D", type="code", goal="work")], phase_claim
        )[1]


@pytest.mark.parametrize("via_http", [False, True])
def test_confirmed_process_death_fences_both_claims_before_expiry_without_rerunning(
    tmp_path, via_http
):
    if claim_owner_alive(current_claim_owner()) is not True:
        pytest.skip("native creation identity unavailable; this platform uses lease expiry")
    store = _seed(tmp_path)
    with _claimed_process(tmp_path, via_http=via_http) as (process, (task_claim, phase_claim)):
        old_task = store.get_task("T")
        supervisor = TaskSupervisor.from_path(tmp_path / "jobs.json") if via_http else None
        if supervisor:
            job = supervisor.store.get(ProjectHTTPDispatcher.task_id(store.get_project("P")))
            assert not job.lease.expired
            assert claim_owner_alive(job.metadata["process_owner"]) is True
        process.terminate()
        process.join(5)
        assert not process.is_alive()
        if supervisor:
            viewer = ProjectHTTPDispatcher(supervisor)
            try:
                state = viewer.state(store.get_project("P"))
                assert state["status"] == "interrupted"
                assert state["can_takeover"] is False
            finally:
                viewer.close()
        restarted = ProjectStore(tmp_path)
        marked = sweep_projects_interrupted_by_restart(restarted, task_supervisor=supervisor)
        assert len(marked) == 1
        assert marked[0]["orphaned_task_ids"] == ["T"]
        assert marked[0]["orphaned_milestone_ids"] == ["D"]
        assert restarted.get_project("P").status == "blocked"
        assert restarted.get_task("T").status == "blocked"
        before = restarted.events_for_project("P")
        assert before[-1]["payload"]["resumed"] is False
        assert sweep_projects_interrupted_by_restart(restarted, task_supervisor=supervisor) == []
        assert restarted.events_for_project("P") == before
        old_task.status, old_task.output = "done", "late dead-generation output"
        assert not store.finalize_task_claim(old_task, task_claim)[1]
        assert not store.finalize_milestone_decomposition(
            "P", "D", [Task(id="LATE", milestone_id="D", type="code", goal="late")], phase_claim
        )[1]
        assert store.get_task("T").output is None and store.get_task("LATE") is None
        executed = []
        engine = ProjectEngine(
            restarted,
            generate_milestones=lambda _: [],
            decompose_tasks=lambda _: [],
            execute_task=lambda task, _ctx: executed.append(task.id) or "fresh output",
            qa_task=lambda *_: {"approved": True},
        )
        assert engine.recover("P")["project_status"] == "running"
        assert executed == []
        engine._run_frontier(restarted.get_project("P"), restarted.get_milestone("M"), [])
        assert executed == ["T"] and restarted.get_task("T").status == "done"
        assert restarted.verify_event_chain("P")["ok"]


@pytest.mark.parametrize("owner", ["", "{", "[]", '{"namespace":"foreign","pid":1,"stamp":"x"}'])
def test_unknown_or_foreign_owner_is_preserved_until_its_recorded_lease_expires(tmp_path, owner):
    store = _seed(tmp_path)
    assert store.claim_task("T", lease_seconds=600)
    with store._lock, store._conn() as conn:
        conn.execute("UPDATE task_claims SET process_owner=?", (owner,))
    assert sweep_projects_interrupted_by_restart(store) == []
    assert store.get_task("T").status == "running"
    with store._lock, store._conn() as conn:
        conn.execute("UPDATE task_claims SET claimed_at=?", (time.time() - 601,))
    marked = sweep_projects_interrupted_by_restart(store)
    assert marked[0]["orphaned_task_ids"] == ["T"]
    assert store.get_task("T").status == "blocked"


def test_pid_reuse_does_not_make_a_dead_generation_look_alive(tmp_path):
    if claim_owner_alive(current_claim_owner()) is not True:
        pytest.skip("native creation identity unavailable")
    store = _seed(tmp_path)
    assert store.claim_task("T")
    owner = json.loads(current_claim_owner())
    owner["stamp"] += "-previous-generation"
    with store._lock, store._conn() as conn:
        conn.execute("UPDATE task_claims SET process_owner=?", (json.dumps(owner),))
    assert claim_owner_alive(json.dumps(owner)) is False
    assert sweep_projects_interrupted_by_restart(store)[0]["orphaned_task_ids"] == ["T"]


@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan"), True])
@pytest.mark.parametrize("phase", [False, True])
def test_invalid_lease_cannot_claim_or_consume_an_attempt(tmp_path, value, phase):
    store = _seed(tmp_path)
    with pytest.raises(ValueError, match="lease"):
        if phase:
            store.claim_milestone_decomposition("D", lease_seconds=value)
        else:
            store.claim_task("T", lease_seconds=value)
    assert store.get_task("T").status == "pending" and store.get_task("T").attempts == 0
    store.assert_no_active_claims("P")


def test_engine_records_its_configured_task_and_decomposition_lease(tmp_path):
    store = _seed(tmp_path)
    recorded = []

    def decompose(_phase):
        with store._conn() as conn:
            recorded.append(
                conn.execute("SELECT lease_seconds FROM milestone_claims").fetchone()[0]
            )
        return [Task(id="DT", milestone_id="D", type="code", goal="work")]

    def execute(_task, _context):
        with store._conn() as conn:
            recorded.append(conn.execute("SELECT lease_seconds FROM task_claims").fetchone()[0])
        return "output"

    engine = ProjectEngine(
        store,
        generate_milestones=lambda _: [],
        decompose_tasks=decompose,
        execute_task=execute,
        qa_task=lambda *_: {"approved": True},
        task_claim_timeout_seconds=1.5,
    )
    engine._ensure_tasks("P", store.get_milestone("D"), [])
    engine._run_frontier(store.get_project("P"), store.get_milestone("M"), [])
    assert recorded == [1.5, 1.5]


def test_v2_migration_preserves_legacy_claim_and_output_until_expiry(tmp_path):
    with closing(sqlite3.connect(tmp_path / "projectos.db")) as conn:
        migrate(conn, _MIGRATIONS[:2], name="projectos")
        project = Project(id="P", name="old", goal="goal", status="running", current_ms="M")
        phase = Milestone(id="M", name="old phase", goal="goal", status="in_progress")
        task = Task(
            id="T",
            milestone_id="M",
            type="code",
            goal="work",
            status="running",
            output="prior artifact",
        )
        conn.execute("INSERT INTO projects VALUES (?, ?)", ("P", json.dumps(project.to_dict())))
        conn.execute(
            "INSERT INTO milestones VALUES (?, ?, ?)", ("M", "P", json.dumps(phase.to_dict()))
        )
        conn.execute("INSERT INTO tasks VALUES (?, ?, ?)", ("T", "M", json.dumps(task.to_dict())))
        conn.execute("INSERT INTO task_claims VALUES (?, ?, ?)", ("T", "legacy-claim", time.time()))
        conn.commit()
    store = ProjectStore(tmp_path)
    with store._conn() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
        assert conn.execute(
            "SELECT claim_id, process_owner, lease_seconds FROM task_claims"
        ).fetchone() == ("legacy-claim", "", 3600)
    assert sweep_projects_interrupted_by_restart(store) == []
    assert store.get_task("T").output == "prior artifact"
    with store._lock, store._conn() as conn:
        conn.execute("UPDATE task_claims SET claimed_at=0")
    assert sweep_projects_interrupted_by_restart(store)[0]["orphaned_task_ids"] == ["T"]
    assert (
        store.get_task("T").status == "blocked" and store.get_task("T").output == "prior artifact"
    )


def test_unavailable_native_probe_does_not_claim_a_live_executor_is_dead(tmp_path, monkeypatch):
    store = _seed(tmp_path)
    assert store.claim_task("T")
    monkeypatch.setattr("runtime.projectos._claim_process._process_stamp", lambda _pid: None)
    assert sweep_projects_interrupted_by_restart(store) == []
    assert store.get_task("T").status == "running"


def test_concurrent_startup_workers_record_one_sealed_marker(tmp_path):
    store = _seed(tmp_path)

    def sweep(_index):
        return sweep_projects_interrupted_by_restart(ProjectStore(tmp_path))

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(sweep, range(8)))
    assert sum(len(result) for result in results) == 1
    assert store.verify_event_chain("P")["sealed_rows"] == 1


def test_restart_marker_survives_the_default_event_window(tmp_path):
    store = _seed(tmp_path)
    assert sweep_projects_interrupted_by_restart(store)
    for index in range(505):
        store.append_event("P", kind="unrelated", payload={"index": index})
    assert sweep_projects_interrupted_by_restart(store) == []
    assert store.verify_event_chain("P")["sealed_rows"] == 506


def test_marker_does_not_cross_a_claim_acquired_during_the_sweep(tmp_path, monkeypatch):
    store = _seed(tmp_path)

    def acquire_after_scan(*_args):
        assert store.claim_task("T")
        return [], []

    monkeypatch.setattr(
        "runtime.projectos.restart_sweep._release_previous_process_claims", acquire_after_scan
    )
    assert sweep_projects_interrupted_by_restart(store) == []
    assert store.get_task("T").status == "running"
    assert store.events_for_project("P") == []
