"""Real router lifespan, host workspace and durable worker integration."""

from __future__ import annotations

import threading
import time
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.request import current_execution_request
from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.service import invite_member, remove_member
from runtime.projectos.model import Milestone, Project, Task
from runtime.projectos.store import ProjectStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway._projects_standing_service import StandingProjectService
from runtime.sensing.gateway.projects_router import create_projects_router
from runtime.sensing.gateway.thread_workspace import managed_workspace_metadata
from tests.project_governance_utils import owner_decides_via_api


def _wait(check, *, describe=None):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.02)
    detail = f"; last state: {describe()}" if describe is not None else ""
    pytest.fail("standing worker did not reach the expected state" + detail)


@pytest.mark.parametrize("stop", ["delivery", "revoke", "identity", "cancel", "roster"])
def test_confirmed_grant_runs_after_http_returns_and_rechecks_scope_between_calls(
    tmp_path, monkeypatch, stop
):
    identities = IdentityStore()
    identities.add(
        Identity(actor_id="alice", metadata={"tenant_id": "a"}), api_key_plaintext="sk-alice"
    )
    root = tmp_path / "workspaces"
    metadata = {
        "owner_actor_id": "alice",
        "tenant_id": "a",
        **managed_workspace_metadata(
            root,
            tenant_id="a",
            actor_id="alice",
            thread_id="managed",
        ),
    }
    Path(metadata["workspace_path"]).mkdir(parents=True)

    class Threads:
        def get(self, thread_id):
            return (
                {"thread_id": thread_id, "metadata": metadata} if thread_id == "managed" else None
            )

    store = ProjectStore(tmp_path / "projects")
    store.save_project(
        Project(
            id="P",
            name="reviewed",
            goal="artifact",
            owner_id="alice",
            tenant_id="a",
            status="running",
            milestone_ids=["M"],
        )
    )
    store.save_milestone(
        "P",
        Milestone(
            id="M",
            name="phase",
            goal="artifact",
            spec={"phase_agents": ["coder"], "ai_budget_usd": 5, "requires_owner_acceptance": True},
        ),
    )
    store.bind_thread("managed", "P")
    groups = GroupStore(tmp_path / "groups")
    invite_member(groups, "managed", actor="alice", target_id="coder", kind="agent")
    started, release = threading.Event(), threading.Event()
    observed, qa_calls = [], []

    def execute(task, context):
        execution = current_execution_request().task
        observed.append((execution.actor_id, execution.tenant_id, execution.thread_id))
        assert execution.permissions.allows_write(Path(metadata["workspace_path"]))
        started.set()
        assert release.wait(4)
        context["record_project_usage"]({"governance": {"root_id": task.id, "cost_usd": 0.1}})
        return "artifact"

    def qa(*_):
        qa_calls.append(True)
        return {"approved": True}

    # Replace only provider hooks. Router, engine, leases, admission, identity
    # lookup, workspace capability and cancellation all run as in production.
    monkeypatch.setattr(
        "runtime.projectos.llm_hooks.create_llm_hooks",
        lambda *_args, **_kwargs: {
            "generate_milestones": lambda _: [],
            "decompose_tasks": lambda ms: [
                Task(id="T", type="code", milestone_id=ms.id, goal="artifact")
            ],
            "execute_task": execute,
            "qa_task": qa,
        },
    )
    original = StandingProjectService.__init__
    services = []

    def initialize(self, *args, **kwargs):
        original(self, *args, **kwargs, interval_seconds=0.05)
        services.append(self)

    monkeypatch.setattr(StandingProjectService, "__init__", initialize)

    def app():
        result = FastAPI()
        result.include_router(
            create_projects_router(
                store=store,
                group_store=groups,
                thread_store=Threads(),
                workspace_root=root,
                identity_store=identities,
                require_auth=True,
                model_router=object(),
            )
        )
        return result

    first, second = app(), app()
    headers = {"Authorization": "Bearer sk-alice"}
    path = "/api/projects/P/standing-authorization"
    with TestClient(first) as client, TestClient(second):
        owner_decides_via_api(client, "P", headers=headers)
        reviewed = client.post(
            path + "/review", headers=headers, json={"phase_ids": ["M"], "limit_usd": 3}
        )
        assert reviewed.status_code == 200, reviewed.text
        assert not started.is_set()  # reviewing alone confers no execution authority
        confirmed = client.post(
            path + "/confirm",
            headers=headers,
            json={"review_id": reviewed.json()["review_id"], "confirmed": True},
        )
        assert confirmed.status_code == 200, confirmed.text
        try:
            assert started.wait(3)
            assert services[1].sweep(second) == 0  # live lease fences the other worker
            if stop == "delivery":

                def unnecessary_full_state(*_args):
                    pytest.fail("active leased work must not rebuild the full project state")

                guarded = object.__new__(StandingProjectService)
                original(
                    guarded,
                    replace(services[1].deps, full_state=unnecessary_full_state),
                    services[1].dispatcher,
                    identities,
                )
                assert guarded.sweep(second) == 0
            if stop == "revoke":
                assert client.delete(path, headers=headers).status_code == 200
            elif stop == "identity":
                identities.remove("alice")
            elif stop == "cancel":
                assert (
                    client.post("/api/projects/P/execution/cancel", headers=headers).status_code
                    == 200
                )
            elif stop == "roster":
                remove_member(groups, "managed", actor="alice", target_id="coder")
        finally:
            release.set()
        project = store.get_project("P")
        expected = "completed" if stop == "delivery" else "cancelled"
        _wait(
            lambda: next(
                (
                    state
                    for svc in services
                    if (state := svc.dispatcher.state(project)) and state["status"] == expected
                ),
                None,
            ),
            describe=lambda: {
                "jobs": [svc.dispatcher.state(project) for svc in services],
                "task_status": store.get_task("T").status,
                "qa_calls": len(qa_calls),
                "executions": observed,
            },
        )
        assert observed == [("alice", "a", "managed")]
        task = store.get_task("T")
        if stop == "delivery":
            assert qa_calls == [True] and task.status == "done"
            state = client.get("/api/projects/P", headers=headers).json()
            assert state["governance"]["blocked_reason"] == "owner_acceptance"
            assert services[0].sweep(first) == services[1].sweep(second) == 0
        else:
            assert qa_calls == [] and task.status == "pending" and task.attempts == 0
            assert task.output == "artifact"
            if stop == "cancel":
                fresh = StandingProjectService(services[0].deps, services[1].dispatcher, identities)
                assert fresh.sweep(second) == 0
                reviewed_again = client.post(
                    path + "/review", headers=headers, json={"phase_ids": ["M"], "limit_usd": 3}
                )
                renewed = client.post(
                    path + "/confirm",
                    headers=headers,
                    json={
                        "review_id": reviewed_again.json()["review_id"],
                        "confirmed": True,
                    },
                )
                assert renewed.status_code == 200, renewed.text
                assert renewed.json()["grant_id"] != confirmed.json()["grant_id"]
                _wait(
                    lambda: next(
                        (
                            state
                            for svc in services
                            if (state := svc.dispatcher.state(project))
                            and state["status"] == "completed"
                        ),
                        None,
                    )
                )
                assert observed == [
                    ("alice", "a", "managed")
                ]  # retry QA, never replay the side effect
                assert qa_calls == [True] and store.get_task("T").status == "done"
