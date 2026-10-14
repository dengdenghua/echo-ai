from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest

from runtime.core.cerebrum.react_types import ReActResult
from runtime.execution.loops.controller import LoopController
from runtime.execution.loops.models import LoopMode, LoopPolicy, LoopRun, LoopRunStatus
from runtime.execution.loops.store import LoopRunStore
from runtime.platform.process.task_supervisor import TaskLeaseConflict, TaskSupervisor
from runtime.platform.runtime_policy.workspaces import WorkspaceManager


def test_long_loop_attempt_renews_supervisor_lease(tmp_path, monkeypatch) -> None:
    from runtime.platform.process import _task_supervisor_models, task_supervisor

    # Keep the real heartbeat thread and store, but advance only lease time.
    clock = SimpleNamespace(now=1000.0)
    authority_time = SimpleNamespace(time=lambda: clock.now)
    monkeypatch.setattr(task_supervisor, "time", authority_time)
    monkeypatch.setattr(_task_supervisor_models, "time", authority_time)
    store = LoopRunStore(tmp_path / "loop_runs.json")
    task_runs = tmp_path / "task_runs.json"
    supervisor = TaskSupervisor.from_path(
        task_runs,
        holder_id="loop-worker-a",
        lease_ttl_seconds=1.0,
    )
    contender = TaskSupervisor.from_path(
        task_runs,
        holder_id="loop-worker-b",
        lease_ttl_seconds=1.0,
    )
    run = LoopRun(
        owner_id="alice",
        goal="hold the lease during a long attempt",
        mode=LoopMode.PLAN,
        policy=LoopPolicy(max_attempts=1, max_iterations=1),
    )
    store.create(run)
    started = threading.Event()
    release = threading.Event()
    renewed = threading.Event()
    heartbeat = supervisor.heartbeat

    def observe_heartbeat(*args, **kwargs):
        record = heartbeat(*args, **kwargs)
        if record.lease is not None and record.lease.expires_at > 1001.0:
            renewed.set()
        return record

    monkeypatch.setattr(supervisor, "heartbeat", observe_heartbeat)

    def runner(*, stack, intent, agent, model=None, max_iterations=0, thread_id=None):
        started.set()
        assert release.wait(timeout=30), "The test must release its attempt"
        return ReActResult(final_answer="done", success=True)

    controller = LoopController(
        store=store,
        stack=SimpleNamespace(name="stack"),
        workspace_manager=WorkspaceManager(tmp_path / "workspaces"),
        task_supervisor=supervisor,
        react_runner=runner,
    )
    result: dict[str, object] = {}
    worker = threading.Thread(
        target=lambda: result.setdefault("run", controller.execute(run.run_id))
    )
    worker.start()
    try:
        assert started.wait(timeout=10)
        original = supervisor.store.get(run.run_id)
        assert original is not None and original.lease is not None
        assert original.lease.expires_at == 1001.0
        clock.now = 1000.6
        assert renewed.wait(timeout=10), "The running attempt must renew its lease"
        clock.now = 1001.1
        current = supervisor.store.get(run.run_id)
        assert current is not None and current.lease is not None
        assert current.lease.expires_at > clock.now > original.lease.expires_at
        assert worker.is_alive()
        with pytest.raises(TaskLeaseConflict):
            contender.start_task(task_id=run.run_id, kind="loop")
    finally:
        release.set()
        worker.join(timeout=15)
    assert not worker.is_alive()
    assert result["run"].status == LoopRunStatus.COMPLETED  # type: ignore[union-attr]
