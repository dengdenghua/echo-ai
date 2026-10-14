from __future__ import annotations

import json

import pytest

from runtime.execution.suckers import capability_skills
from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.execution.tool_spec_builder import build_anthropic_tool_specs


@pytest.fixture
def registry(monkeypatch: pytest.MonkeyPatch) -> SkillRegistry:
    monkeypatch.setattr(capability_skills, "_codex_plugin_entries", lambda _: {})
    monkeypatch.setattr(capability_skills, "_meta_skill_entries", lambda: {})
    registry = SkillRegistry()
    capability_skills.register_capability_skills(registry)
    return registry


def _add(registry: SkillRegistry, name: str, description: str, **kwargs) -> None:
    def must_not_execute(**_args):
        raise AssertionError("Discovery executed a candidate")

    registry.register(
        Skill(
            name=name,
            description=description,
            handler=must_not_execute,
            trusted_source=kwargs.pop("trusted_source", f"skill://public/{name}"),
            **kwargs,
        ),
        verify_tests=False,
    )


def _find(registry: SkillRegistry, **kwargs):
    return registry.get("find_capability").handler(**kwargs)


def test_fallback_finds_chinese_alternative_without_executing(registry):
    _add(registry, "old_export", "装配体导出 STEP")
    _add(registry, "new_export", "检查装配体，支持 STEP 导出")
    result = _find(
        registry, query="帮我导出装配体", reason="failed", failed_capabilities=["old_export"]
    )
    assert [row["id"] for row in result["candidates"]] == ["new_export"]
    assert result["search_performed"] == "local_only"


def test_failed_plugin_does_not_return_its_child_tool(registry):
    _add(registry, "cad_export", "CAD export", trusted_source="plugin://cad/export")
    result = _find(registry, query="CAD", failed_capabilities=["cad"])
    assert result["candidates"] == []


def test_failed_only_action_does_not_return_same_package(registry):
    _add(registry, "cad_export", "CAD export", trusted_source="plugin://cad/export")
    result = _find(registry, query="CAD", failed_capabilities=["cad_export"])
    assert result["candidates"] == []


def test_disabled_candidate_is_not_presented_as_usable(registry):
    _add(registry, "cad_export", "CAD export")
    registry.disable("cad_export")
    result = _find(registry, query="CAD")
    assert result["candidates"][0]["status"] == "disabled"


def test_public_search_plan_does_not_forward_private_task_or_run_web(registry):
    _add(registry, "web_search", "Search public web")
    result = _find(registry, query="private-project-9347", external_query="OpticStudio")
    external = result["external_search"]
    assert external["status"] == "suggested"
    assert len(external["next_calls"]) == 2
    assert "private-project" not in json.dumps(external)
    assert "site:github.com" in external["next_calls"][1]["arguments"]["query"]


def test_external_search_requires_explicit_public_phrase(registry):
    _add(registry, "web_search", "Search public web")
    result = _find(registry, query="private request")
    assert result["external_search"] == {"status": "needs_public_query", "next_calls": []}
    registry.disable("web_search")
    assert _find(registry, query="CAD")["external_search"]["status"] == "unavailable"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"query": ""},
        {"query": "x", "reason": "install"},
        {"query": "x", "failed_capabilities": "bad"},
        {"query": "x", "limit": "bad"},
    ],
)
def test_invalid_input_is_actionable(registry, kwargs):
    assert _find(registry, **kwargs)["ok"] is False


def test_find_survives_native_catalog_budget_and_has_parameter_schema(registry):
    specs = build_anthropic_tool_specs(registry, max_skills=0)
    spec = next(spec for spec in specs if spec.name == "find_capability")
    assert spec.input_schema["properties"]["failed_capabilities"]["type"] == "array"
    assert "query" in spec.input_schema["required"]


def test_priority_does_not_override_explicit_tool_ceiling(registry):
    specs = build_anthropic_tool_specs(registry, tool_ceiling=frozenset({"query_capability"}))
    assert "find_capability" not in {spec.name for spec in specs}


