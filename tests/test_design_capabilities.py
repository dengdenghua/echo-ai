from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.core.cerebrum.capability_router import activate_capabilities, order_skill_names
from runtime.core.cerebrum.design_capabilities import design_instructions, resolve_design_plan
from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.execution.tool_engine.role_instructions import compose_role_instructions
from runtime.execution.tool_spec_builder import build_anthropic_tool_specs
from runtime.sensing.gateway.design_studio_router import create_design_studio_router


def registry():
    reg = SkillRegistry()
    for name in (
        "unrelated",
        "frontend-ui-engineering",
        "webapp-building",
        "presentations",
        "creative-visual-direction",
        "generate_image",
        "query_skill",
    ):
        reg.register(Skill(name=name, trusted_source=f"skill://public/{name}", handler=lambda: {}))
    reg.register(
        Skill(
            name="comfyui_bridge.status",
            trusted_source="plugin://comfyui_bridge",
            affinity=["design"],
            handler=lambda: {},
        )
    )
    return reg


def context(**prefs):
    return {"agent_mode": "uxui", "design_capabilities": prefs}


def test_idle_design_does_not_select_every_skill_or_plugin():
    plan = resolve_design_plan("", context=context(), registry=registry())
    assert plan["ready"]
    assert plan["skills"] == plan["plugins"] == plan["tools"] == []


def test_explicit_then_task_skills_precede_other_tools():
    reg = registry()
    goal = "@skill:presentations 设计网页"
    activation = activate_capabilities(goal, user_context=context(), registry=reg)
    ordered = order_skill_names(reg.all_names(), activation=activation, registry=reg)
    assert ordered[:3] == ["presentations", "frontend-ui-engineering", "webapp-building"]
    specs = build_anthropic_tool_specs(reg, max_skills=2, goal=goal, user_context=context())
    assert [spec.name for spec in specs][:3] == ordered[:3]


def test_general_mode_does_not_force_design_pack():
    reg = registry()
    assert design_instructions("设计网页", context={"agent_mode": "develop"}, registry=reg) == ""


def test_turn_metadata_restores_preferences_and_clears_them_outside_design():
    from runtime.sensing.gateway.turn_session import build_turn_metadata

    prefs = {"mode": "manual", "skills": ["presentations"], "plugins": []}
    store = SimpleNamespace(
        get=lambda _: {"metadata": {"agent_mode": "uxui", "design_capabilities": prefs}}
    )
    restored = build_turn_metadata(
        thread_id="design", body={"context": {"agent_mode": "uxui"}}, store=store
    )
    assert restored["design_capabilities"] == prefs
    general = build_turn_metadata(
        thread_id="design", body={"context": {"agent_mode": "develop"}}, store=store
    )
    assert "design_capabilities" not in general


def test_manual_selection_resolves_real_plugin_tools_and_rechecks_disabling():
    reg = registry()
    ctx = context(mode="manual", skills=["presentations"], plugins=["comfyui_bridge"])
    plan = resolve_design_plan("设计网页", context=ctx, registry=reg)
    assert plan["skills"] == ["presentations"]
    assert plan["tools"] == ["comfyui_bridge.status"]
    reg.set_enabled("comfyui_bridge.status", False)
    assert not resolve_design_plan("设计网页", context=ctx, registry=reg)["ready"]
    with pytest.raises(ValueError, match="设计能力检查未通过"):
        design_instructions("设计网页", context=ctx, registry=reg)


def test_role_policy_cannot_be_expanded_by_design_preferences():
    agent = SimpleNamespace(
        skill_policy=lambda: SimpleNamespace(allows=lambda name: name == "unrelated")
    )
    plan = resolve_design_plan(
        "制作网页",
        context=context(mode="manual", skills=["webapp-building"]),
        registry=registry(),
        agent=agent,
    )
    assert not plan["ready"]
    assert plan["skills"] == []


