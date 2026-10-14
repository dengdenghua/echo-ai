"""Real engine calls stop on revocation, changed scope or unknown spending."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from runtime.platform.models import CostEntry
from runtime.projectos.engine import ProjectEngine
from runtime.projectos.governance import phase_fingerprint, reported_cost
from runtime.projectos.llm_hooks import llm_decompose_tasks, spec_qa
from runtime.projectos.model import Task
from runtime.projectos.standing_execution import run_reviewed_project
from runtime.projectos.standing_review import revoke_reviewed_authorization
from runtime.safety.approval.cancellation import OperationCancelled
from runtime.sensing.model_router import ModelResponse
from tests.test_standing_review import OWNER, _confirm, _review, _store


def _engine(tmp_path, *, tasks=True, decompose=None, execute=None, qa=None):
    store, milestone = _store(tmp_path)
    milestone.spec["requires_owner_acceptance"] = True
    store.save_milestone("P", milestone)
    store.append_event(
        "P", kind="project.phase_authorized", payload={"fingerprint": phase_fingerprint(milestone)}
    )
    if tasks:
        for i in range(2):
            store.save_task(
                Task(
                    id=f"T{i}",
                    type="code",
                    milestone_id="M",
                    goal="produce artifact",
                    assigned_agent="eve",
                )
            )
    grant = _confirm(store, _review(store))
    seen = []

    def default_execute(task, context):
        seen.append(task.id)
        context["record_project_usage"]({"governance": {"root_id": task.id, "cost_usd": 0.1}})
        return "artifact"

    engine = ProjectEngine(
        store,
        generate_milestones=lambda _: [],
        decompose_tasks=decompose or (lambda _: []),
        execute_task=execute or default_execute,
        qa_task=qa or (lambda *_: {"approved": True}),
        assign_agent=lambda _: "eve",
        owner_id="alice",
        tenant_id="a",
    )
    return engine, store, milestone, grant, seen


def _run(engine, grant, validator=lambda: True):
    return run_reviewed_project(
        engine, "P", **OWNER, grant_id=grant["grant_id"], validate_identity=validator
    )


def test_real_engine_finishes_tasks_but_never_accepts_owner_delivery(tmp_path):
    engine, store, _, grant, seen = _engine(tmp_path)
    result = _run(engine, grant)
    assert seen == ["T0", "T1"]
    assert result["final_status"] == "running"
    assert all(task.status == "done" for task in store.tasks_for_milestone("M"))
    assert any(
        event.startswith("awaiting_owner_acceptance:")
        for tick in result["history"]
        for event in tick["events"]
    )
    assert not any(e["kind"] == "project.owner_accepted" for e in store.events_for_project("P"))


@pytest.mark.parametrize("change", ["revoke", "budget", "missing", "plan", "identity"])
def test_pause_after_first_output_preserves_artifact_refunds_attempt_and_never_calls_qa(
    tmp_path, change
):
    qa_calls = []
    valid = [True]
    engine, store, milestone, grant, _ = _engine(tmp_path, qa=lambda *_: qa_calls.append(True))
    executed = []

    def execute(task, context):
        executed.append(task.id)
        if change != "missing":
            context["record_project_usage"](
                {
                    "governance": {
                        "root_id": task.id,
                        "cost_usd": 3.0 if change == "budget" else 0.1,
                    }
                }
            )
        if change == "revoke":
            revoke_reviewed_authorization(store, "P", **OWNER)
        elif change == "plan":
            current = store.get_milestone(milestone.id)
            current.goal = "different phase"
            store.save_milestone("P", current)
        elif change == "identity":
            valid[0] = False
        return "preserved deliverable"

    engine._execute = execute
    with pytest.raises(OperationCancelled):
        _run(engine, grant, lambda: valid[0])
    task = store.get_task("T0")
    assert task.output == "preserved deliverable"
    assert task.status == "pending" and task.attempts == 0
    assert task.qa_verdict["review_error"] is True
    assert executed == ["T0"] and qa_calls == []
    assert store.get_task("T1").attempts == 0


def test_changed_phase_or_revoked_identity_denies_before_mutating_execution(tmp_path):
    engine, store, milestone, grant, seen = _engine(tmp_path)
    with pytest.raises(OperationCancelled):
        _run(engine, grant, lambda: False)
    assert not seen and store.get_task("T0").attempts == 0
    # Use a fresh dedicated engine, as production does for each grant job.
    other, other_store, other_ms, other_grant, other_seen = _engine(tmp_path / "other")
    other_ms.goal = "unreviewed"
    other_store.save_milestone("P", other_ms)
    with pytest.raises(OperationCancelled):
        _run(other, other_grant)
    assert not other_seen and other_store.get_task("T0").attempts == 0


def test_direct_decomposition_and_qa_models_report_costs_under_actual_engine(tmp_path):
    replies = ['[{"id":"T1","goal":"artifact","type":"code"}]', '{"approved":true,"reason":"okay"}']
    router = SimpleNamespace(
        call=lambda _: ModelResponse(text=replies.pop(0), cost=CostEntry(usd=0.2))
    )
    engine, store, milestone, grant, seen = _engine(
        tmp_path, tasks=False, decompose=llm_decompose_tasks(router), qa=spec_qa(router)
    )
    milestone.success_criteria = ["artifact"]
    store.save_milestone("P", milestone)
    store.append_event(
        "P", kind="project.phase_authorized", payload={"fingerprint": phase_fingerprint(milestone)}
    )
    grant = _confirm(store, _review(store))
    result = _run(engine, grant)
    assert seen == ["M-T1"] and result["final_status"] == "running"
    assert reported_cost(store, "P") == pytest.approx(0.5)
    assert replies == []


def test_decomposition_retry_cannot_cross_grant_budget_and_releases_own_claim(tmp_path):
    calls = []

    def model(_):
        calls.append(True)
        return ModelResponse(text="[]", cost=CostEntry(usd=3.0))

    engine, store, _, grant, seen = _engine(
        tmp_path, tasks=False, decompose=llm_decompose_tasks(SimpleNamespace(call=model))
    )
    with pytest.raises(OperationCancelled):
        _run(engine, grant)
    assert calls == [True] and seen == []
    assert store.get_project("P").status == "running"
    assert store.get_milestone("M").status != "blocked"
    with store._conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM milestone_claims").fetchone()[0] == 0
    assert any(e["kind"] == "project.decompose_interrupted" for e in store.events_for_project("P"))


def test_default_zero_model_cost_is_unknown_and_prevents_task_execution(tmp_path):
    router = SimpleNamespace(call=lambda _: ModelResponse(text='[{"id":"T1","goal":"artifact"}]'))
    engine, store, _, grant, seen = _engine(
        tmp_path, tasks=False, decompose=llm_decompose_tasks(router)
    )
    result = _run(engine, grant)
    assert seen == [] and result["final_status"] == "running"
    assert any(
        event.startswith("project_budget_paused:")
        for tick in result["history"]
        for event in tick["events"]
    )
    assert any(e["kind"] == "project.usage_missing" for e in store.events_for_project("P"))
