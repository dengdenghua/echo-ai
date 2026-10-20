"""Exercise the shipped Kane bindings through the external-engine catalog."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from runtime.core.graph_runtime import GraphRuntime
from runtime.execution.agents.loader import load_agent
from runtime.execution.suckers.browser_act_skills import register_browser_act_skills
from runtime.execution.suckers.computer_skills import register_computer_skills
from runtime.execution.suckers.registry import SkillRegistry
from runtime.execution.tool_engine.host_tool_broker import HostToolBroker


def _catalog(tmp_path, goal, *, context=None, ceiling=None):
    root = Path(__file__).resolve().parents[1] / "agents"
    agent = load_agent(
        root / "kane",
        GraphRuntime(executor=SimpleNamespace(journal=None), journal=None),
        root / "_shared",
    )
    registry = SkillRegistry()
    register_browser_act_skills(registry)
    register_computer_skills(registry, verify_tests=False)
    return HostToolBroker(
        SimpleNamespace(executor=SimpleNamespace(registry=registry)),
        agent,
        context=context or {},
        goal=goal,
        outer_thread_id="test",
        outer_turn_id="turn",
        workspace=str(tmp_path),
        tenant_id=None,
        principal_id="local:owner",
        approval_provider=None,
        is_interrupted=lambda: False,
        max_tools=64,
        tool_ceiling=ceiling,
    ).catalog.names


@pytest.mark.parametrize(
    "goal",
    [
        "帮我打开阿里云国际站 打开我的服务器",
        "Open https://example.com in the browser",
    ],
)
def test_shipped_kane_exposes_native_browser_tools(tmp_path, goal):
    names = _catalog(tmp_path, goal)
    assert {
        "live_browser_navigate",
        "live_browser_state",
        "live_browser_screenshot",
        "live_browser_click",
    } <= set(names)


def test_continue_retains_recent_human_browser_request(tmp_path):
    names = _catalog(
        tmp_path,
        "继续",
        context={
            "conversation_messages": [
                {"role": "user", "content": "帮我打开阿里云国际站"},
                {"role": "assistant", "content": "正在打开"},
            ]
        },
    )
    assert "live_browser_navigate" in names


def test_shipped_kane_exposes_desktop_observation_and_execution(tmp_path):
    names = _catalog(tmp_path, "你可以电脑自动化么")
    assert {
        "computer_observe",
        "computer_plan_next",
        "computer_execute_token",
        "computer_uia_find",
    } <= set(names)


def test_plain_research_and_task_ceiling_do_not_gain_browser_controls(tmp_path):
    assert "live_browser_navigate" not in _catalog(tmp_path, "调研服务器价格")
    assert "live_browser_navigate" not in _catalog(
        tmp_path, "帮我打开阿里云国际站", ceiling=frozenset({"computer_observe"})
    )