def test_only_task_prompt_instructions_are_loaded_from_trusted_roots(monkeypatch, tmp_path):
    from runtime.execution.tool_engine import role_instructions

    for name in ("frontend-ui-engineering", "webapp-building", "presentations"):
        folder = tmp_path / name
        folder.mkdir()
        (folder / "SKILL.md").write_text(f"Instructions for {name}", encoding="utf-8")
    monkeypatch.setattr(role_instructions, "_prompt_skill_roots", lambda: (tmp_path,))
    agent = SimpleNamespace(soul="", skill_policy=lambda: SimpleNamespace(allows=lambda name: True))
    result = compose_role_instructions(
        agent, context=context(), goal="制作网页", registry=registry()
    )
    assert "<design-foundations>" in result
    assert "frontend-ui-engineering" in result
    assert "Instructions for frontend-ui-engineering" not in result
    assert "Instructions for presentations" not in result

    explicit = compose_role_instructions(
        agent, context=context(), goal="@skill:presentations 制作网页", registry=registry()
    )
    assert explicit.count("Instructions for presentations") == 1
    assert "Instructions for frontend-ui-engineering" not in explicit

    manual = compose_role_instructions(
        agent, context=context(mode="manual", skills=["presentations"]),
        goal="@skill:presentations 制作网页", registry=registry()
    )
    assert manual.count("Instructions for presentations") == 1
    picker = compose_role_instructions(
        agent, context=context(mode="manual", skills=["presentations"]),
        goal="制作演示", registry=registry()
    )
    assert picker.count("Instructions for presentations") == 1


def test_generation_without_execution_tool_is_blocked():
    reg = registry()
    reg.set_enabled("generate_image", False)
    plan = resolve_design_plan("生成一张海报", context=context(), registry=reg)
    assert not plan["ready"]
    assert "生成工具" in plan["blockers"][0]


def test_generation_configuration_checked_without_calling_provider(monkeypatch):
    from runtime.execution.suckers import kimi_compat_skills as media

    reg = registry()
    reg.register(
        Skill(
            name="generate_image",
            trusted_source="skill://public/generate_image",
            handler=media._generate_image,
        ),
        replace=True,
    )
    monkeypatch.setattr(media, "_bundled_media_configured", lambda: False)
    monkeypatch.setattr(media, "_openai_media_config", lambda: ("https://invalid", ""))
    plan = resolve_design_plan("生成一张海报", context=context(), registry=reg)
    assert not plan["ready"]
    assert "凭据" in plan["blockers"][0]
    advice = resolve_design_plan("如何生成图片？", context=context(), registry=reg)
    assert advice["ready"]


def test_video_editing_selects_the_required_plugin_only():
    reg = registry()
    reg.register(
        Skill(
            name="clip_studio.project_get",
            trusted_source="plugin://clip_studio",
            handler=lambda: {},
        )
    )
    plan = resolve_design_plan("剪辑这段视频", context=context(), registry=reg)
    assert plan["plugins"] == ["clip_studio"]
    assert plan["tools"] == ["clip_studio.project_get"]


def client(reg, **kwargs):
    app = FastAPI()
    app.include_router(create_design_studio_router(skill_registry=reg, **kwargs))
    return TestClient(app)


def test_preview_matches_runtime_and_does_not_mutate_registry():
    reg = registry()
    response = client(reg).post("/api/design/capabilities/resolve", json={"goal": "制作网页"})
    assert response.status_code == 200
    assert (
        response.json()["skills"]
        == resolve_design_plan("制作网页", context=context(), registry=reg)["skills"]
    )
    assert response.json()["plugins"] == []
    assert reg.is_enabled("comfyui_bridge.status")


def test_connection_preflight_blocks_invalid_comfyui_service(monkeypatch):
    monkeypatch.setenv("ECHO_COMFYUI_URL", "https://example.com")
    response = client(registry()).post(
        "/api/design/capabilities/resolve",
        json={
            "goal": "ComfyUI 工作流",
            "check_connection": True,
        },
    )
    assert response.status_code == 200
    assert response.json()["connection_checked"]
    assert not response.json()["ready"]


def test_auth_and_request_size_are_enforced():
    response = client(registry(), require_auth=True).post(
        "/api/design/capabilities/resolve", json={}
    )
    assert response.status_code in (401, 403)
    response = client(registry()).post(
        "/api/design/capabilities/resolve", json={"goal": "x" * 32001}
    )
    assert response.status_code == 422
