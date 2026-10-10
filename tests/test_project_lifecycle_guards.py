"""Project OS lifecycle guards.

Covers four correctness gaps:

1. task interventions only reach tasks of the addressed project;
2. a project can be cancelled (terminal, claims voided) and then deleted;
3. a restart releases execution claims left by the previous process;
4. the stub-hook CLI refuses to drive projects it did not plan.
"""

from __future__ import annotations

import time
from argparse import Namespace
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.cli_project import run_project_command
from runtime.projectos.engine import ProjectEngine
from runtime.projectos.model import PROJECT_ORIGIN_CLI, Milestone, Project, Task
from runtime.projectos.restart_sweep import (
    RESTART_CLAIM_CAUSE,
    RESTART_INTERRUPTED_KIND,
    sweep_projects_interrupted_by_restart,
)
from runtime.projectos.store import ProjectClaimActiveError, ProjectStore
from runtime.safety.approval.cancellation import OperationCancelled
from runtime.sensing.gateway.projects_router import create_projects_router


def _store(tmp_path: Path) -> ProjectStore:
    return ProjectStore(base_dir=tmp_path / "projectos")


def _seed(
    store: ProjectStore,
    prefix: str,
    *,
    project_status: str = "running",
    milestone_status: str = "in_progress",
    task_status: str = "pending",
) -> tuple[str, str, str]:
    project_id, milestone_id, task_id = f"P-{prefix}", f"{prefix}-M", f"{prefix}-T"
    store.save_project(
        Project(
            id=project_id,
            name=f"project {prefix}",
            goal="goal",
            milestone_ids=[milestone_id],
            current_ms=milestone_id,
            status=project_status,  # type: ignore[arg-type]
        )
    )
    store.save_milestone(
        project_id,
        Milestone(
            id=milestone_id,
            name="phase",
            goal="goal",
            status=milestone_status,  # type: ignore[arg-type]
            task_ids=[task_id],
        ),
    )
    store.save_task(
        Task(
            id=task_id,
            milestone_id=milestone_id,
            type="code",
            goal="work",
            status=task_status,  # type: ignore[arg-type]
            output="previous output" if task_status == "failed" else None,
        )
    )
    return project_id, milestone_id, task_id


def _engine(store: ProjectStore, **hooks: Any) -> ProjectEngine:
    return ProjectEngine(
        store,
        generate_milestones=hooks.pop("generate_milestones", lambda _goal: []),
        decompose_tasks=hooks.pop("decompose_tasks", lambda _milestone: []),
        **hooks,
    )


def _client(store: ProjectStore) -> TestClient:
    app = FastAPI()
    app.include_router(create_projects_router(store=store))
    return TestClient(app)


def _kinds(store: ProjectStore, project_id: str) -> list[str]:
    return [str(event["kind"]) for event in store.events_for_project(project_id)]


# ── 1. interventions are scoped to the addressed project ───────────────────


def _blocked_foreign_project(store: ProjectStore) -> tuple[str, str, str]:
    return _seed(
        store,
        "B",
        project_status="blocked",
        milestone_status="blocked",
        task_status="failed",
    )


@pytest.mark.parametrize("action", ["reset", "reassign", "complete", "skip"])
def test_intervention_cannot_reach_another_projects_task(tmp_path: Path, action: str) -> None:
    store = _store(tmp_path)
    project_a, milestone_a, _task_a = _seed(store, "A")
    project_b, milestone_b, task_b = _blocked_foreign_project(store)

    result = _engine(store).intervene_task(project_a, task_b, action=action, output="forged")

    assert result["events"] == [f"task_not_found:{task_b}"]
    foreign_task = store.get_task(task_b)
    assert foreign_task is not None
    assert foreign_task.status == "failed"
    assert foreign_task.output == "previous output"
    assert store.get_milestone(milestone_b).status == "blocked"
    assert store.get_project(project_b).status == "blocked"
    # A's pointer must never be redirected at B's phase.
    project = store.get_project(project_a)
    assert project.current_ms == milestone_a
    assert project.status == "running"
    rejected = store.events_for_project(project_a)[-1]
    assert rejected["kind"] == "task.intervention_rejected"
    assert rejected["payload"]["reason"] == "task_not_in_project"
    assert "task.intervention" not in _kinds(store, project_b)


