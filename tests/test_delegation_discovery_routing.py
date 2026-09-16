"""A registered delegation tool must not be mistaken for a plugin package."""

from pathlib import Path
from types import SimpleNamespace

from runtime.execution.agents.loader import load_agent
from runtime.execution.suckers.agent_meta_skills import _query_skill_for_registry
from runtime.execution.suckers.capability_skills import (
    _query_capability_for_registry,
    _use_capability_for_registry,
)
from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.execution.tool_engine.host_tool_broker import HostToolBroker
from runtime.safety.approval.approval_gate import AutoDenyProvider


def test_builtin_delegation_gets_actionable_routing_without_meta_execution(monkeypatch):
    registry = SkillRegistry()
    calls = []
    registry.register(
        Skill(
            name="call_agent",
            description="Delegate one task using agent_id and prompt.",
            trusted_source="skill://public/call_agent",
            affinity=["delegation"],
            handler=lambda **args: calls.append(args),
        ),
        verify_tests=False,
    )
    monkeypatch.setattr(
        "runtime.execution.suckers.capability_skills.list_capability_entries", lambda _: []
    )
    detail = _query_skill_for_registry(registry)(name="call_agent")
    assert detail["enabled"] is True
    assert "advertised tool directly" in detail["guidance"]
    for handler in (_query_capability_for_registry, _use_capability_for_registry):
        result = handler(registry)(capability_id="call_agent")
        assert result["ok"] is False
        assert result["registered_skill"] == "call_agent"
        assert "advertised tool directly" in result["guidance"]
        assert "registered_skill" not in handler(registry)(capability_id="missing")
    assert calls == []


def test_shipped_eve_role_exposes_delegation_in_opencode_sized_catalog(tmp_path):
    root = Path(__file__).resolve().parents[1]
    agent = load_agent(root / "agents/general", None, root / "agents/shared")
    registry = SkillRegistry()
    for name in [*[f"filler_{i}" for i in range(100)], "call_agent"]:
        registry.register(
            Skill(
                name=name,
                description="Run one operation.",
                trusted_source=f"skill://public/{name}",
                handler=lambda **args: args,
            ),
            verify_tests=False,
        )
    broker = HostToolBroker(
        SimpleNamespace(executor=SimpleNamespace(registry=registry)),
        agent,
        context={},
        goal="派生 subagent 调研智能睡眠",
        outer_thread_id="delegation-test",
        outer_turn_id="turn-test",
        workspace=str(tmp_path),
        tenant_id="local",
        principal_id="tester",
        approval_provider=AutoDenyProvider(),
        is_interrupted=lambda: False,
        max_tools=64,
    )
    assert "call_agent" in broker.catalog.names
