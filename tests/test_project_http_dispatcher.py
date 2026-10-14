from __future__ import annotations

import threading
import time
from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.service import invite_member
from runtime.platform.process.task_supervisor import TaskLeaseConflict, TaskSupervisor
from runtime.projectos.engine import ProjectEngine
from runtime.projectos.http_dispatcher import ProjectHTTPDispatcher
from runtime.projectos.model import Project
from runtime.projectos.store import ProjectStore
from runtime.safety.approval.cancellation import current_cancellation_token
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.projects_router import create_projects_router
from runtime.sensing.gateway.thread_workspace import managed_workspace_metadata
from tests.project_governance_utils import owner_decides_via_api


def await_status(dispatcher, project, expected):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        state = dispatcher.state(project)
        if state and state["status"] == expected:
            return state
        time.sleep(0.02)
    pytest.fail(f"expected {expected}, got {dispatcher.state(project)}")


@contextmanager
def dispatchers(tmp_path, **kwargs):
    supervisor = TaskSupervisor.from_path(tmp_path / "tasks.json")
    first = ProjectHTTPDispatcher(supervisor, **kwargs)
    second = ProjectHTTPDispatcher(supervisor, **kwargs)
    try:
        yield first, second
    finally:
        first.close()
        second.close()


def test_background_completion_is_durable_and_duplicate_is_fenced(tmp_path):
    project = Project(id="P-1", name="Ship", goal="release")
    release = threading.Event()
    started = threading.Event()
    with dispatchers(tmp_path) as (first, second):

        def worker():
            started.set()
            assert release.wait(3)
            return {"final_status": "blocked"}

        try:
            receipt = first.submit(project, worker)
            assert receipt["accepted"] and receipt["status"] == "queued"
            assert started.wait(2)
            with pytest.raises(TaskLeaseConflict):
                second.submit(project, lambda: pytest.fail("duplicate executed"))
            assert second.state(project)["status"] == "running"
        finally:
            release.set()
        state = await_status(second, project, "completed")
        assert state["result"] == {"final_status": "blocked"}
        assert state["request_id"] == receipt["request_id"]
    fresh = ProjectHTTPDispatcher(TaskSupervisor.from_path(tmp_path / "tasks.json"))
    try:
        assert fresh.state(project)["result"] == {"final_status": "blocked"}
    finally:
        fresh.close()


def test_foreign_cancellation_reaches_active_worker(tmp_path):
    project = Project(id="P-1", name="Ship", goal="release")
    started = threading.Event()
    with dispatchers(tmp_path) as (first, second):

        def worker():
            started.set()
            token = current_cancellation_token()
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                token.throw_if_cancelled()
                time.sleep(0.02)
            pytest.fail("cancellation did not propagate")

        first.submit(project, worker)
        assert started.wait(2)
        second.cancel(project)
        assert await_status(first, project, "cancelled")["cancel_requested"]


def test_other_worker_startup_does_not_sweep_live_background_project(tmp_path):
    from runtime.projectos.restart_sweep import sweep_projects_interrupted_by_restart

    store = ProjectStore(tmp_path / "projects")
    project = Project(id="P-live", name="Live", goal="release", status="running")
    store.save_project(project)
    release = threading.Event()
    with dispatchers(tmp_path) as (first, _):
        try:
            first.submit(project, lambda: release.wait(3) and {})
            assert (
                sweep_projects_interrupted_by_restart(store, task_supervisor=first.supervisor) == []
            )
            assert store.events_for_project(project.id) == []
        finally:
            release.set()
        await_status(first, project, "completed")
        interrupted = sweep_projects_interrupted_by_restart(store, task_supervisor=first.supervisor)
        assert interrupted[0]["project_id"] == project.id


def test_bounded_queue_and_queued_cancellation(tmp_path):
    projects = [Project(id=f"P-{i}", name="Ship", goal="release") for i in range(3)]
    release = threading.Event()
    with dispatchers(tmp_path, max_workers=1, max_queued=1) as (first, _):
        try:
            first.submit(projects[0], lambda: release.wait(3) and {})
            first.submit(projects[1], lambda: pytest.fail("cancelled queue item executed"))
            with pytest.raises(OverflowError):
                first.submit(projects[2], lambda: {})
            first.cancel(projects[1])
        finally:
            release.set()
        await_status(first, projects[1], "cancelled")
        assert first.state(projects[2]) is None


