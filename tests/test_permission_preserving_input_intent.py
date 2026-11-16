"""Preserving approval settings must not turn authorized input into a read-only task."""
from types import SimpleNamespace

import pytest

from runtime.core.cerebrum.react_explicit_reads import _explicit_read_only_goal
from runtime.core.cerebrum.todo_protocol import _is_read_only_analysis_goal
from runtime.execution.misc.skill_policy import (
    audit_read_only_tool_denial,
    filter_tool_specs_for_workspace_contract,
    goal_is_read_only,
)
from runtime.platform.models import ParsedIntent
from runtime.protocol import Turn
from runtime.sensing.gateway.realtime_execution_context import RealtimeExecutionContext


@pytest.mark.parametrize('goal', [
    '点击测试编辑器，不更改权限。',
    '在指定记事本输入中文；不要修改访问权限。',
    '请按下回车，不要更新权限设置。',
    '输入测试文字，禁止调整审批模式。',
    'Click the test editor; do not change permissions.',
    'Type Chinese in the named editor; never modify access permissions.',
])
def test_permission_preservation_is_not_a_global_read_only_request(goal):
    assert not _explicit_read_only_goal(goal)
    assert not _is_read_only_analysis_goal(goal)
    assert not goal_is_read_only(goal)
    specs = [SimpleNamespace(name='computer_execute_token')]
    actual, mode = filter_tool_specs_for_workspace_contract(specs, goal)
    assert actual == specs and mode is None
    # A trusted explicit read-only boundary still denies execution regardless
    # of wording. This change grants no approvals and changes no permission mode.
    assert audit_read_only_tool_denial('computer_execute_token', {},
        context={'_read_only_turn_enforced': True}) is not None


@pytest.mark.parametrize('goal', [
    '只读检查窗口，不更改权限。',
    '不要修改任何文件；不要修改权限。',
    '不要修改权限文件。',
    '不要修改权限和项目文件。',
    'Read-only review; do not change permissions.',
    'Do not modify any files; do not change permissions.',
    'Do not modify permissions.json.',
    'Do not modify permissions or files.',
])
def test_global_and_file_prohibitions_remain_enforced(goal):
    assert _explicit_read_only_goal(goal)
    assert goal_is_read_only(goal)


@pytest.mark.parametrize('read_only', [False, True])
def test_realtime_context_preserves_actual_permissions_and_authorization(tmp_path, read_only):
    goal = ('只读检查窗口' if read_only else '点击测试记事本编辑器并输入中文') + '，不更改权限。'
    turn = Turn(threadId='permission-preserving-input')
    turn.execution_workspace_path = str(tmp_path)
    intent = ParsedIntent(raw=goal, normalized_goal=goal, intent_type='task',
        user_context={'mode': 'code', 'workspace_path': str(tmp_path), 'permission_mode': 'default'})
    context = RealtimeExecutionContext()
    context._initialize(object(), turn, object(), intent)
    assert bool(context.session.metadata.get('_read_only_turn_enforced')) is read_only
    assert context.task.authorization_intent == goal
    assert context.task.permissions.permission_mode == 'default'
    assert context.task.permissions.approval_policy == 'on-request'


@pytest.mark.parametrize('context', [
    {'_read_only_turn_enforced': True},
    {'metadata': {'_read_only_turn_enforced': True}},
])
def test_trusted_read_only_scope_filters_execution_even_without_audit_workflow(context):
    specs = [SimpleNamespace(name=name) for name in ('computer_execute_token', 'read_file')]
    filtered, mode = filter_tool_specs_for_workspace_contract(
        specs, '点击测试编辑器，不更改权限。', user_context=context)
    assert mode == 'read_only'
    assert [spec.name for spec in filtered] == ['read_file']
    assert audit_read_only_tool_denial('computer_execute_token', {}, context=context)