def test_successful_discovery_does_not_count_as_recovered_execution():
    from types import SimpleNamespace

    from runtime.core.cerebrum._react_execution_results import _has_unrecovered_beak_failure

    steps = [
        SimpleNamespace(
            action=SimpleNamespace(name=name),
            result=SimpleNamespace(status=status, output={"ok": status == "success"}),
        )
        for name, status in [("cad_export", "failed"), ("find_capability", "success")]
    ]
    assert _has_unrecovered_beak_failure(steps)


def test_fallback_is_available_in_real_agent_meta_registration():
    from runtime.execution.suckers.agent_meta_skills import register_agent_meta_skills

    registry = SkillRegistry()
    register_agent_meta_skills(registry)
    assert registry.has("find_capability")


def test_discovery_respects_registry_tenant_visibility(registry):
    from runtime.platform.process.session import Session, session_scope

    _add(registry, "private_cad", "CAD export", tenant_id="tenant-a")
    with session_scope(Session(metadata={"tenant_id": "tenant-b"})):
        assert _find(registry, query="CAD")["candidates"] == []


def test_tolerance_request_routes_to_authorities_even_with_local_tool(registry):
    _add(registry, "cad_tolerance", "公差工程图")
    _add(registry, "web_search", "Search public web")
    result = _find(registry, query="公差要求", external_query="未注公差")
    assert result["purpose"] == "standards"
    assert result["candidates"][0]["id"] == "cad_tolerance"
    assert result["requirements"]["status"] == "not_verified"
    searches = [call["arguments"]["query"] for call in result["external_search"]["next_calls"]]
    assert searches == ["site:std.samr.gov.cn 未注公差", "site:hbba.sacinfo.org.cn 未注公差"]
    assert not any("github.com" in query for query in searches)


@pytest.mark.parametrize(
    "family,domain", [("ISO", "iso.org"), ("ASME", "asme.org"), ("IEC", "webstore.iec.ch")]
)
def test_explicit_standard_family_overrides_discovery_default(registry, family, domain):
    result = _find(registry, query="图纸公差", purpose="standards", standard_family=family)
    assert [source["domain"] for source in result["requirements"]["sources"]] == [domain]
    assert result["external_search"]["status"] == "unavailable"
    assert result["requirements"]["status"] == "not_verified"


def test_iso_reference_is_detected_without_chinese_keyword(registry):
    result = _find(registry, query="ISO 1101")
    assert result["purpose"] == "standards"
    assert result["requirements"]["sources"][0]["domain"] == "iso.org"


def test_office_policy_starts_with_internal_documents_without_leaking_query(registry):
    _add(registry, "search_documents", "Search internal documents")
    _add(registry, "web_search", "Search public web")
    result = _find(registry, query="保密项目 A 的文件归档审批流程", external_query="电子文件归档")
    assert result["purpose"] == "office_policy"
    assert result["internal_document_calls"][0]["name"] == "search_documents"
    assert "保密项目" not in json.dumps(result["external_search"], ensure_ascii=False)
    assert "草稿" in result["requirements"]["guidance"]
    registry.disable("search_documents")
    assert _find(registry, query="审批流程")["internal_document_calls"] == []


def test_ordinary_drawing_tool_request_does_not_force_standards_search(registry):
    result = _find(registry, query="画一只猫")
    assert result["purpose"] == "capability"
    assert result["requirements"] == {}
    assert _find(registry, query="ISO 文件解压", purpose="capability")["requirements"] == {}


@pytest.mark.parametrize("kwargs", [{"purpose": "unknown"}, {"standard_family": "unknown"}])
def test_unknown_authority_options_are_rejected(registry, kwargs):
    assert _find(registry, query="公差", **kwargs)["ok"] is False


def test_fallback_guidance_reaches_real_tool_turn(registry):
    from runtime.core.cerebrum.react_prompt_contracts import SKILL_SELECTION_CONTRACT
    from runtime.execution.tool_engine.executor import ToolExecutor
    from runtime.safety.auth import TrustEngine
    from tests.test_react_loop import _CapturingRouter, _FakeStack, _intent, run_react_loop

    router = _CapturingRouter(["Final Answer: done"])
    stack = _FakeStack(router)
    stack.executor = ToolExecutor(registry, TrustEngine())
    run_react_loop(stack, _intent("查找现有插件的替代能力"), agent=None)
    system_text = str(router.requests[0].messages[0].content or "")
    assert SKILL_SELECTION_CONTRACT in system_text
