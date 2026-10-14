"""Public delegation selects installed HUB roles and executes their full policy."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from runtime.execution.agents.base import AgentRegistry
from runtime.execution.parallel_agents.stack_runner import make_stack_subagent_runner
from runtime.execution.subagents import bridge, market_bridge
from runtime.execution.subagents.registry import SubagentDefinition, SubagentRegistry
from runtime.execution.suckers import _delegation_skills_common as common


@pytest.fixture
def installed(monkeypatch):
    role = SimpleNamespace(
        agent_id="hub-health",
        display_name="健康顾问",
        soul="Installed health role instructions",
        arms=[SimpleNamespace(allowed_skills=["read_file"])],
        extra_skills=["health_skill"],
        capabilities={"execution_backend": "opencode_server"},
        model=None,
    )
    registry = AgentRegistry()
    registry.register(role)
    runner = make_stack_subagent_runner(SimpleNamespace(), agent_registry=registry)
    identity = market_bridge.MarketIdentity(
        "hub-health",
        "健康顾问",
        "/api/agents/hub-health/avatar",
        "健康研究",
        "/roles/hub-health/SOUL.md",
    )
    broken = market_bridge.MarketIdentity("broken", "Broken", "", "Invalid tool policy")
    monkeypatch.setattr(
        market_bridge, "market_identity_index", lambda: {"hub-health": identity, "broken": broken}
    )
    monkeypatch.setattr(bridge, "_RUNNER", runner)
    return role, registry, runner


def test_catalog_and_allowlist_only_include_loaded_market_roles(installed):
    from runtime.execution.suckers.agent_meta_skills import _query_skill_for_registry
    from runtime.execution.suckers.registry import Skill, SkillRegistry

    _, registry, _ = installed
    skills = SkillRegistry()
    skills.register(
        Skill(
            name="call_agent",
            description="Old cached catalog",
            trusted_source="skill://public/call_agent",
            handler=lambda: None,
        ),
        verify_tests=False,
    )
    query = _query_skill_for_registry(skills)
    assert [r["agent_id"] for r in query(name="call_agent")["installed_roles"]] == ["hub-health"]
    assert query(name="call_agent", role_id="hub-health")["installed_role_count"] == 1
    assert query(name="call_agent", role_id="missing")["installed_roles"] == []
    assert common._allowed_agent_ids() == {"hub-health"}
    catalog = common._format_role_catalog()
    assert "hub-health (健康顾问)" in catalog
    assert "researcher" not in catalog and "broken" not in catalog
    registry.remove("hub-health")
    assert query(name="call_agent")["installed_roles"] == []
    assert common._allowed_agent_ids() == set()
    assert "no runnable HUB roles" in common._format_role_catalog()


def test_market_dispatch_retains_loaded_role_over_same_named_prompt_definition(
    installed, monkeypatch
):
    role, _, runner = installed
    legacy = SubagentRegistry()
    legacy.register(
        SubagentDefinition(name=role.agent_id, description="shadow", system_prompt="Wrong prompt")
    )
    monkeypatch.setattr(bridge, "_REGISTRY", legacy)
    run = Mock(return_value="HUB_RESULT")
    monkeypatch.setattr("runtime.execution.opencode_roles.run_role_sync", run)
    result = bridge._dispatch(
        agent_id=role.agent_id,
        prompt="Read-only verification",
        context={},
        timeout_s=30,
        session=None,
        event_emitter=None,
        runner=runner,
    )
    assert result["success"] is True and result["output"] == "HUB_RESULT"
    assert result["identity_source"] == "agent-market"
    assert result["market_agent_id"] == role.agent_id
    assert run.call_args.args[1] is role
    assert run.call_args.args[1].arms == role.arms
    assert run.call_args.args[1].extra_skills == ["health_skill"]
    assert run.call_args.kwargs["context"]["subagent_scope"] == "market"

    installed[1].remove(role.agent_id)
    run.reset_mock()
    missing = bridge._dispatch(
        agent_id=role.agent_id,
        prompt="Test",
        context={"_require_installed_market_role": True},
        timeout_s=30,
        session=None,
        event_emitter=None,
        runner=runner,
    )
    assert missing["success"] is False
    assert "no substitute" in missing["error"]
    run.assert_not_called()
