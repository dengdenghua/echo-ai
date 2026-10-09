from __future__ import annotations

import base64
import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.node_worker import ExecutionNodeWorker
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.platform.io.lease import LeaseStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.execution_nodes_router import create_execution_nodes_router
from runtime.workspace import WorkspaceStore


@pytest.fixture
def setup(tmp_path):
    identities = IdentityStore()
    for actor, roles, tenant in [
        ("alice", [], "team"),
        ("bob", [], "team"),
        ("operator", ["operator"], "team"),
        ("foreign", ["operator"], "other"),
    ]:
        identities.add(
            Identity(actor_id=actor, roles=roles, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"sk-{actor}",
        )
    spaces = WorkspaceStore(tmp_path / "spaces.db")
    project = tmp_path / "project"
    project.mkdir()
    (project / "input.txt").write_text("original")
    ws = spaces.create_workspace(
        name="Project",
        mount_type="local",
        mount_target=str(project),
        mount_options={},
        owner_id="alice",
        tenant_id="team",
    )
    store = CollaborationStore(tmp_path / "ledger")
    app = FastAPI()
    app.include_router(
        create_execution_nodes_router(
            collaboration_store=store,
            workspace_store=spaces,
            lease_store=LeaseStore(tmp_path / "leases.db"),
            identity_store=identities,
            require_auth=True,
        )
    )
    user = TestClient(app, headers={"Authorization": "Bearer sk-alice"})
    node = TestClient(app, headers={"Authorization": "Bearer sk-operator"})
    for node_id in ("nas-a", "nas-b"):
        assert (
            node.post(
                "/api/execution/nodes",
                json=dict(node_id=node_id, label=node_id, workspace_ids=[ws.id], roles=["coder"]),
            ).status_code
            == 200
        )
    return user, node, store, spaces, ws, project


def submit(setup, **updates):
    user, _, _, _, ws, _ = setup
    body = dict(
        request_id="one",
        workspace_id=ws.id,
        node_ids=["nas-a", "nas-b"],
        goal="write a report",
        role="coder",
    )
    body.update(updates)
    response = user.post("/api/execution/tasks", json=body)
    assert response.status_code == 200, response.text
    return response.json(), body


def test_same_ledger_independent_stores_cannot_double_claim(tmp_path):
    stores = [CollaborationStore(tmp_path), CollaborationStore(tmp_path)]
    stores[0].create_collaboration_run(run_id="run", session_id="thread", kind="execution_node")
    gate = Barrier(2)

    def claim(index):
        gate.wait(3)
        try:
            return stores[index].claim_collaboration_run("run", worker_id=f"node-{index}")[
                "lease_owner"
            ]
        except RuntimeError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(value is not None for value in pool.map(claim, range(2))) == 1


def test_old_node_cannot_renew_or_publish_after_takeover(setup, monkeypatch):
    user, node, store, *_ = setup
    run, _ = submit(setup)
    url = f"/api/execution/tasks/{run['run_id']}"
    first = dict(
        node_id="nas-a",
        instance_id="old",
        attempt=1,
        input_sha256=run["input"]["input_snapshot"]["sha256"],
    )
    assert node.post(url + "/claim", json=first).status_code == 200
    second = dict(
        node_id="nas-b",
        instance_id="new",
        attempt=2,
        input_sha256=run["input"]["input_snapshot"]["sha256"],
    )
    assert node.post(url + "/claim", json=second).status_code == 409
    future = datetime.now(UTC) + timedelta(seconds=20)
    monkeypatch.setattr("runtime.memory.cowork.collaboration_runs._now", lambda: future)
    assert node.post(url + "/heartbeat", json=first).status_code == 409
    reclaimed = node.post(url + "/claim", json=second)
    assert reclaimed.status_code == 200, reclaimed.text
    assert reclaimed.json()["attempt"] == 2
    assert (
        node.post(url + "/result", json=dict(**first, success=True, output="obsolete")).status_code
        == 409
    )
    assert (
        node.post(url + "/result", json=dict(**second, success=True, output="fresh")).status_code
        == 200
    )
    restarted = CollaborationStore(store.base_dir)
    assert restarted.collaboration_run(run["run_id"])["result"]["output"] == "fresh"
    assert user.get(url).json()["status"] == "completed"


def test_idempotency_ownership_and_role_revocation(setup):
    user, node, _, spaces, ws, _ = setup
    run, body = submit(setup)
    assert user.post("/api/execution/tasks", json=body).json()["run_id"] == run["run_id"]
    assert user.post("/api/execution/tasks", json={**body, "goal": "different"}).status_code == 409
    url = f"/api/execution/tasks/{run['run_id']}"
    assert user.get(url, headers={"Authorization": "Bearer sk-bob"}).status_code == 404
    claim = dict(node_id="nas-a", instance_id="one")
    assert user.post(url + "/claim", json=claim).status_code == 403
    assert (
        node.post(
            url + "/claim", json=claim, headers={"Authorization": "Bearer sk-foreign"}
        ).status_code
        == 409
    )
    spaces.add_member(ws.id, "alice", role="viewer")
    assert node.post(url + "/claim", json=claim).status_code == 404


def test_pause_cancel_and_retry_ceiling(setup, monkeypatch):
    user, node, _, _, _, _ = setup
    run, _ = submit(setup)
    url = f"/api/execution/tasks/{run['run_id']}"
    identity = dict(node_id="nas-a", instance_id="one", attempt=1)
    assert user.post(url + "/actions", json={"action": "pause"}).status_code == 200
    assert node.post(url + "/claim", json=identity).status_code == 409
    assert user.post(url + "/actions", json={"action": "resume"}).status_code == 200
    now = datetime.now(UTC)
    for attempt in range(1, 4):
        monkeypatch.setattr("runtime.memory.cowork.collaboration_runs._now", lambda now=now: now)
        response = node.post(url + "/claim", json=identity)
        assert response.status_code == 200
        assert response.json()["attempt"] == attempt
        now += timedelta(seconds=20)
    monkeypatch.setattr("runtime.memory.cowork.collaboration_runs._now", lambda: now)
    assert node.post(url + "/claim", json=identity).status_code == 409
    assert user.post(url + "/actions", json={"action": "cancel"}).status_code == 200
    assert node.post(url + "/heartbeat", json={**identity, "attempt": 3}).status_code == 409


def artifact(name, data, baseline=None):
    return dict(
        path=name,
        sha256=hashlib.sha256(data).hexdigest(),
        content=base64.b64encode(data).decode(),
        baseline_sha256=baseline,
    )


def test_delivery_hash_and_workspace_conflicts(setup):
    user, node, _, _, _, project = setup
    run, _ = submit(setup)
    url = f"/api/execution/tasks/{run['run_id']}"
    identity = dict(
        node_id="nas-a",
        instance_id="one",
        attempt=1,
        input_sha256=run["input"]["input_snapshot"]["sha256"],
    )
    assert node.post(url + "/claim", json=identity).status_code == 200
    output = artifact("input.txt", b"edited", hashlib.sha256(b"original").hexdigest())
    invalid = {**output, "sha256": "0" * 64}
    assert (
        node.post(
            url + "/result", json=dict(**identity, success=True, artifacts=[invalid])
        ).status_code
        == 409
    )
    delivered = node.post(url + "/result", json=dict(**identity, success=True, artifacts=[output]))
    assert delivered.status_code == 200, delivered.text
    assert (project / "input.txt").read_text() == "original"
    assert user.get(url + "/artifacts/0").content == b"edited"
    (project / "input.txt").write_text("human edit")
    assert user.post(url + "/actions", json={"action": "apply"}).status_code == 409
    assert (project / "input.txt").read_text() == "human edit"
    (project / "input.txt").write_text("original")
    assert user.post(url + "/actions", json={"action": "apply"}).status_code == 200
    assert user.post(url + "/actions", json={"action": "apply"}).status_code == 200
    assert (project / "input.txt").read_text() == "edited"


def test_worker_executes_snapshot_and_returns_verified_output(setup, tmp_path, monkeypatch):
    user, node, _, _, ws, project = setup
    run, _ = submit(setup, output_files=["report.txt"])

    def execute(_role, _goal, **kwargs):
        from runtime.execution.request import current_execution_request

        task = current_execution_request().task
        assert task.allowed_tools is not None and "exec_command" not in task.allowed_tools
        root = Path(kwargs["session"].metadata["workspace_path"])
        assert root != project
        assert not task.permissions.allows_write(project)
        (root / "report.txt").write_text("verified bytes")
        return {"success": True, "output": "Report ready"}

    monkeypatch.setattr("runtime.execution.node_worker.call_subagent", execute)
    worker = ExecutionNodeWorker(
        node_id="nas-a",
        label="NAS",
        workspaces={ws.id: str(project)},
        roles=["coder"],
        client=node,
        data_dir=tmp_path / "node",
        runner=None,
    )
    assert worker.run_once()
    result = user.get(f"/api/execution/tasks/{run['run_id']}").json()
    assert result["status"] == "completed", result
    assert (
        result["result"]["artifacts"][0]["sha256"] == hashlib.sha256(b"verified bytes").hexdigest()
    )
    assert not (project / "report.txt").exists()


def test_worker_real_bridge_inherits_contract_and_uses_real_file_tool(setup, tmp_path, monkeypatch):
    from uuid import uuid4

    from runtime.execution.request import current_execution_request
    from runtime.execution.suckers import Skill, SkillRegistry
    from runtime.execution.suckers.write_skills import _write_text_file
    from runtime.execution.tool_engine import ToolExecutor
    from runtime.memory.journal import InMemoryJournal
    from runtime.platform.models import ArmId, Budget, BudgetLimits, SkillId, TaskId
    from runtime.platform.process.session import current_session
    from runtime.safety.auth import TrustEngine
    from tests.test_isolated_subagent import _installed_coder

    user, node, _, _, ws, project = setup
    run, _ = submit(setup, output_files=["real.txt"])
    registry = SkillRegistry()
    registry.register(
        Skill(
            name="write_text_file",
            description="write",
            affinity=["write"],
            trusted_source="skill://public/write",
            handler=_write_text_file,
        )
    )
    executor = ToolExecutor(
        registry=registry,
        immunity=TrustEngine(trusted_sources=["skill://public/*"]),
        journal=InMemoryJournal(),
    )

    def runner(*args, **kwargs):
        task = current_execution_request().task
        assert task.parent_task_id == run["run_id"]
        assert task.allowed_tools is not None and "write_text_file" in task.allowed_tools
        root = Path(current_session().metadata["workspace_path"])
        tool_task = TaskId(uuid4())
        step = executor.execute_step(
            step_id=1,
            node_id="write",
            sucker_id=SkillId("write_text_file"),
            args={"path": str(root / "real.txt"), "content": "real bridge"},
            caller="test",
            task_id=tool_task,
            arm_id=ArmId("test"),
            budget=Budget(task_id=tool_task, limits=BudgetLimits(tokens=1000, usd=1)),
        )
        assert step.result.status == "success", step.result
        return "done"

    _installed_coder(monkeypatch, runner)
    worker = ExecutionNodeWorker(
        node_id="nas-a",
        label="NAS",
        workspaces={ws.id: str(project)},
        roles=["coder"],
        client=node,
        data_dir=tmp_path / "real-node",
        runner=runner,
    )
    assert worker.run_once()
    result = user.get(f"/api/execution/tasks/{run['run_id']}").json()
    assert result["status"] == "completed", result
    assert user.get(f"/api/execution/tasks/{run['run_id']}/artifacts/0").content == b"real bridge"
    assert not (project / "real.txt").exists()


def test_same_instance_restart_does_not_accept_old_attempt(tmp_path, monkeypatch):
    store = CollaborationStore(tmp_path)
    store.create_collaboration_run(run_id="r", session_id="t", kind="execution_node")
    first = store.claim_collaboration_run("r", worker_id="node:reused", lease_seconds=5)
    later = datetime.now(UTC) + timedelta(seconds=10)
    monkeypatch.setattr("runtime.memory.cowork.collaboration_runs._now", lambda: later)
    second = CollaborationStore(tmp_path).claim_collaboration_run("r", worker_id="node:reused")
    assert second["attempt"] == first["attempt"] + 1
    with pytest.raises(RuntimeError):
        store.heartbeat_collaboration_run(
            "r", worker_id="node:reused", expected_attempt=first["attempt"]
        )
    with pytest.raises(RuntimeError):
        store.transition_collaboration_run(
            "r",
            status="completed",
            result={"old": True},
            worker_id="node:reused",
            expected_attempt=first["attempt"],
        )


def test_retry_exhaustion_converges_to_failed(setup, monkeypatch):
    user, node, store, *_ = setup
    run, _ = submit(setup)
    url = f"/api/execution/tasks/{run['run_id']}"
    now = datetime.now(UTC)
    for _ in range(3):
        monkeypatch.setattr("runtime.memory.cowork.collaboration_runs._now", lambda now=now: now)
        assert (
            node.post(url + "/claim", json={"node_id": "nas-a", "instance_id": "one"}).status_code
            == 200
        )
        now += timedelta(seconds=20)
    monkeypatch.setattr("runtime.memory.cowork.collaboration_runs._now", lambda: now)
    assert node.get("/api/execution/nodes/nas-a/pending").json()["tasks"] == []
    assert user.get(url).json()["status"] == "failed"
    assert store.collaboration_run_events(run["run_id"])[-1]["event_type"] == "retry_exhausted"


def test_invocation_visibility_and_cancellation_are_owner_scoped(setup):
    user, _, store, *_ = setup
    store.create_collaboration_run(
        run_id="invoke",
        session_id="thread",
        kind="engine_invocation",
        input={"tenant_id": "team", "actor_id": "alice"},
    )
    store.claim_collaboration_run("invoke", worker_id="local")
    assert len(user.get("/api/execution/invocations").json()["invocations"]) == 1
    assert (
        user.get("/api/execution/invocations", headers={"Authorization": "Bearer sk-bob"}).json()[
            "invocations"
        ]
        == []
    )
    assert (
        user.post(
            "/api/execution/invocations/invoke/cancel", headers={"Authorization": "Bearer sk-bob"}
        ).status_code
        == 404
    )
    assert user.post("/api/execution/invocations/invoke/cancel").status_code == 200


def test_stored_artifact_corruption_is_detected_before_apply(setup):
    user, node, store, _, _, project = setup
    run, _ = submit(setup)
    url = f"/api/execution/tasks/{run['run_id']}"
    identity = dict(
        node_id="nas-a",
        instance_id="one",
        attempt=1,
        input_sha256=run["input"]["input_snapshot"]["sha256"],
    )
    node.post(url + "/claim", json=identity).raise_for_status()
    output = artifact("new.txt", b"good")
    node.post(
        url + "/result", json=dict(**identity, success=True, artifacts=[output])
    ).raise_for_status()
    (store.base_dir / "execution-artifacts" / run["run_id"] / "1" / output["sha256"]).write_bytes(
        b"corrupt"
    )
    assert user.post(url + "/actions", json={"action": "apply"}).status_code == 409
    assert not (project / "new.txt").exists()


def test_snapshot_excludes_secrets_and_delivery_quota_is_cumulative(tmp_path, monkeypatch):
    from runtime.execution.node_artifacts import receive_artifact, relative_path, snapshot

    source = tmp_path / "source"
    source.mkdir()
    (source / ".env").write_text("secret")
    (source / "file.txt").write_text("safe")
    target = tmp_path / "snapshot"
    assert list(snapshot(source, target)) == ["file.txt"]
    assert not (target / ".env").exists()
    for path in ["../escape", "C:/escape", "a:stream", "a/../b", "NUL.txt", "a/."]:
        with pytest.raises(ValueError):
            relative_path(path)
    monkeypatch.setattr("runtime.execution.node_artifacts.MAX_DELIVERY", 5)
    root = tmp_path / "artifacts"
    receive_artifact(root, artifact("a.txt", b"1234"))
    receive_artifact(root, artifact("a.txt", b"1234"))
    with pytest.raises(ValueError, match="storage limit"):
        receive_artifact(root, artifact("b.txt", b"5678"))


def test_process_crash_can_be_reclaimed_from_persisted_ledger(tmp_path, monkeypatch):
    import subprocess
    import sys

    store = CollaborationStore(tmp_path)
    store.create_collaboration_run(run_id="r", session_id="t", kind="execution_node")
    code = "import os,sys; from runtime.memory.cowork.collaboration_store import CollaborationStore; CollaborationStore(sys.argv[1]).claim_collaboration_run('r',worker_id='dead',lease_seconds=5); os._exit(0)"
    subprocess.run([sys.executable, "-c", code, str(tmp_path)], check=True, timeout=15)
    later = datetime.now(UTC) + timedelta(seconds=10)
    monkeypatch.setattr("runtime.memory.cowork.collaboration_runs._now", lambda: later)
    recovered = CollaborationStore(tmp_path).claim_collaboration_run("r", worker_id="replacement")
    assert recovered["attempt"] == 2
    assert [e["event_type"] for e in store.collaboration_run_events("r")] == [
        "created",
        "claimed",
        "reclaimed",
    ]


def test_real_http_worker_survives_lost_completion_response(setup, tmp_path, monkeypatch):
    import socket
    import threading
    import time

    import httpx
    import uvicorn

    user, _, _, _, ws, project = setup
    run, _ = submit(setup)
    invoked = []

    def execute(_role, _goal, **kwargs):
        invoked.append(True)
        (Path(kwargs["session"].metadata["workspace_path"]) / "result.txt").write_text("once")
        return {"success": True, "output": "done"}

    monkeypatch.setattr("runtime.execution.node_worker.call_subagent", execute)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(user.app, log_level="error", lifespan="off"))
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        with httpx.Client(
            base_url=f"http://127.0.0.1:{sock.getsockname()[1]}",
            headers={"Authorization": "Bearer sk-operator"},
            timeout=5,
        ) as client:
            actual_post = client.post
            lost = []

            def unreliable(path, **kwargs):
                response = actual_post(path, **kwargs)
                if path.endswith("/result") and not lost:
                    lost.append(True)
                    raise httpx.ReadError("response lost after commit")
                return response

            monkeypatch.setattr(client, "post", unreliable)
            worker = ExecutionNodeWorker(
                node_id="nas-a",
                label="NAS",
                workspaces={ws.id: str(project)},
                roles=["coder"],
                client=client,
                data_dir=tmp_path / "http-node",
                runner=None,
            )
            assert worker.run_once()
            assert invoked == [True]
            assert lost == [True]
        assert user.get(f"/api/execution/tasks/{run['run_id']}").json()["status"] == "completed"
    finally:
        server.should_exit = True
        thread.join(5)
        sock.close()


def test_locations_list_nodes_with_the_callers_writable_workspaces(setup):
    user, node, _, spaces, ws, _ = setup
    other = spaces.create_workspace(
        name="Private",
        mount_type="local",
        mount_target=str(Path(ws.mount_target).parent),
        mount_options={},
        owner_id="bob",
        tenant_id="team",
    )
    node.post(
        "/api/execution/nodes",
        json=dict(
            node_id="nas-a", label="书房 NAS", workspace_ids=[ws.id, other.id], roles=["coder"]
        ),
    )

    body = user.get("/api/execution/locations").json()

    listed = {n["node_id"]: n for n in body["execution_nodes"]}
    assert set(listed) == {"nas-a", "nas-b"}
    # alice cannot write bob's workspace, so it is not offered as a location.
    assert [w["name"] for w in listed["nas-a"]["workspaces"]] == ["Project"]
    assert listed["nas-a"]["label"] == "书房 NAS" and listed["nas-a"]["online"] is True
    # SSH / WSL connections are operator configuration; alice only sees nodes.
    assert body["remote"]["can_manage"] is False and body["remote"]["connections"] == []
    assert body["wsl"]["distros"] == [] and body["cloud"] == {"available": False}
