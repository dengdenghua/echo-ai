"""Regression for real conversation observations rejected as desktop writes."""
from types import SimpleNamespace

import pytest

from runtime.execution.misc.skill_policy import audit_read_only_tool_denial, filter_audit_read_only_tool_specs
from runtime.execution.suckers.layers import is_read_only_skill
from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.execution.tool_engine.executor import ToolExecutor
from runtime.platform.process.session import Session, session_scope
from runtime.safety.auth import TrustEngine
from runtime.safety.approval.approval_gate import AutoApproveProvider
from runtime.sensing.gateway.tool_bridge import _execute_tool_call
from runtime.sensing.model_router.models import ToolCall

OBSERVERS = ('computer_observe', 'computer_uia_status', 'computer_uia_tree', 'computer_uia_find', 'screen_info')
WRITERS = ('computer_plan_next', 'computer_preview_action', 'computer_execute_token', 'computer_execute_plan', 'computer_click', 'computer_type', 'computer_key', 'mouse_click', 'type_text', 'press_key', 'screen_capture', 'computer_future_action')


@pytest.mark.parametrize('context', [{'_read_only_turn_enforced': True}, {'metadata': {'_read_only_turn_enforced': True}}])
def test_diagnostic_catalog_exposes_observers_but_no_actions(context):
    specs = [SimpleNamespace(name=name) for name in (*OBSERVERS, *WRITERS)]
    assert {spec.name for spec in filter_audit_read_only_tool_specs(specs, context=context)} == set(OBSERVERS)
    for name in WRITERS:
        assert audit_read_only_tool_denial(name, {}, context=context)


def test_strict_voter_keeps_private_capture_and_input_excluded():
    assert not is_read_only_skill('computer_observe')
    for name in OBSERVERS[1:]:
        assert is_read_only_skill(name)
    for name in WRITERS:
        assert not is_read_only_skill(name)


@pytest.mark.parametrize('name', OBSERVERS)
def test_gateway_executes_read_only_observation(name):
    calls = []
    registry = SkillRegistry()
    registry.register(Skill(name=name, description='Observe only', affinity=['desktop', 'automation', 'observe'], trusted_source='skill://test/'+name, handler=lambda: calls.append(name) or {'ok':True, 'observed':True}), verify_tests=False)
    stack = SimpleNamespace(executor=ToolExecutor(registry, TrustEngine()))
    # Simulate the independent user approval for desktop observation. The
    # diagnostic gate must neither block observation nor grant that approval.
    with session_scope(Session(thread_id='desktop-observation-regression', metadata={'_read_only_turn_enforced':True, '_approval_provider': AutoApproveProvider()})):
        output, failed = _execute_tool_call(stack, ToolCall(id='observe-1', name=name, input={}))
    assert not failed, output
    assert calls == [name]


def test_gateway_does_not_execute_input_in_read_only_turn():
    calls = []
    registry = SkillRegistry()
    registry.register(Skill(name='mouse_click', description='Click', affinity=['desktop', 'write'], trusted_source='skill://test/mouse_click', handler=lambda: calls.append('clicked')), verify_tests=False)
    stack = SimpleNamespace(executor=ToolExecutor(registry, TrustEngine()))
    with session_scope(Session(thread_id='desktop-observation-regression', metadata={'_read_only_turn_enforced':True})):
        output, failed = _execute_tool_call(stack, ToolCall(id='click-1', name='mouse_click', input={}))
    assert failed and 'read-only' in output
    assert calls == []
