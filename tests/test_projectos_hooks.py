"""Project OS LLM hooks: tolerant JSON parsers + deterministic QA (no LLM)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from runtime.projectos.llm_hooks import (
    _criterion_touched,
    _extract_json_array,
    parse_milestones,
    parse_tasks,
    spec_qa,
    subagent_execute_task,
)
from runtime.projectos.model import Milestone, Task


def test_extract_json_array_handles_fences_and_prose() -> None:
    assert _extract_json_array('```json\n[{"a":1}]\n```') == [{"a": 1}]
    assert _extract_json_array('here you go: [{"a":1}] done') == [{"a": 1}]
    assert _extract_json_array("no json here") == []
    assert _extract_json_array('{"not":"array"}') == []


def test_task_dependencies_resolve_model_ids_and_short_ids():
    tasks = parse_tasks(
        '[{"id":"draft","goal":"Write"},'
        '{"id":"review","goal":"Review","depends_on":["draft"]},'
        '{"goal":"Revise","depends_on":["T2"]}]',
        "MS",
    )
    assert tasks[1].depends_on == ["MS-T1"]
    assert tasks[2].depends_on == ["MS-T2"]


@pytest.mark.parametrize(
    "reply",
    [
        '[{"goal":"Review","depends_on":["missing"]}]',
        '[{"goal":"Review","depends_on":["T1"]}]',
        "[]",
        "invalid JSON",
    ],
)
def test_invalid_decomposition_never_falls_back_to_executable_task(reply):
    from runtime.projectos.llm_hooks import llm_decompose_tasks

    router = SimpleNamespace(call=lambda _: SimpleNamespace(text=reply))
    with pytest.raises((RuntimeError, ValueError)):
        llm_decompose_tasks(router)(Milestone(id="MS", name="M", goal="review"))


def test_parse_milestones_assigns_ids_and_resolves_deps() -> None:
    text = """[
      {"name":"Scope","goal":"scope it","success_criteria":["approved"]},
      {"name":"Build","goal":"build it","dependencies":["Scope"]},
      {"name":"Verify","goal":"verify","dependencies":["Build","Ghost"]}
    ]"""
    ms = parse_milestones(text)
    assert [m.id for m in ms] == ["MS1", "MS2", "MS3"]
    assert ms[1].dependencies == ["MS1"]  # "Scope" → MS1
    assert ms[2].dependencies == ["MS2"]  # "Build" → MS2; unknown "Ghost" dropped
    assert ms[0].success_criteria == ["approved"]


def test_decomposition_repairs_bad_dependency_once():
    from runtime.projectos.llm_hooks import llm_decompose_tasks

    seen = []
    responses = iter([
        '[{"goal":"Draft"},{"goal":"Review","depends_on":["missing"]}]',
        '[{"id":"T1","goal":"Draft"},{"id":"T2","goal":"Review","depends_on":["T1"]}]',
    ])
    def call(request):
        seen.append(request)
        return SimpleNamespace(text=next(responses))
    tasks = llm_decompose_tasks(SimpleNamespace(call=call))(Milestone(id="M", name="M", goal="deliver"))
    assert len(seen) == 2
    assert tasks[1].depends_on == [tasks[0].id]
    assert "failed validation" in seen[1].messages[0].content


def test_decomposition_repair_is_bounded():
    from runtime.projectos.llm_hooks import llm_decompose_tasks

    seen = []
    def call(request):
        seen.append(request)
        return SimpleNamespace(text='[{"id":"T1","goal":"Draft","depends_on":["T1"]}]')
    with pytest.raises(ValueError, match="自动修正后仍无效"):
        llm_decompose_tasks(SimpleNamespace(call=call))(Milestone(id="M", name="M", goal="deliver"))
    assert len(seen) == 2


def test_parse_milestones_empty_on_garbage() -> None:
    assert parse_milestones("the model refused") == []


def test_parse_tasks_resolves_dag_deps() -> None:
    text = """[
      {"type":"research","goal":"survey"},
      {"type":"code","goal":"implement","depends_on":["survey"]},
      {"type":"review","goal":"check","depends_on":["2"]}
    ]"""
    tasks = parse_tasks(text, "MS1")
    assert [t.id for t in tasks] == ["MS1-T1", "MS1-T2", "MS1-T3"]
    assert tasks[1].depends_on == ["MS1-T1"]  # by goal name
    assert tasks[2].depends_on == ["MS1-T2"]  # by index "2"
    assert tasks[0].assigned_role == "research"  # role routed from type


def test_criterion_touched() -> None:
    assert _criterion_touched("power under 5W", "the power draw is 4W") is True
    assert _criterion_touched("心率监测", "已实现心率监测模块") is True
    assert _criterion_touched("latency under 100ms", "we shipped a UI") is False


def test_spec_qa_deterministic_without_router() -> None:
    qa = spec_qa(router=None)
    ms = Milestone(id="MS1", name="m", goal="g", success_criteria=["power under 5W"])
    t_ok = Task(id="T", milestone_id="MS1", type="code", goal="g", output="power is 4W, good")
    t_bad = Task(id="T", milestone_id="MS1", type="code", goal="g", output="did something else")
    t_empty = Task(id="T", milestone_id="MS1", type="code", goal="g", output="")
    assert qa(t_ok, ms)["approved"] is True
    assert qa(t_bad, ms)["approved"] is False
    assert qa(t_empty, ms)["approved"] is False


@pytest.mark.parametrize("text", ['{"approved":"false"}', "{}", "unavailable", "[]"])
def test_qa_malformed_response_never_approves(text):
    qa = spec_qa(SimpleNamespace(call=lambda _: SimpleNamespace(text=text)))
    with pytest.raises(RuntimeError, match="质量检查未完成"):
        qa(
            Task(id="T", milestone_id="M", type="analysis", goal="g", output="draft"),
            Milestone(id="M", name="m", goal="g", success_criteria=["verified evidence"]),
        )


def test_qa_provider_failure_never_approves():
    def fail(_):
        raise ConnectionError("provider offline")

    qa = spec_qa(SimpleNamespace(call=fail))
    with pytest.raises(RuntimeError, match="质量检查未完成"):
        qa(
            Task(id="T", milestone_id="M", type="analysis", goal="g", output="draft"),
            Milestone(id="M", name="m", goal="g", success_criteria=["verified evidence"]),
        )


def test_subagent_execute_task_propagates_project_scope(monkeypatch) -> None:
    captured: dict = {}

    def fake_call_subagent(agent_id, prompt, **kwargs):
        captured.update({"agent_id": agent_id, "prompt": prompt, **kwargs})
        return {"success": True, "output": "shipped"}

    monkeypatch.setattr("runtime.execution.subagents.call_subagent", fake_call_subagent)
    task = Task(
        id="T1",
        milestone_id="MS1",
        type="code",
        goal="implement",
        assigned_agent="engineer",
    )

    output = subagent_execute_task(
        task,
        {
            "project_id": "P1",
            "owner_id": "alice",
            "tenant_id": "acme",
            "thread_id": "thread-1",
            "milestone_goal": "deliver",
            "project_goal": "Do not publish externally",
            "prerequisite_outputs": {"M0": {"T0": "Approved product positioning"}},
            "workspace_path": "/managed/thread-1",
            "runtime_session_metadata": {
                "workspace_path": "/managed/thread-1",
                "_artifact_output_root": "/managed/thread-1/output/final",
            },
        },
    )

    assert output == "shipped"
    assert "Do not publish externally" in captured["prompt"]
    assert "Approved product positioning" in captured["prompt"]
    assert captured["agent_id"] == "engineer"
    assert captured["context"]["thread_id"] == "thread-1"
    assert captured["context"]["actor"] == "alice"
    assert captured["context"]["workspace_path"] == "/managed/thread-1"
    assert captured["context"]["runtime_session_metadata"] == {
        "source": "projectos_task",
        "project_id": "P1",
        "tenant_id": "acme",
        "mode": "code",
        "workspace_path": "/managed/thread-1",
        "_artifact_output_root": "/managed/thread-1/output/final",
    }
    from runtime.execution.subagents.execution_context import parent_execution_task

    host_task = parent_execution_task(captured["session"])
    assert host_task is not None
    assert host_task.thread_id == "thread-1"
    assert host_task.actor_id == "alice"
    assert host_task.tenant_id == "acme"
    assert host_task.goal == captured["prompt"]
    assert 0 < host_task.resources.remaining_seconds() <= 900


def test_local_project_worker_keeps_absent_tenant_identity(monkeypatch):
    from runtime.execution.host_boundary import create_host_execution_boundary
    from runtime.platform.process.session import session_scope

    boundary = create_host_execution_boundary(task_id="local-project", thread_id="local-thread", goal="verify", timeout_s=60)

    def execute(_agent, _prompt, **kwargs):
        session = kwargs["session"]
        assert session.metadata["_execution_task"].tenant_id is None
        assert session.metadata.get("tenant_id") is None
        return {"success": True, "output": "verified"}

    monkeypatch.setattr("runtime.execution.subagents.call_subagent", execute)
    with session_scope(boundary.session):
        assert subagent_execute_task(
            Task(id="T", milestone_id="M", type="analysis", goal="verify"),
            {"thread_id": "local-thread", "tenant_id": "", "owner_id": ""},
        ) == "verified"
