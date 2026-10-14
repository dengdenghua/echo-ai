"""Projects created on the project page / REST are governed like chat initiation.

Initiation approval before any run, phase authorization before each phase,
the AI budget cap, and owner acceptance of every delivery — recorded with the
same events chat writes, and executed by the group's members.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.service import invite_member
from runtime.projectos.engine import ProjectEngine
from runtime.projectos.governance import (
    governed_milestone_spec,
    initiation_state,
    phase_authorized,
)
from runtime.projectos.group_execution import (
    engine_for_group,
    ensure_project_for_thread,
    run_project_from_group,
)
from runtime.projectos.model import (
    PROJECT_ORIGIN_APP,
    PROJECT_ORIGIN_CHAT,
    Milestone,
    Project,
    Task,
)
from runtime.projectos.store import ProjectStore
from tests.project_governance_utils import owner_decides, owner_decides_via_api
from tests.test_project_group_creation import _create_body, _stack


def _kinds(store: ProjectStore, project_id: str) -> list[str]:
    return [str(event["kind"]) for event in store.events_for_project(project_id)]


def _create(client: Any, **overrides: Any) -> dict[str, Any]:
    response = client.post("/api/projects/group", json={**_create_body(), **overrides})
    assert response.status_code == 200, response.json()
    return response.json()


# ── creation: governed and pending ─────────────────────────────────────────


def test_project_page_creation_is_governed_and_waits_for_initiation(tmp_path: Path) -> None:
    client, projects, _groups, _collaboration, _threads, _rooms = _stack(tmp_path)

    created = _create(client, aiBudgetUsd=5)

    project_id = created["project"]["id"]
    assert created["project"]["origin"] == PROJECT_ORIGIN_APP
    for milestone in created["milestones"]:
        assert milestone["spec"] == {
            "requires_owner_acceptance": True,
            "phase_agents": ["eve", "kane"],
            "ai_budget_usd": 5.0,
        }
    governance = created["governance"]
    assert governance["initiation"]["state"] == "pending"
    assert governance["blocked_reason"] == "initiation"

    for path, body in ((f"/api/projects/{project_id}/run", {"max_ticks": 5}),):
        refused = client.post(path, json=body)
        assert refused.status_code == 409
        assert refused.json()["detail"]["code"] == "INITIATION_APPROVAL_REQUIRED"
    assert client.post(f"/api/projects/{project_id}/tick").status_code == 409

    # The engine itself refuses too, before the execution boundary: nothing
    # starts, so the unapproved project stays deletable.
    engine = ProjectEngine(
        projects, generate_milestones=lambda _goal: [], decompose_tasks=lambda _ms: []
    )
    assert engine.tick(project_id)["events"] == ["awaiting_initiation_approval"]
    assert projects.get_project(project_id).started_at == ""
    assert all(not projects.tasks_for_milestone(ms) for ms in created["project"]["milestone_ids"])
    assert projects.assert_project_deletable(project_id).id == project_id


def test_full_owner_flow_runs_on_group_members(tmp_path: Path) -> None:
    client, projects, _groups, _collaboration, _threads, _rooms = _stack(tmp_path)
    created = _create(client)
    project_id = created["project"]["id"]
    initiation = created["governance"]["initiation"]

    stale = client.post(
        f"/api/projects/{project_id}/initiation/approve",
        json={"expected_fingerprint": "not-what-the-owner-saw"},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "PLAN_CHANGED"
    approved = client.post(
        f"/api/projects/{project_id}/initiation/approve",
        json={"expected_fingerprint": initiation["fingerprint"]},
    )
    assert approved.status_code == 200, approved.json()
    governance = approved.json()["governance"]
    assert governance["initiation"]["state"] == "approved"
    assert governance["blocked_reason"] == "phase_authorization"
    assert "project.initiation_approved" in _kinds(projects, project_id)

    # Approval alone executes nothing; the phase is authorized separately.
    waiting = client.post(f"/api/projects/{project_id}/run", json={"max_ticks": 5}).json()
    assert any(
        event.startswith("awaiting_phase_authorization:")
        for tick in waiting["history"]
        for event in tick["events"]
    )
    phase = governance["phase"]
    later = created["project"]["milestone_ids"][-1]
    wrong = client.post(
        f"/api/projects/{project_id}/phases/{later}/authorize",
        json={"expected_fingerprint": phase["fingerprint"]},
    )
    assert wrong.status_code == 409
    assert wrong.json()["detail"]["code"] == "PHASE_NOT_CURRENT"
    authorized = client.post(
        f"/api/projects/{project_id}/phases/{phase['milestone_id']}/authorize",
        json={"expected_fingerprint": phase["fingerprint"]},
    )
    assert authorized.status_code == 200, authorized.json()
    event = projects.events_for_project(project_id)[-1]
    assert event["kind"] == "project.phase_authorized"
    assert event["payload"]["agents"] == ["eve", "kane"]

    ran = client.post(f"/api/projects/{project_id}/run", json={"max_ticks": 10}).json()
    assert ran["final_status"] == "running"
    state = client.get(f"/api/projects/{project_id}").json()
    first_tasks = state["tasks"][phase["milestone_id"]]
    assert first_tasks and {task["assigned_agent"] for task in first_tasks} <= {"eve", "kane"}
    assert all(task["status"] == "done" for task in first_tasks)
    # The delivery waits for the owner, exactly as the chat acceptance gate.
    assert state["governance"]["blocked_reason"] == "owner_acceptance"
    pending = state["governance"]["acceptance"][0]
    assert pending["milestone_id"] == phase["milestone_id"]
    assert projects.get_milestone(phase["milestone_id"]).status != "done"
    rejected = client.post(
        f"/api/projects/{project_id}/milestones/{phase['milestone_id']}/accept",
        json={"expected_fingerprint": "stale"},
    )
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "DELIVERY_CHANGED"
    accepted = client.post(
        f"/api/projects/{project_id}/milestones/{phase['milestone_id']}/accept",
        json={"expected_fingerprint": pending["fingerprint"]},
    )
    assert accepted.status_code == 200, accepted.json()
    assert projects.events_for_project(project_id)[-1]["kind"] == "project.delivery_accepted"

    advanced = client.post(f"/api/projects/{project_id}/run", json={"max_ticks": 10}).json()
    assert projects.get_milestone(phase["milestone_id"]).status == "done"
    assert any(
        event.startswith("awaiting_phase_authorization:")
        for tick in advanced["history"]
        for event in tick["events"]
    )


def test_budget_cap_pauses_a_rest_project_like_chat(tmp_path: Path) -> None:
    client, projects, _groups, _collaboration, _threads, _rooms = _stack(tmp_path)
    created = _create(client, aiBudgetUsd=0)
    project_id = created["project"]["id"]
    owner_decides_via_api(client, project_id)

    ran = client.post(f"/api/projects/{project_id}/run", json={"max_ticks": 5}).json()

    first = created["project"]["milestone_ids"][0]
    assert ran["history"][-1]["events"] == [f"project_budget_paused:{first}"]
    assert all(not projects.tasks_for_milestone(ms) for ms in created["project"]["milestone_ids"])
    state = client.get(f"/api/projects/{project_id}").json()
    assert state["governance"]["blocked_reason"] == "budget"
    assert state["governance"]["phase"]["budget"]["reason"] == "limit_reached"

    stale = client.post(
        f"/api/projects/{project_id}/budget",
        json={"ai_budget_usd": 10, "expected_fingerprint": "stale"},
    )
    assert stale.status_code == 409
    raised = client.post(
        f"/api/projects/{project_id}/budget",
        json={"ai_budget_usd": 10, "expected_fingerprint": state["governance"]["plan_fingerprint"]},
    )
    assert raised.status_code == 200, raised.json()
    event = projects.events_for_project(project_id)[-1]
    assert event["kind"] == "project.budget_changed"
    assert event["payload"]["cap_usd"] == 10
    # Like ``/project budget``: the phase changed, so it is authorized again.
    assert raised.json()["governance"]["blocked_reason"] == "phase_authorization"


# ── fail-closed governance ─────────────────────────────────────────────────


def _project_with_phase(store: ProjectStore, *, origin: str, spec: dict[str, Any]) -> Milestone:
    store.save_project(
        Project(
            id="P-gov",
            name="governed",
            goal="g",
            milestone_ids=["M-gov"],
            current_ms="M-gov",
            status="running",
            origin=origin,
        )
    )
    return store.save_milestone(
        "P-gov", Milestone(id="M-gov", name="phase", goal="g", status="active", spec=spec)
    )


def test_governed_phase_without_members_is_never_authorized(tmp_path: Path) -> None:
    store = ProjectStore(base_dir=tmp_path)
    phase = _project_with_phase(store, origin=PROJECT_ORIGIN_APP, spec={})
    assert phase_authorized(store, "P-gov", phase) is False
    phase.spec = {"phase_agents": []}
    assert phase_authorized(store, "P-gov", phase) is False


def test_legacy_phase_without_governance_still_runs_ungoverned(tmp_path: Path) -> None:
    store = ProjectStore(base_dir=tmp_path)
    phase = _project_with_phase(store, origin="", spec={})
    assert phase_authorized(store, "P-gov", phase) is True
    assert initiation_state(store, store.get_project("P-gov")) == "legacy"


def test_chat_initiated_projects_are_approved_by_their_chat_approval(tmp_path: Path) -> None:
    store = ProjectStore(base_dir=tmp_path)
    _project_with_phase(store, origin=PROJECT_ORIGIN_CHAT, spec=governed_milestone_spec(["a"]))
    assert initiation_state(store, store.get_project("P-gov")) == "approved"
    # A pre-governance chat project already carries every field: also approved.
    store2 = ProjectStore(base_dir=tmp_path / "legacy-chat")
    _project_with_phase(store2, origin="", spec=governed_milestone_spec(["a"]))
    assert initiation_state(store2, store2.get_project("P-gov")) == "approved"


def test_chat_and_rest_share_the_governance_spec() -> None:
    assert governed_milestone_spec(
        {"lead", "coder"}, ai_budget_usd=2.5, approved_brief="brief", max_tasks=None
    ) == {
        "requires_owner_acceptance": True,
        "approved_brief": "brief",
        "max_tasks": None,
        "phase_agents": ["coder", "lead"],
        "ai_budget_usd": 2.5,
    }


# ── legacy projects: one owner approval outside chat ───────────────────────


def _legacy_group_project(tmp_path: Path) -> tuple[ProjectStore, GroupStore, str]:
    store = ProjectStore(base_dir=tmp_path / "projectos")
    groups = GroupStore(base_dir=tmp_path / "cowork")
    for agent in ("research-agent", "build-agent"):
        invite_member(groups, "thread-legacy", actor="u", target_id=agent, kind="agent")
    project = ProjectEngine(
        store,
        generate_milestones=lambda _goal: [
            Milestone(id="LM1", name="build", goal="build it"),
        ],
        decompose_tasks=lambda ms: [
            Task(id=f"{ms.id}-T1", milestone_id=ms.id, type="code", goal="build part")
        ],
    ).plan("legacy", "pre-governance plan")
    store.bind_thread("thread-legacy", project.id)
    return store, groups, project.id


def test_legacy_project_needs_one_owner_approval_that_backfills_governance(
    tmp_path: Path,
) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from runtime.sensing.gateway.projects_router import create_projects_router

    store, groups, project_id = _legacy_group_project(tmp_path)
    app = FastAPI()
    app.include_router(create_projects_router(store=store, group_store=groups))
    client = TestClient(app)

    refused = client.post(f"/api/projects/{project_id}/run", json={"max_ticks": 5})
    assert refused.status_code == 409
    assert refused.json()["detail"]["initiation_state"] == "legacy"
    initiation = client.get(f"/api/projects/{project_id}").json()["governance"]["initiation"]
    assert initiation["proposed_phase_agents"] == ["build-agent", "research-agent"]

    approved = client.post(
        f"/api/projects/{project_id}/initiation/approve",
        json={"expected_fingerprint": initiation["fingerprint"], "ai_budget_usd": 3},
    )

    assert approved.status_code == 200, approved.json()
    assert approved.json()["decision"]["previous_state"] == "legacy"
    assert store.get_milestone("LM1").spec == {
        "phase_agents": ["build-agent", "research-agent"],
        "ai_budget_usd": 3.0,
        "requires_owner_acceptance": True,
    }
    # From here on the legacy project is governed like a new one.
    assert approved.json()["governance"]["blocked_reason"] == "phase_authorization"
    owner_decides_via_api(client, project_id)
    ran = client.post(f"/api/projects/{project_id}/run", json={"max_ticks": 5}).json()
    assert ran["history"][-1]["events"][-1] == "awaiting_owner_acceptance:LM1"
    assert store.get_task("LM1-T1").assigned_agent in {"build-agent", "research-agent"}


def test_chat_keeps_running_legacy_projects_without_the_extra_approval(tmp_path: Path) -> None:
    store, groups, project_id = _legacy_group_project(tmp_path)
    chat_engine = engine_for_group(store, groups, "thread-legacy")

    result = chat_engine.tick(project_id)

    assert "awaiting_initiation_approval" not in result["events"]
    assert store.tasks_for_milestone("LM1")


def test_unstaffed_legacy_plan_is_approved_as_is(tmp_path: Path) -> None:
    store = ProjectStore(base_dir=tmp_path)
    _project_with_phase(store, origin="", spec={})
    owner_decides(store, "P-gov")

    approval = store.events_for_project("P-gov")[-1]
    assert approval["kind"] == "project.initiation_approved"
    assert approval["payload"]["governed"] is False
    assert store.get_milestone("M-gov").spec == {}
    assert phase_authorized(store, "P-gov", store.get_milestone("M-gov")) is True


# ── every UI/REST creation path is governed ────────────────────────────────


def test_attach_to_group_and_mode_switch_create_governed_projects(tmp_path: Path) -> None:
    groups = GroupStore(base_dir=tmp_path / "cowork")
    for agent in ("research-agent", "build-agent"):
        invite_member(groups, "thread-a", actor="u", target_id=agent, kind="agent")
        invite_member(groups, "thread-b", actor="u", target_id=agent, kind="agent")
    store = ProjectStore(base_dir=tmp_path / "projectos")

    attached = run_project_from_group(
        store, groups, "thread-a", name="a", goal="g", origin=PROJECT_ORIGIN_APP, run=False
    )
    switched_id = ensure_project_for_thread(store, groups, "thread-b", name="b", goal="g")

    for project_id in (attached["project"]["id"], switched_id):
        project = store.get_project(project_id)
        assert project.origin == PROJECT_ORIGIN_APP
        assert initiation_state(store, project) == "pending"
        for milestone in store.milestones_for(project_id):
            assert milestone.spec["phase_agents"] == ["build-agent", "research-agent"]
            assert milestone.spec["requires_owner_acceptance"] is True


# ── chat asks for a project-page project's initiation ──────────────────────


@pytest.mark.asyncio
async def test_chat_run_asks_for_initiation_then_the_phase(tmp_path: Path) -> None:
    from runtime.sensing.gateway.realtime_project_phase import authorize_phase

    groups = GroupStore(base_dir=tmp_path / "cowork")
    for agent in ("research-agent", "build-agent"):
        invite_member(groups, "thread-chat", actor="u", target_id=agent, kind="agent")
    store = ProjectStore(base_dir=tmp_path / "projectos")
    created = run_project_from_group(
        store, groups, "thread-chat", name="page", goal="g", origin=PROJECT_ORIGIN_APP
    )
    project = store.get_project(created["project"]["id"])
    requests: list[str] = []
    messages: list[str] = []

    class _Emitter:
        async def request_approval(self, _method: Any, params: dict, timeout: float) -> dict:
            requests.append(params["tool"])
            return {"action": "accept"}

        def is_turn_interrupted(self, _turn_id: str) -> bool:
            return False

    async def emit(_turn: Any, _log: Any, _emitter: Any, text: str) -> None:
        messages.append(text)

    registry = SimpleNamespace(
        has=lambda _id: True, get=lambda agent_id: SimpleNamespace(display_name=agent_id)
    )
    runtime = SimpleNamespace(
        _emit_agent_message=emit,
        _cowork_group_store=groups,
        _agent_registry=registry,
        _thread_store=None,
        _collaboration_store=None,
    )
    turn = SimpleNamespace(thread_id="thread-chat", id="turn-1")

    allowed = await authorize_phase(
        runtime, turn, None, _Emitter(), store=store, project=project, owner_id="", tenant_id=""
    )

    assert allowed is True
    assert requests == ["project_initiation", "project_phase"]
    kinds = _kinds(store, project.id)
    assert kinds.index("project.initiation_approved") < kinds.index("project.phase_authorized")
    assert initiation_state(store, store.get_project(project.id)) == "approved"
