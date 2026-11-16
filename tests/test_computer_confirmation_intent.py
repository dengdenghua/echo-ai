"""Regression for native-input confirmation being mistaken for diagnostics."""
import pytest
from runtime.core.cerebrum.todo_protocol import _is_read_only_analysis_goal
from runtime.core.cerebrum.react_explicit_reads import _explicit_read_only_goal
from runtime.execution.misc.skill_policy import audit_read_only_tool_denial

@pytest.mark.parametrize("goal", [
    "确认这三个 token，严格按顺序立即执行，逐步检查结果。",
    "立即执行，检查结果。",
    "点击按钮并检查结果。",
    "请按下回车并检查结果。",
    "Please execute and review the result.",
    "Click the button and review the result.",
])
def test_execution_with_verification_is_not_diagnostic(goal):
    assert not _is_read_only_analysis_goal(goal)
    assert not _explicit_read_only_goal(goal)

@pytest.mark.parametrize("goal", [
    "只读检查，不要执行。",
    "解释一下为什么执行失败。",
    "分析执行失败原因。",
    "不要点击，只检查结果。",
    "Explain why execute failed.",
    "Review only, do not click.",
    "分析“立即执行”的风险。",
])
def test_questions_and_prohibitions_remain_read_only(goal):
    assert _is_read_only_analysis_goal(goal) or _explicit_read_only_goal(goal)

@pytest.mark.parametrize("goal", [
    "只读检查，立即执行。",
    "不要修改文件，点击按钮并检查结果。",
    "Read-only review; execute the action.",
])
def test_explicit_read_only_contract_still_wins(goal):
    assert _explicit_read_only_goal(goal)
    assert audit_read_only_tool_denial("computer_execute_token", {},
        context={"_read_only_turn_enforced": True, "workflow_preset": "audit.review"}) is not None
