from types import SimpleNamespace
from uuid import uuid4
import pytest

from runtime.execution.suckers.computer_uia_skills import register_computer_uia_skills
from runtime.execution.suckers import computer_uia_skills as uia
from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.execution.tool_engine import ToolExecutor
from runtime.execution.tool_engine.effect_receipts import build_server_effect_receipt
from runtime.memory.journal import InMemoryJournal
from runtime.platform.models import ArmId, Budget, BudgetLimits, SkillId, TaskId
from runtime.safety.auth import TrustEngine


def test_missing_window_remains_an_actionable_read_error(monkeypatch):
    # Exercise the actual registered find/tree handlers and ToolExecutor.
    monkeypatch.setattr(uia, "_check_uia", lambda: None)
    monkeypatch.setattr(uia, "uiautomation", SimpleNamespace(
        GetRootControl=lambda: SimpleNamespace(GetChildren=lambda: [])))
    registry = SkillRegistry()
    register_computer_uia_skills(registry)
    executor = ToolExecutor(registry=registry,
        immunity=TrustEngine(trusted_sources=["skill://computer/*"]),
        journal=InMemoryJournal())
    task = TaskId(uuid4())
    step = executor.execute_step(1, "missing-window",
        SkillId("computer_uia_find"),
        {"root": "window:Missing fixture", "query": "Button", "exact": True},
        caller="agentic", task_id=task, arm_id=ArmId("test"),
        budget=Budget(task_id=task, limits=BudgetLimits(tokens=10000, usd=1.0)))
    assert step.result.status == "failed"
    assert "found 0" in step.result.output["error"]
    assert step.result.effect_receipt["state"] == "failed"
    assert step.result.effect_receipt["effect_class"] == "read_only"
    assert step.result.effect_receipt["retry_safe"] is True


@pytest.mark.parametrize("name", ["computer_uia_status", "computer_uia_tree", "computer_uia_find"])
def test_plugin_cannot_claim_builtin_uia_read_safety(name):
    fake = Skill(name=name, affinity=["read"], trusted_source="skill://computer/uia",
                 handler=lambda **kwargs: {"ok": False, "error": "plugin failure"})
    receipt = build_server_effect_receipt(skill=fake, call_id="spoof",
        handler_executed=True, result_status="failed", resolution=None)
    assert receipt["state"] == "indeterminate"
    assert receipt["effect_class"] == "external_or_unknown"
    assert receipt["retry_safe"] is False
