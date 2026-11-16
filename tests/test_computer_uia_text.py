"""Bounded document readback through the real UIA traversal (no desktop input)."""
from types import SimpleNamespace

import pytest

from runtime.execution.suckers import computer_uia_skills as uia


class TextControl:
    ControlTypeName = "DocumentControl"
    Name = "Text editor"
    IsOffscreen = False
    IsPassword = False

    def __init__(self, text):
        self.text = text
        self.requests = []

    def GetChildren(self):  # noqa: N802 - UIA provider API
        return []

    def GetTextPattern(self):  # noqa: N802 - UIA provider API
        def read(limit):
            self.requests.append(limit)
            return self.text[:limit]
        return SimpleNamespace(DocumentRange=SimpleNamespace(GetText=read))


@pytest.fixture
def tree(monkeypatch):
    def install(*controls):
        root = SimpleNamespace(ControlTypeName="WindowControl", Name="QA",
                               GetChildren=lambda: list(controls))
        monkeypatch.setattr(uia, "_check_uia", lambda: None)
        monkeypatch.setattr(uia, "uiautomation", SimpleNamespace(GetForegroundControl=lambda: root))
    return install


def test_explicit_readback_preserves_chinese_emoji_and_newline(tree):
    content = "你好，世界！Echo 2026🙂\r\n键盘完成"
    control = TextControl(content)
    tree(control)
    assert "text" not in uia._computer_uia_tree()["nodes"][1]
    assert control.requests == []
    result = uia._computer_uia_find(query="Text editor", include_text=True)
    node = result["matches"][0]
    assert node["text"] == content
    assert node["text_available"] is True
    assert node["text_truncated"] is False
    assert control.requests == [4097]


@pytest.mark.parametrize("privacy", [True, None])
def test_password_and_unknown_privacy_are_not_read(tree, privacy):
    control = TextControl("secret must never be read")
    control.IsPassword = privacy
    tree(control)
    node = uia._computer_uia_tree(include_text=True)["nodes"][1]
    assert node["text_available"] is False
    assert "text" not in node
    assert control.requests == []


def test_text_budget_is_shared_across_controls(tree):
    first, second = TextControl("ABCDE"), TextControl("other")
    tree(first, second)
    nodes = uia._computer_uia_tree(include_text=True, max_text_chars=4)["nodes"]
    assert nodes[1]["text"] == "ABCD"
    assert nodes[1]["text_truncated"] is True
    assert nodes[2]["text_reason"] == "text_budget_exhausted"
    assert first.requests == [5]
    assert second.requests == []


def test_offscreen_document_is_not_read_when_filtered(tree):
    control = TextControl("hidden")
    control.IsOffscreen = True
    tree(control)
    assert uia._computer_uia_tree(include_text=True)["count"] == 1
    assert control.requests == []


def test_disappearing_provider_cannot_claim_empty_document(tree):
    control = TextControl("text")
    def broken():
        raise RuntimeError("provider failure with private data")
    control.GetTextPattern = broken
    tree(control)
    result = uia._computer_uia_tree(include_text=True)
    node = result["nodes"][1]
    assert result["ok"] is True
    assert node["text_available"] is False
    assert node["text_reason"] == "text_provider_unavailable"
    assert "private data" not in str(result)


def test_request_cap_applies_before_provider_call(tree):
    control = TextControl("x" * 20000)
    tree(control)
    node = uia._computer_uia_tree(include_text=True, max_text_chars=999999)["nodes"][1]
    assert control.requests == [16385]
    assert len(node["text"]) == 16384
    assert node["text_truncated"] is True


def test_readback_reaches_model_tool_output(tree):
    import json

    from runtime.execution.tool_engine.native_tool_execution import execute_native_tool_call
    from runtime.platform.process.session import Session, session_scope
    from runtime.safety.approval.approval_gate import ApprovalDecision

    content = "中文回读🙂\n第二行"
    tree(TextControl(content))
    registry = SimpleNamespace(has=lambda _: True, is_enabled=lambda _: True,
        get=lambda _: SimpleNamespace(handler=uia._computer_uia_find))
    stack = SimpleNamespace(executor=SimpleNamespace(registry=registry))
    provider = SimpleNamespace(request=lambda *a, **k: ApprovalDecision(
        approved=True, reason="synthetic document readback only"))
    with session_scope(Session(actor="test", metadata={
        "permission_mode": "default", "_approval_provider": provider,
    })):
        output, failed = execute_native_tool_call(stack, {
            "name": "computer_uia_find",
            "arguments": {"query": "Text editor", "include_text": True},
        })
    assert not failed
    assert json.loads(output)["matches"][0]["text"] == content
