"""Exercise shared role automation through the external-engine catalog."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from runtime.core.graph_runtime import GraphRuntime
from runtime.execution.agents.loader import load_agent
from runtime.execution.suckers.browser_act_skills import register_browser_act_skills
from runtime.execution.suckers.computer_skills import register_computer_skills
from runtime.execution.suckers.registry import SkillRegistry
from runtime.execution.tool_engine.host_tool_broker import HostToolBroker


def _catalog(tmp_path, goal, *, context=None, ceiling=None, role="kane", disabled=()):
    root = Path(__file__).resolve().parents[1] / "agents"
    agent = load_agent(
        root / role,
        GraphRuntime(executor=SimpleNamespace(journal=None), journal=None),
        root / "_shared",
    )
    registry = SkillRegistry()
    register_browser_act_skills(registry)
    register_computer_skills(registry, verify_tests=False)
    for name in disabled:
        registry.disable(name)
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


_ROLES_ROOT = Path(__file__).resolve().parents[1] / "agents"
_ROLE_IDS = sorted(p.parent.name for p in _ROLES_ROOT.glob("*/profile.jsonc"))


@pytest.mark.parametrize("role", _ROLE_IDS)
def test_every_shipped_role_exposes_browser_and_desktop_tools(tmp_path, role):
    browser = _catalog(tmp_path, "帮我打开阿里云国际站", role=role)
    desktop = _catalog(tmp_path, "操作电脑完成桌面自动化", role=role)
    assert {"live_browser_navigate", "live_browser_click", "live_browser_screenshot"} <= set(
        browser
    )
    assert {"computer_observe", "computer_plan_next", "computer_execute_token"} <= set(desktop)


@pytest.mark.parametrize("registry_content", [None, {"arms": ["web_read"]}, {"arms": []}])
def test_existing_and_imported_roles_gain_automation_without_file_changes(
    tmp_path, registry_content
):
    role = tmp_path / "custom-role"
    core = role / "agent-core"
    core.mkdir(parents=True)
    (role / "profile.jsonc").write_text(json.dumps({"id": "custom-role"}), encoding="utf-8")
    path = core / "tool-registry.jsonc"
    if registry_content is not None:
        path.write_text(json.dumps(registry_content), encoding="utf-8")
    before = path.read_bytes() if path.exists() else None
    agent = load_agent(
        role,
        GraphRuntime(executor=SimpleNamespace(journal=None), journal=None),
        tmp_path / "_shared",
    )
    assert agent.can_use("browser_navigate")
    assert agent.can_use("live_browser_click")
    assert agent.can_use("computer_execute_token")
    assert (path.read_bytes() if path.exists() else None) == before
    arm_ids = [str(arm.arm_id) for arm in agent.arms]
    assert len(arm_ids) == len(set(arm_ids))


def test_shared_automation_still_respects_disabled_tools_and_task_ceiling(tmp_path):
    assert "live_browser_navigate" not in _catalog(
        tmp_path, "帮我打开阿里云国际站", role="eve", disabled=("live_browser_navigate",)
    )
    assert "computer_execute_token" not in _catalog(
        tmp_path, "电脑自动化", role="luna", ceiling=frozenset({"computer_observe"})
    )
    assert "computer_execute_token" not in _catalog(
        tmp_path, "电脑自动化", role="shion", context={"_read_only_turn_enforced": True}
    )
