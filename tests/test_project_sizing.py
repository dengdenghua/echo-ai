import json
from types import SimpleNamespace

import pytest

from runtime.projectos.initiation import ProjectProposal, prepare_proposal
from runtime.projectos.sizing_policy import PROJECT_SIZING_POLICY


@pytest.mark.parametrize(
    "sessions,stages,explicit,expected",
    [
        (False, False, False, "task"),
        (False, True, False, "task"),
        (True, False, False, "task"),
        (True, True, False, "project"),
        (False, False, True, "project"),
    ],
)
def test_project_requires_both_duration_and_management_evidence(
    sessions, stages, explicit, expected
):
    payload = {
        "name": "交付",
        "scope": "完成交付",
        "milestones": ["交付"],
        "budget": "不适用",
        "staffing": [{"role": "执行", "responsibilities": "交付", "count": 1}],
        "sizing": "project",
        "requires_multiple_work_sessions": sessions,
        "requires_stage_management": stages,
        "explicit_project_request": explicit,
    }

    def call(request):
        if PROJECT_SIZING_POLICY not in request.messages[0].content:
            return SimpleNamespace(
                text=json.dumps(
                    {
                        "ready": False,
                        "blocking_questions": ["交付目标是什么？"],
                        "reason": "需求不足",
                    }
                )
            )
        return SimpleNamespace(text=json.dumps(payload))

    router = SimpleNamespace(call=call)
    result = prepare_proposal(
        router, model="test", goal="完成交付", leader="eve", candidates=[], previous={}
    )
    assert result["sizing"] == expected
    if expected == "task":
        rendered = ProjectProposal.model_validate(result).render({})
        assert "任务建议" in rendered
        assert "人员需求" not in rendered
        assert "AI 执行费用上限" not in rendered


def test_external_role_instructions_include_shared_project_policy():
    from runtime.execution.tool_engine.role_instructions import compose_role_instructions

    agent = SimpleNamespace(soul="Test role", agent_id="eve")
    instructions = compose_role_instructions(agent, context={}, goal="修复问题")
    assert instructions.count(PROJECT_SIZING_POLICY) == 1
