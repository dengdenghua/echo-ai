"""A confirmation belongs to one pending operation, not merely a task id."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform.process._task_approval_identity import approval_request_version
from runtime.platform.process.task_supervisor import TaskRunStatus, TaskSupervisor
from runtime.safety.auth.identity import Identity, IdentityStore
from runtime.sensing.gateway.task_runs_router import create_task_runs_router


def _waiting(supervisor, *, tool="apps.start", call="call-1"):
    return supervisor.transition(
        "task",
        TaskRunStatus.WAITING_APPROVAL,
        reason="review operation",
        metadata_patch={
            "approval_required": True,
            "approval_tool_name": tool,
            "approval_action": "confirm",
            "approval_hold": {"tool_call_id": call, "turn_id": "turn", "args_preview": "target"},
        },
    )


@pytest.mark.parametrize("next_tool", ["apps.start", "files.delete"])
def test_stale_consent_cannot_approve_next_operation(tmp_path, next_tool):
    supervisor = TaskSupervisor.from_path(tmp_path / "tasks.json", holder_id="worker")
    supervisor.start_task(task_id="task", kind="loop", owner_id="alice")
    first = _waiting(supervisor)
    version = approval_request_version(first)
    supervisor.record_approval_decision("task", approved=True, expected_approval_version=version)
    # Even if a provider repeats its call identifier and operation, the previous
    # committed decision distinguishes the next consent request.
    next_request = _waiting(supervisor, tool=next_tool)
    assert approval_request_version(next_request) != version
    before = supervisor.store.get("task")
    with pytest.raises(ValueError, match="approval request changed"):
        supervisor.record_approval_decision(
            "task", approved=True, expected_approval_version=version
        )
    assert supervisor.store.get("task") == before
    approved = supervisor.record_approval_decision(
        "task", approved=True, expected_approval_version=approval_request_version(before)
    )
    assert approved.metadata["approval_decisions"][-1]["tool_name"] == next_tool


def test_lease_renewal_does_not_invalidate_review(tmp_path):
    supervisor = TaskSupervisor.from_path(tmp_path / "tasks.json", holder_id="worker")
    supervisor.start_task(task_id="task", kind="loop")
    waiting = _waiting(supervisor)
    version = approval_request_version(waiting)
    supervisor.store.mutate(
        "task",
        lambda record: record.model_copy(
            update={
                "lease": record.lease.model_copy(
                    update={"expires_at": record.lease.expires_at + 30}
                )
            },
            deep=True,
        ),
    )
    assert approval_request_version(supervisor.store.get("task")) == version
    assert (
        supervisor.record_approval_decision(
            "task", approved=False, expected_approval_version=version
        ).status
        == TaskRunStatus.PAUSED
    )


def test_http_consent_keeps_auth_and_rejects_changed_request(tmp_path):
    supervisor = TaskSupervisor.from_path(tmp_path / "tasks.json", holder_id="worker")
    supervisor.start_task(task_id="task", kind="loop", owner_id="alice")
    waiting = _waiting(supervisor)
    identities = IdentityStore()
    for actor in ("alice", "bob"):
        identities.add(Identity(actor_id=actor), api_key_plaintext=f"sk-{actor}")
    app = FastAPI()
    app.include_router(
        create_task_runs_router(supervisor=supervisor, identity_store=identities, require_auth=True)
    )
    client = TestClient(app)
    body = {"approved": True, "expected_approval_version": approval_request_version(waiting)}
    url = "/api/task-runs/task/approval-decision"
    assert client.post(url, json=body).status_code == 401
    assert (
        client.post(url, json=body, headers={"Authorization": "Bearer sk-bob"}).status_code == 404
    )
    alice = {"Authorization": "Bearer sk-alice"}
    supervisor.store.mutate(
        "task",
        lambda record: record.model_copy(
            update={"metadata": {**record.metadata, "approval_tool_name": "files.delete"}},
            deep=True,
        ),
    )
    before = supervisor.store.get("task")
    assert client.post(url, json=body, headers=alice).status_code == 409
    assert supervisor.store.get("task") == before
    assert (
        client.post(
            url, json={**body, "expected_approval_version": "bad"}, headers=alice
        ).status_code
        == 422
    )
    result = client.post(
        url,
        json={**body, "expected_approval_version": approval_request_version(before)},
        headers=alice,
    )
    assert result.status_code == 200
    assert (
        result.json()["task_run"]["metadata"]["approval_decisions"][-1]["tool_name"]
        == "files.delete"
    )
