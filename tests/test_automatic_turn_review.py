"""Terminal runtime evidence reaches the existing scoped learning queue."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from runtime.memory.diagnostics.trace_store import AgentTraceStore
from runtime.memory.learning.review_queue import ReviewQueue
from runtime.protocol import Turn, TurnParams, TurnStatus
from runtime.safety.auth.scope import TenantScope, tenant_scoped_path
from runtime.sensing.gateway import _realtime_turn_learning as learning
from runtime.sensing.gateway.realtime_turn_outcome import _record_task_run_finished


@pytest.fixture(autouse=True)
def enable_capture(monkeypatch):
    monkeypatch.setattr(learning.feature_flags, "is_on", lambda name: True)


def _runtime(tmp_path):
    return SimpleNamespace(
        _trace_store=AgentTraceStore(tmp_path / "trace.sqlite"),
        _proposal_ledger_path=tmp_path / "proposal_ledger.jsonl",
    )


def _turn(status="failed", *, tenant=None, owner=None, turn_id="turn-1"):
    return Turn(
        id=turn_id,
        thread_id="thread-1",
        status=TurnStatus(status),
        task_id="stable-objective",
        execution_agent_id="coder",
        execution_engine="native",
        params=TurnParams(thread_id="thread-1", tenant_id=tenant, owner_actor_id=owner),
    )


def _seed_trace(runtime, turn, *, failed=True, scope=None):
    store = runtime._trace_store
    common = dict(task_id=turn.id, thread_id=turn.thread_id, turn_id=turn.id, scope=scope)
    store.record_task_run_started(**common, goal="fix the tool invocation")
    store.record_event(
        **common,
        event_type="TOOL_START",
        payload={"id": "call-1", "name": "exec_shell", "input": {"command": "test"}},
    )
    store.record_event(
        **common,
        event_type="TOOL_END",
        payload={
            "id": "call-1",
            "name": "exec_shell",
            "status": "failed" if failed else "success",
            "is_error": failed,
            "output": "private-output-value",
        },
    )


@pytest.mark.parametrize("failed", [True, False])
def test_terminal_evidence_is_queued_without_activating_memory(tmp_path, failed):
    runtime = _runtime(tmp_path)
    turn = _turn("failed" if failed else "completed")
    _seed_trace(runtime, turn, failed=failed)
    _record_task_run_finished(runtime, turn)
    queue_path = tmp_path / "review_queue.json"
    rows = ReviewQueue(queue_path).items()["items"]
    expected = "failure_pattern" if failed else "success_pattern"
    assert any(row["candidate_kind"] == expected for row in rows)
    assert all(row["status"] == "pending" for row in rows)
    assert all(row["source_task_ids"] == [turn.id] for row in rows)
    assert all(row["turn_ids"] == [turn.id] for row in rows)
    assert "private-output-value" not in queue_path.read_text(encoding="utf-8")
    assert not (tmp_path / "experience_ledger.json").exists()
    assert runtime._trace_store.task_run(turn.id)["status"] == turn.status.value
    assert runtime._trace_store.task_run(turn.task_id) is None


def test_recovery_and_duplicate_finalization_do_not_inflate_evidence(tmp_path):
    runtime = _runtime(tmp_path)
    turn = _turn()
    _seed_trace(runtime, turn)
    _record_task_run_finished(runtime, turn)
    queue = ReviewQueue(tmp_path / "review_queue.json")
    rows = queue.items()["items"]
    queue.decide(rows[0]["id"], action="rejected", reason="not reusable")
    _record_task_run_finished(runtime, turn, recover_stale_lease=True)
    rows_after = queue.items()["items"]
    assert len(rows_after) == len(rows)
    assert all(row["occurrences"] == 1 for row in rows_after)
    assert queue.items(status="rejected")["total"] == 1


@pytest.mark.parametrize("status", ["paused", "cancelled", "interrupted", "inProgress"])
def test_non_learning_terminal_states_are_not_failure_lessons(tmp_path, status):
    runtime = _runtime(tmp_path)
    turn = _turn(status)
    _seed_trace(runtime, turn)
    _record_task_run_finished(runtime, turn)
    assert not (tmp_path / "review_queue.json").exists()
    if status == "inProgress":
        assert runtime._trace_store.task_run(turn.id)["status"] == "running"


def test_empty_conversation_does_not_create_generic_success_noise(tmp_path):
    runtime = _runtime(tmp_path)
    _record_task_run_finished(runtime, _turn("completed"))
    assert not (tmp_path / "review_queue.json").exists()


def test_operator_can_disable_capture_without_disabling_trace(tmp_path, monkeypatch):
    monkeypatch.setattr(learning.feature_flags, "is_on", lambda name: False)
    runtime = _runtime(tmp_path)
    turn = _turn()
    _seed_trace(runtime, turn)
    _record_task_run_finished(runtime, turn)
    assert runtime._trace_store.task_run(turn.id)["status"] == "failed"
    assert not (tmp_path / "review_queue.json").exists()


def test_queue_failure_cannot_change_terminal_outcome(tmp_path, monkeypatch, caplog):
    def fail(*args, **kwargs):
        raise OSError("queue unavailable")

    monkeypatch.setattr(ReviewQueue, "add_from_task_run_review", fail)
    runtime = _runtime(tmp_path)
    turn = _turn()
    _seed_trace(runtime, turn)
    _record_task_run_finished(runtime, turn)
    assert runtime._trace_store.task_run(turn.id)["status"] == "failed"
    assert "automatic turn review skipped" in caplog.text


def test_reviews_are_partitioned_and_visible_only_to_their_owner(tmp_path):
    runtime = _runtime(tmp_path)
    scopes = [TenantScope("tenant-a", "alice"), TenantScope("tenant-a", "bob")]
    for index, scope in enumerate(scopes):
        turn = _turn(tenant=scope.tenant_id, owner=scope.actor_id, turn_id=f"turn-{index}")
        _seed_trace(runtime, turn, scope=scope)
        _record_task_run_finished(runtime, turn)
    base = tmp_path / "review_queue.json"
    assert not base.exists()
    for index, scope in enumerate(scopes):
        queue = ReviewQueue(tenant_scoped_path(base, scope))
        rows = queue.items(scope=scope)["items"]
        assert rows and all(row["source_task_ids"] == [f"turn-{index}"] for row in rows)
        assert queue.items(scope=scopes[1 - index])["total"] == 0


@pytest.mark.parametrize("tenant, owner", [("tenant-a", None), (None, "alice")])
def test_partial_identity_does_not_fall_back_to_global_learning(tmp_path, tenant, owner):
    runtime = _runtime(tmp_path)
    turn = _turn(tenant=tenant, owner=owner)
    _seed_trace(runtime, turn)
    _record_task_run_finished(runtime, turn)
    assert not (tmp_path / "review_queue.json").exists()
