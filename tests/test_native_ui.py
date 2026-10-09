from copy import deepcopy
from types import SimpleNamespace

import pytest

from runtime.execution.suckers import visual_skills
from runtime.execution.suckers.registry import SkillRegistry
from runtime.execution.tool_spec_builder import build_anthropic_tool_specs
from runtime.platform.native_ui import ui_tool_schema, validate_ui


@pytest.fixture
def document():
    return {
        "version": 1,
        "title": "项目需求",
        "blocks": [
            {"type": "text", "id": "intro", "text": "确认后继续"},
            {
                "type": "comparison",
                "id": "options",
                "title": "方案",
                "columns": ["方案", "成本"],
                "rows": [["A", "低"], ["B", "高"]],
            },
            {
                "type": "form",
                "id": "requirements",
                "title": "你的选择",
                "fields": [
                    {"id": "name", "label": "项目名称", "type": "text", "required": True},
                    {"id": "option", "label": "方案", "type": "select", "options": ["A", "B"]},
                ],
            },
            {"type": "tasks", "id": "plan", "title": "当前计划"},
        ],
    }


def test_session_binds_destination_and_validation_is_not_display_confirmation(
    document, monkeypatch
):
    monkeypatch.setattr(
        visual_skills,
        "current_session",
        lambda: SimpleNamespace(thread_id="private-thread", conversation_id="public-thread"),
    )
    result = visual_skills._show_ui(document)
    assert result["thread_id"] == "private-thread"
    assert result["kind"] == "echo.ui.v1"
    assert result["status"] == "ready"
    assert result["version"] == 1
    assert "document" not in result
    monkeypatch.setattr(visual_skills, "current_session", lambda: None)
    assert not visual_skills._show_ui(document)["ok"]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda doc: doc.update(thread_id="public-thread"),
        lambda doc: doc.update(version=True),
        lambda doc: doc["blocks"][2].update(action={"tool": "invite_member"}),
        lambda doc: doc["blocks"][3].update(status="completed"),
        lambda doc: doc["blocks"][0].update(script="fetch('secret')"),
        lambda doc: doc["blocks"].append(deepcopy(doc["blocks"][0])),
        lambda doc: doc["blocks"][1]["rows"].append(["wrong-width"]),
        lambda doc: doc["blocks"][2]["fields"].append(deepcopy(doc["blocks"][2]["fields"][0])),
        lambda doc: doc["blocks"][2]["fields"][0].update(type="password"),
        lambda doc: doc["blocks"][2]["fields"][1].update(options=[]),
        lambda doc: doc["blocks"][2]["fields"][1].update(options=["A", "A"]),
        lambda doc: doc["blocks"][0].update(text="x" * 8001),
        lambda doc: doc.update(
            blocks=[{"type": "text", "id": f"b{i}", "text": "x" * 7000} for i in range(10)]
        ),
    ],
)
def test_rejects_unsafe_or_ambiguous_documents(document, mutation):
    mutation(document)
    assert not validate_ui(document, "thread")["ok"]


def test_errors_do_not_echo_input(document):
    document["blocks"][0]["id"] = "a secret value"
    result = validate_ui(document, "thread")
    assert "secret" not in str(result)
    assert "blocks.0.text.id" in result["error"]


def test_schema_and_lazy_guidance_are_registered():
    registry = SkillRegistry()
    visual_skills.register_visual_skills(registry)
    spec = next(spec for spec in build_anthropic_tool_specs(registry) if spec.name == "show_ui")
    assert spec.input_schema == ui_tool_schema()
    assert "FormBlock" in spec.input_schema["$defs"]
    assert visual_skills._guidelines("ui")["ok"]


def test_large_document_receipt_survives_normal_tool_output_pruning(monkeypatch):
    import json

    from runtime.execution.tool_engine.native_tool_execution import execute_native_tool_call

    registry = SkillRegistry()
    visual_skills.register_visual_skills(registry)
    monkeypatch.setattr(
        visual_skills,
        "current_session",
        lambda: SimpleNamespace(thread_id="thread", conversation_id=None),
    )
    document = {
        "version": 1,
        "title": "Large UI",
        "blocks": [{"type": "text", "id": f"b{i}", "text": "资料" * 3000} for i in range(8)],
    }
    output, failed = execute_native_tool_call(
        SimpleNamespace(executor=SimpleNamespace(registry=registry)),
        {"id": "call", "name": "show_ui", "arguments": {"document": document}},
    )
    assert not failed
    assert len(output) < 300
    assert json.loads(output)["kind"] == "echo.ui.v1"


def test_external_engines_receive_the_same_ui_behavior():
    from runtime.execution.tool_engine.role_instructions import compose_role_instructions

    registry = SkillRegistry()
    visual_skills.register_visual_skills(registry)
    text = compose_role_instructions(
        SimpleNamespace(soul="", name="test"), context={}, goal="比较方案", registry=registry
    )
    assert "show_ui" in text
    assert "不把计划状态当成执行验收" in text


def test_inert_cards_are_available_to_normal_and_read_only_roles():
    from runtime.execution.misc.skill_policy import (
        audit_read_only_tool_denial,
        resolve_agent_skill_policy,
    )
    from runtime.execution.suckers.layers import is_read_only_skill

    policy = resolve_agent_skill_policy(SimpleNamespace(arms=[], extra_skills=[]))
    for name in ("show_ui", "visual_guidelines"):
        assert policy.allows(name)
        assert is_read_only_skill(name)
        assert (
            audit_read_only_tool_denial(name, {}, context={"_read_only_turn_enforced": True})
            is None
        )