def test_http_returns_before_engine_finishes_and_retains_owner_approval(tmp_path, monkeypatch):
    store = ProjectStore(tmp_path)
    groups = GroupStore(tmp_path / "cowork")
    app = FastAPI()
    app.include_router(create_projects_router(store=store, group_store=groups))
    started = threading.Event()
    release = threading.Event()
    seen = []

    def run(self, project_id, *, max_ticks):
        started.set()
        seen.append((project_id, max_ticks, self.scope))
        assert release.wait(3)
        return {"final_status": "blocked"}

    monkeypatch.setattr(ProjectEngine, "run", run)
    with TestClient(app) as client:
        project_id = client.post("/api/projects", json={"name": "Ship", "goal": "release"}).json()[
            "project"
        ]["id"]
        denied = client.post(f"/api/projects/{project_id}/run", json={"background": True})
        assert denied.status_code == 409
        assert not started.is_set()
        invite_member(groups, "thread-team", actor="u", target_id="coder", kind="agent")
        store.bind_thread("thread-team", project_id)
        owner_decides_via_api(client, project_id)
        try:
            accepted = client.post(
                f"/api/projects/{project_id}/run", json={"background": True, "max_ticks": 2}
            )
            assert accepted.status_code == 202
            assert started.wait(2)
            assert not release.is_set()
            duplicate = client.post(f"/api/projects/{project_id}/run", json={"background": True})
            assert duplicate.status_code == 409
            assert (
                client.get(f"/api/projects/{project_id}/execution").json()["execution"]["status"]
                == "running"
            )
        finally:
            release.set()
        assert seen == [(project_id, 2, None)]


def test_background_worker_keeps_server_principal_workspace_and_cancel_isolation(
    tmp_path, monkeypatch
):
    from pathlib import Path

    from runtime.execution.request import current_execution_request

    identities = IdentityStore()
    for actor, tenant in (("alice", "a"), ("bob", "b"), ("sam", "a")):
        identities.add(
            Identity(actor_id=actor, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"sk-{actor}",
        )
    root = tmp_path / "workspaces"
    metadata = {
        "owner_actor_id": "alice",
        "tenant_id": "a",
        **managed_workspace_metadata(root, tenant_id="a", actor_id="alice", thread_id="managed"),
    }
    Path(metadata["workspace_path"]).mkdir(parents=True)

    class Threads:
        def get(self, thread_id):
            return (
                {"thread_id": thread_id, "metadata": metadata} if thread_id == "managed" else None
            )

    store = ProjectStore(tmp_path / "projects")
    groups = GroupStore(tmp_path / "cowork")
    invite_member(groups, "managed", actor="alice", target_id="coder", kind="agent")
    app = FastAPI()
    app.include_router(
        create_projects_router(
            store=store,
            group_store=groups,
            thread_store=Threads(),
            workspace_root=root,
            identity_store=identities,
            require_auth=True,
        )
    )
    started = threading.Event()
    observed = []

    def run(self, project_id, *, max_ticks):
        task = current_execution_request().task
        observed.append((task.actor_id, task.tenant_id, task.thread_id))
        assert task.permissions.allows_write(Path(metadata["workspace_path"]))
        started.set()
        token = current_cancellation_token()
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            token.throw_if_cancelled()
            time.sleep(0.02)
        pytest.fail("HTTP cancellation did not reach the host boundary")

    monkeypatch.setattr(ProjectEngine, "run", run)
    alice = {"Authorization": "Bearer sk-alice"}
    with TestClient(app) as client:
        pid = client.post(
            "/api/projects", headers=alice, json={"name": "Owned", "goal": "private"}
        ).json()["project"]["id"]
        store.bind_thread("managed", pid)
        owner_decides_via_api(client, pid, headers=alice)
        assert (
            client.post(
                f"/api/projects/{pid}/run", headers=alice, json={"background": True}
            ).status_code
            == 202
        )
        assert started.wait(2)
        for actor in ("bob", "sam"):
            headers = {"Authorization": f"Bearer sk-{actor}"}
            assert client.get(f"/api/projects/{pid}/execution", headers=headers).status_code == 404
            assert (
                client.post(f"/api/projects/{pid}/execution/cancel", headers=headers).status_code
                == 404
            )
            assert (
                client.post(
                    f"/api/projects/{pid}/run", headers=headers, json={"background": True}
                ).status_code
                == 404
            )
        assert client.get(f"/api/projects/{pid}/execution").status_code == 401
        assert (
            client.post(f"/api/projects/{pid}/execution/cancel", headers=alice).status_code == 200
        )
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if (
                client.get(f"/api/projects/{pid}/execution", headers=alice).json()["execution"][
                    "status"
                ]
                == "cancelled"
            ):
                break
            time.sleep(0.02)
        else:
            pytest.fail("cancelled job did not reach terminal state")
        assert observed == [("alice", "a", "managed")]
