import pytest

from runtime.projectos.engine import MAX_TASK_ATTEMPTS
from runtime.safety.approval.cancellation import (
    CancellationSource,
    OperationCancelled,
    scoped_cancellation,
)
from tests.test_project_execution_claims import engine, setup_project


@pytest.mark.parametrize("stage", ["assignment", "execute", "execute_return", "qa", "qa_return"])
def test_pause_at_retry_limit_refunds_only_current_claim(tmp_path, stage):
    store, project, milestone = setup_project(tmp_path)
    task = store.get_task("T")
    task.attempts = MAX_TASK_ATTEMPTS - 1
    store.save_task(task)
    source = CancellationSource()
    executed = []

    def stop():
        source.cancel(reason="operator paused")
        source.token.throw_if_cancelled()

    def execute(*_):
        executed.append(True)
        if stage == "execute":
            stop()
        if stage == "execute_return":
            source.cancel(reason="operator paused")
        return "deliverable"

    def qa(*_):
        if stage == "qa":
            stop()
        if stage == "qa_return":
            source.cancel(reason="operator paused")
        return {"approved": True}

    runner = engine(store, execute, qa)
    if stage == "assignment":
        runner._assign = lambda _: stop()
    events = []
    with scoped_cancellation(source.token), pytest.raises(OperationCancelled):
        runner._run_frontier(project, milestone, events)
    paused = store.get_task("T")
    assert paused.status == "pending"
    assert paused.attempts == MAX_TASK_ATTEMPTS - 1
    assert events == ["task_interrupted:T"]
    assert store.assert_no_active_claims("P").id == "P"
    produced = stage in {"execute_return", "qa", "qa_return"}
    assert paused.output == ("deliverable" if produced else None)
    assert bool((paused.qa_verdict or {}).get("review_error")) == produced

    # Continue with a new token: completed output goes through QA, never execution again.
    resumed = []
    engine(store, lambda *_: resumed.append(True) or "new deliverable")._run_frontier(
        project, milestone, []
    )
    assert len(resumed) == int(not produced)
    assert store.get_task("T").status == "done"
    assert store.get_task("T").attempts == MAX_TASK_ATTEMPTS


def test_repeated_pauses_do_not_exhaust_retries(tmp_path):
    store, project, milestone = setup_project(tmp_path)
    for _ in range(MAX_TASK_ATTEMPTS + 2):
        source = CancellationSource()

        def execute(*_, source=source):
            source.cancel(reason="operator paused")
            source.token.throw_if_cancelled()

        with scoped_cancellation(source.token), pytest.raises(OperationCancelled):
            engine(store, execute)._run_frontier(project, milestone, [])
        assert store.get_task("T").attempts == 0

    # Real execution failures still consume the bounded retry budget.
    def fail(*_):
        raise RuntimeError("execution failed")

    for _ in range(MAX_TASK_ATTEMPTS):
        engine(store, fail)._run_frontier(project, milestone, [])
    assert store.get_task("T").status == "failed"
    assert store.get_task("T").attempts == MAX_TASK_ATTEMPTS


def test_obsolete_pause_cannot_refund_replacement_claim(tmp_path):
    store, _, _ = setup_project(tmp_path)
    old, old_id = store.claim_task("T")
    old.status = "pending"
    assert store.finalize_task_claim(old, old_id, interrupted=True)[1]
    new, new_id = store.claim_task("T")
    assert not store.finalize_task_claim(old, old_id, interrupted=True)[1]
    assert store.get_task("T").status == "running"
    assert store.get_task("T").attempts == 1
    new.status = "pending"
    assert store.finalize_task_claim(new, new_id, interrupted=True)[1]
    assert not store.finalize_task_claim(new, new_id, interrupted=True)[1]
    assert store.get_task("T").attempts == 0


def test_pause_cannot_publish_approval_or_refund_expired_claim(tmp_path):
    store, _, _ = setup_project(tmp_path)
    task, claim_id = store.claim_task("T")
    task.status = "done"
    with pytest.raises(ValueError, match="pending and unapproved"):
        store.finalize_task_claim(task, claim_id, interrupted=True)
    task.status = "pending"
    with store._lock, store._conn() as conn:
        conn.execute("UPDATE task_claims SET claimed_at=0")
    assert not store.finalize_task_claim(task, claim_id, stale_before=1, interrupted=True)[1]
    assert store.get_task("T").attempts == 1


def test_pausing_qa_retry_preserves_the_previous_deliverable(tmp_path):
    store, project, milestone = setup_project(tmp_path)
    task = store.get_task("T")
    task.output = "previous deliverable"
    task.qa_verdict = {"approved": False, "review_error": True}
    store.save_task(task)
    source = CancellationSource()
    runner = engine(store, lambda *_: pytest.fail("QA retry repeated execution"))

    def assign(_):
        source.cancel(reason="operator paused")
        return "engineer"

    runner._assign = assign
    with scoped_cancellation(source.token), pytest.raises(OperationCancelled):
        runner._run_frontier(project, milestone, [])
    assert store.get_task("T").output == "previous deliverable"
    assert store.get_task("T").attempts == 0
    engine(store, lambda *_: pytest.fail("QA retry repeated execution"))._run_frontier(
        project, milestone, []
    )
    assert store.get_task("T").status == "done"
