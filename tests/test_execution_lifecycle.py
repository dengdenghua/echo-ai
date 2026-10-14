import time
from dataclasses import replace

import pytest

from runtime.execution.host_boundary import create_host_execution_boundary
from runtime.execution.lifecycle import ExecutionLifecycle
from runtime.execution.node_control import ExecutionNodeControl
from runtime.execution.request import current_execution_request, execution_request_scope
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.safety.approval.cancellation import OperationCancelled, current_cancellation_token


@pytest.fixture
def lifecycle(tmp_path, monkeypatch):
    store = CollaborationStore(tmp_path / "ledger")
    tracker = ExecutionLifecycle(store, heartbeat_interval_s=0.01)
    monkeypatch.setattr("runtime.execution.lifecycle._DEFAULT", tracker)
    boundary = create_host_execution_boundary(
        task_id="parent",
        thread_id="thread",
        goal="write",
        timeout_s=30,
        actor_id="alice",
        tenant_id="team",
        metadata={"mode": "code", "workspace_path": str(tmp_path)},
    )
    return tracker, boundary.request


def test_nested_engines_share_ledger_with_parentage_without_duplicate_scope(lifecycle):
    tracker, request = lifecycle
    with execution_request_scope(request), execution_request_scope(request):
        child = replace(
            request,
            task=replace(
                request.task, task_id="child", parent_task_id="parent", execution_engine="codex"
            ),
        )
        with execution_request_scope(child):
            pass
    runs = tracker.store.collaboration_runs_for_session("thread")
    assert len(runs) == 2
    indexed = {r["input"]["task_id"]: r for r in runs}
    assert indexed["child"]["parent_run_id"] == indexed["parent"]["run_id"]
    assert indexed["child"]["input"]["engine"] == "codex"
    assert all(
        r["status"] == "completed" and r["result"]["delivery_verified"] is False for r in runs
    )
    assert current_execution_request() is None


def test_engine_failure_preserves_failed_status_and_restores_context(lifecycle):
    tracker, request = lifecycle
    with pytest.raises(RuntimeError, match="driver failed"), execution_request_scope(request):
        raise RuntimeError("driver failed")
    run = tracker.store.collaboration_runs_for_session("thread")[0]
    assert run["status"] == "failed"
    assert run["error"] == "driver failed"
    assert current_execution_request() is None


def test_durable_cancel_propagates_to_live_engine(lifecycle):
    tracker, request = lifecycle
    with pytest.raises(OperationCancelled), execution_request_scope(request):
        run = tracker.store.collaboration_runs_for_session("thread")[0]
        tracker.store.transition_collaboration_run(run["run_id"], status="cancelled")
        deadline = time.monotonic() + 2
        while not current_cancellation_token().is_cancelled and time.monotonic() < deadline:
            time.sleep(0.005)
        current_cancellation_token().throw_if_cancelled()
    assert tracker.store.collaboration_runs_for_session("thread")[0]["status"] == "cancelled"


def test_expired_invocation_is_interrupted_never_replayed(lifecycle, monkeypatch):
    from datetime import UTC, datetime, timedelta

    tracker, request = lifecycle
    store = tracker.store
    store.create_collaboration_run(
        run_id="crashed",
        session_id="thread",
        kind="engine_invocation",
        input={"actor_id": "alice", "tenant_id": "team"},
    )
    store.claim_collaboration_run("crashed", worker_id="dead", lease_seconds=5)
    monkeypatch.setattr(
        "runtime.memory.cowork.collaboration_runs._now",
        lambda: datetime.now(UTC) + timedelta(seconds=10),
    )
    control = ExecutionNodeControl(store)
    assert (
        control.runs(tenant_id="team", actor_id="alice", kind="engine_invocation")[0]["status"]
        == "interrupted"
    )
    assert (
        control.pending(
            tenant_id="team", node={"node_id": "device", "workspace_ids": [], "roles": []}
        )
        == []
    )