def test_intervention_on_own_task_still_reopens_the_blocked_project(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_b, milestone_b, task_b = _blocked_foreign_project(store)

    result = _engine(store).intervene_task(project_b, task_b, action="reset")

    assert f"task_reset:{task_b}" in result["events"]
    assert result["project_status"] == "running"
    assert store.get_project(project_b).current_ms == milestone_b


def test_intervene_route_returns_404_for_another_projects_task(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_a, _milestone_a, _task_a = _seed(store, "A")
    _project_b, _milestone_b, task_b = _blocked_foreign_project(store)
    client = _client(store)

    response = client.post(
        f"/api/projects/{project_a}/tasks/{task_b}/intervene",
        json={"action": "reset"},
    )

    assert response.status_code == 404
    assert store.get_task(task_b).status == "failed"


def test_recover_rejects_task_ids_from_another_project(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_a, _milestone_a, task_a = _seed(
        store,
        "A",
        project_status="blocked",
        milestone_status="blocked",
        task_status="failed",
    )
    _project_b, _milestone_b, task_b = _blocked_foreign_project(store)

    with pytest.raises(ValueError, match="do not belong to this project"):
        _engine(store).recover(project_a, task_ids=[task_a, task_b])

    assert store.get_project(project_a).status == "blocked"
    assert store.get_task(task_a).status == "failed"
    assert store.get_task(task_b).status == "failed"
    response = _client(store).post(
        f"/api/projects/{project_a}/recover", json={"task_ids": [task_b]}
    )
    assert response.status_code == 400


# ── 2. cancel → terminal, claims voided, deletable ─────────────────────────


def test_blocked_project_can_be_cancelled_and_then_deleted(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_id, milestone_id, task_id = _seed(
        store,
        "A",
        project_status="blocked",
        milestone_status="blocked",
        task_status="failed",
    )
    with pytest.raises(Exception, match="active"):
        store.delete_project(project_id)

    result = _engine(store).cancel(project_id, reason="giving up", actor="owner-1")

    assert result["events"] == ["project_cancelled"]
    assert result["project_status"] == "failed"
    project = store.get_project(project_id)
    assert project.status == "failed"
    assert project.finished_at
    assert store.get_milestone(milestone_id).status == "failed"
    # Finished task records are history, not rewritten by a cancel.
    assert store.get_task(task_id).status == "failed"
    cancelled = store.events_for_project(project_id)[-1]
    assert cancelled["kind"] == "project.cancelled"
    assert cancelled["payload"]["previous_status"] == "blocked"
    assert cancelled["payload"]["reason"] == "giving up"
    assert cancelled["payload"]["actor"] == "owner-1"

    assert store.delete_project(project_id) is True
    assert store.get_project(project_id) is None


def test_cancel_voids_live_claims_and_stops_every_later_drive(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_id, milestone_id, task_id = _seed(store, "A")
    claimed = store.claim_task(task_id)
    assert claimed is not None
    running_task, claim_id = claimed
    with pytest.raises(ProjectClaimActiveError):
        store.assert_project_deletable(project_id)
    engine = _engine(store)

    result = engine.cancel(project_id)

    assert result["events"] == [f"task_claim_released:{task_id}", "project_cancelled"]
    task = store.get_task(task_id)
    assert task.status == "failed"
    assert task.qa_verdict["approved"] is False
    assert store.get_milestone(milestone_id).status == "failed"
    payload = store.events_for_project(project_id)[-1]["payload"]
    assert payload["released_task_claims"] == [task_id]
    assert payload["failed_tasks"] == [task_id]
    # The fenced worker can neither renew nor publish.
    assert not store.heartbeat_task_claim(task_id, claim_id, stale_before=0)
    running_task.status = "done"
    running_task.output = "late result"
    _current, committed = store.finalize_task_claim(running_task, claim_id)
    assert committed is False
    assert store.get_task(task_id).output is None
    # No drive path can revive the project.
    assert engine.tick(project_id)["events"] == ["project_not_runnable:failed"]
    assert engine.run(project_id)["final_status"] == "failed"
    assert store.claim_task(task_id) is None
    with pytest.raises(ValueError, match="已取消"):
        engine.recover(project_id)
    rejected = engine.intervene_task(project_id, task_id, action="reset")
    assert rejected["events"] == ["project_not_intervenable:failed"]
    assert store.get_task(task_id).status == "failed"
    assert store.assert_project_deletable(project_id).status == "failed"


def test_cancel_fences_an_in_flight_worker(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_id, _milestone_id, task_id = _seed(store, "A")
    entered, release = Event(), Event()

    def execute(_task: Task, _context: dict[str, Any]) -> str:
        entered.set()
        assert release.wait(timeout=5)
        return "late external result"

    qa_calls: list[str] = []

    def qa(task: Task, _milestone: Milestone) -> dict[str, Any]:
        qa_calls.append(task.id)
        return {"approved": True}

    worker = _engine(store, execute_task=execute, qa_task=qa)
    with ThreadPoolExecutor(max_workers=1) as pool:
        tick = pool.submit(worker.tick, project_id)
        assert entered.wait(timeout=5)
        try:
            cancelled = _engine(store).cancel(project_id)
        finally:
            release.set()
        # The worker loses its fencing token, exactly as when a project is
        # stopped under it: it cancels itself instead of publishing.
        with pytest.raises(OperationCancelled):
            tick.result(timeout=10)

    assert f"task_claim_released:{task_id}" in cancelled["events"]
    assert qa_calls == []
    task = store.get_task(task_id)
    assert task.status == "failed"
    assert task.output != "late external result"
    assert store.get_project(project_id).status == "failed"


def test_done_project_is_not_cancellable_and_cancel_is_idempotent(tmp_path: Path) -> None:
    store = _store(tmp_path)
    done_id, _milestone_id, _task_id = _seed(
        store, "D", project_status="done", milestone_status="done", task_status="done"
    )
    engine = _engine(store)

    rejected = engine.cancel(done_id)

    assert rejected["events"] == ["project_not_cancellable:done"]
    assert store.get_project(done_id).status == "done"
    assert _kinds(store, done_id)[-1] == "project.cancel_rejected"

    running_id, _milestone_id, _task_id = _seed(store, "R")
    assert engine.cancel(running_id)["events"] == ["project_cancelled"]
    events_before = _kinds(store, running_id)
    assert engine.cancel(running_id)["events"] == ["project_already_cancelled"]
    assert _kinds(store, running_id) == events_before


def test_cancel_route_unblocks_delete_with_clear_conflict_reasons(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_id, _milestone_id, _task_id = _seed(
        store,
        "A",
        project_status="blocked",
        milestone_status="blocked",
        task_status="failed",
    )
    client = _client(store)

    refused = client.delete(f"/api/projects/{project_id}")
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["code"] == "PROJECT_ACTIVE"
    assert detail["reason"] == "project_blocked"
    assert detail["status"] == "blocked"
    assert "cancel it first" in detail["message"]
    assert detail["cancel_required"] is True
    assert detail["cancel"] == {"method": "POST", "path": f"/api/projects/{project_id}/cancel"}

    cancelled = client.post(f"/api/projects/{project_id}/cancel", json={"reason": "stop"})
    assert cancelled.status_code == 200, cancelled.json()
    body = cancelled.json()
    assert body["cancel"]["events"] == ["project_cancelled"]
    assert body["project"]["status"] == "failed"
    assert body["available_actions"] == ["inspect"]

    intervene = client.post(
        f"/api/projects/{project_id}/tasks/A-T/intervene", json={"action": "reset"}
    )
    assert intervene.status_code == 409
    assert intervene.json()["detail"]["code"] == "PROJECT_CANCELLED"

    deleted = client.delete(f"/api/projects/{project_id}")
    assert deleted.status_code == 200, deleted.json()
    assert client.get(f"/api/projects/{project_id}").status_code == 404


def test_cancel_route_rejects_done_and_unknown_projects(tmp_path: Path) -> None:
    store = _store(tmp_path)
    done_id, _milestone_id, _task_id = _seed(
        store, "D", project_status="done", milestone_status="done", task_status="done"
    )
    client = _client(store)

    done = client.post(f"/api/projects/{done_id}/cancel")
    assert done.status_code == 409
    assert done.json()["detail"]["code"] == "PROJECT_NOT_CANCELLABLE"
    assert client.post("/api/projects/P-missing/cancel").status_code == 404


def test_delete_with_live_claim_explains_how_to_unblock(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_id, _milestone_id, task_id = _seed(store, "A")
    assert store.claim_task(task_id) is not None

    refused = _client(store).delete(f"/api/projects/{project_id}")

    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["code"] == "CLAIM_ACTIVE"
    assert detail["task_ids"] == [task_id]
    assert detail["cancel_required"] is True
    assert "cancel the project" in detail["message"]


# ── 3. restart releases claims left by the previous process ────────────────


def test_restart_sweep_releases_previous_process_claims_for_immediate_recover(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    project_id, milestone_id, task_id = _seed(store, "A")
    assert store.claim_task(task_id) is not None
    decomposing_id = "P-decompose"
    store.save_project(
        Project(
            id=decomposing_id,
            name="decompose",
            goal="goal",
            milestone_ids=["X-M"],
            current_ms="X-M",
            status="running",
        )
    )
    store.save_milestone(
        decomposing_id, Milestone(id="X-M", name="phase", goal="goal", status="active")
    )
    assert store.claim_milestone_decomposition("X-M") is not None
    # The previous process is gone: it can no longer renew its claims.
    started_at = time.time() + 1

    # A restarted process must not wait out the claim TTL before recovering.
    restarted = ProjectStore(base_dir=tmp_path / "projectos")
    with pytest.raises(ProjectClaimActiveError):
        _engine(restarted).recover(project_id)

    marked = sweep_projects_interrupted_by_restart(restarted, started_at=started_at)

    by_id = {item["project_id"]: item for item in marked}
    assert by_id[project_id]["orphaned_task_ids"] == [task_id]
    assert by_id[decomposing_id]["orphaned_milestone_ids"] == ["X-M"]
    task = restarted.get_task(task_id)
    assert task.status == "blocked"
    assert "previous process" in task.qa_verdict["reason"]
    assert restarted.get_milestone(milestone_id).status == "blocked"
    assert restarted.get_project(project_id).status == "blocked"
    orphaned = next(
        event
        for event in restarted.events_for_project(project_id)
        if event["kind"] == "task.claim_orphaned"
    )
    assert orphaned["payload"]["cause"] == RESTART_CLAIM_CAUSE
    marker = next(
        event
        for event in restarted.events_for_project(project_id)
        if event["kind"] == RESTART_INTERRUPTED_KIND
    )
    assert marker["payload"]["resumed"] is False
    assert marker["payload"]["recovery_required"] is True
    assert restarted.get_milestone("X-M").status == "blocked"

    # Recovery is available at once, and only an explicit drive re-executes.
    executed: list[str] = []
    engine = _engine(
        restarted,
        execute_task=lambda task, _ctx: executed.append(task.id) or "redo",
        qa_task=lambda *_: {"approved": True},
    )
    recovered = engine.recover(project_id)
    assert recovered["project_status"] == "running"
    assert f"task_recovered:{task_id}" in recovered["events"]
    assert executed == []
    engine.tick(project_id)
    assert executed == [task_id]


def test_restart_sweep_keeps_claims_renewed_after_service_start(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_id, _milestone_id, task_id = _seed(store, "A")
    started_at = time.time() - 60
    assert store.claim_task(task_id) is not None

    marked = sweep_projects_interrupted_by_restart(store, started_at=started_at)

    assert marked[0]["orphaned_task_ids"] == []
    assert store.get_task(task_id).status == "running"
    assert store.get_project(project_id).status == "running"
    with pytest.raises(ProjectClaimActiveError):
        store.assert_no_active_claims(project_id)


# ── 4. the stub-hook CLI only drives projects it planned ───────────────────


def _cli_args(**overrides: Any) -> Namespace:
    values = {
        "project_op": "run",
        "id": None,
        "goal": None,
        "name": "",
        "max_ticks": 20,
        "allow_stub_hooks": False,
        "no_color": True,
    }
    values.update(overrides)
    return Namespace(**values)


@pytest.fixture
def cli_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ProjectStore:
    store = _store(tmp_path)
    monkeypatch.setattr("runtime.cli_project.ProjectStore", lambda: store)
    return store


def test_cli_refuses_to_drive_an_app_project_with_stub_hooks(
    cli_store: ProjectStore, capsys: pytest.CaptureFixture[str]
) -> None:
    from runtime.projectos.engine import stub_decompose_tasks, stub_generate_milestones

    app_project = _engine(
        cli_store,
        generate_milestones=stub_generate_milestones,
        decompose_tasks=stub_decompose_tasks,
    ).plan("real", "a real goal planned in the app")
    assert app_project.origin == ""

    code = run_project_command(_cli_args(id=app_project.id), color=False)

    assert code == 2
    assert "refusing to run" in capsys.readouterr().err
    assert cli_store.get_project(app_project.id).status == "running"
    assert all(not cli_store.tasks_for_milestone(m) for m in app_project.milestone_ids)

    forced = run_project_command(_cli_args(id=app_project.id, allow_stub_hooks=True), color=False)

    assert forced == 0
    assert "WARNING" in capsys.readouterr().err
    assert cli_store.get_project(app_project.id).status == "done"


def test_cli_still_drives_the_projects_it_planned(
    cli_store: ProjectStore, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_project_command(_cli_args(project_op="plan", goal="offline demo"), color=False) == 0
    (planned,) = cli_store.list_projects()
    assert planned.origin == PROJECT_ORIGIN_CLI

    assert run_project_command(_cli_args(id=planned.id), color=False) == 0
    assert run_project_command(_cli_args(goal="plan and run"), color=False) == 0

    assert "refusing" not in capsys.readouterr().err
    assert {project.status for project in cli_store.list_projects()} == {"done"}


def test_project_origin_is_fixed_at_creation(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project_id, _milestone_id, _task_id = _seed(store, "A")
    project = store.get_project(project_id)
    project.origin = PROJECT_ORIGIN_CLI

    assert store.save_project(project).origin == ""
    assert store.get_project(project_id).origin == ""
    assert Project.from_dict({"id": "P", "origin": "forged"}).origin == ""
