"""A requested window must never silently become a different UIA scope."""
from types import SimpleNamespace

import pytest

from runtime.execution.suckers import computer_uia_skills as uia


@pytest.fixture
def provider(monkeypatch):
    calls = []
    target = SimpleNamespace(Name="Fixture - Notepad", ControlTypeName="WindowControl",
                             NativeWindowHandle=42, GetChildren=lambda: [])
    desktop = SimpleNamespace(GetChildren=lambda: [target])

    def root():
        calls.append("desktop")
        return desktop

    def foreground():
        calls.append("foreground")
        return target

    api = SimpleNamespace(GetRootControl=root, GetForegroundControl=foreground)
    monkeypatch.setattr(uia, "_check_uia", lambda: None)
    monkeypatch.setattr(uia, "uiautomation", api)
    return api, desktop, target, calls


@pytest.mark.parametrize("root", ["Fixture - Notepad", "forground", "window=Fixture - Notepad"])
def test_bad_root_cannot_read_foreground_or_desktop(provider, root):
    result = uia._computer_uia_find(root=root, query="Document", include_text=True)
    assert result["ok"] is False
    assert "invalid root" in result["error"]
    assert result["matches"] == []
    assert provider[3] == []


@pytest.mark.parametrize("missing_getter", [False, True])
def test_missing_foreground_never_expands_to_desktop(provider, missing_getter):
    api, _, _, calls = provider
    if missing_getter:
        del api.GetForegroundControl
    else:
        api.GetForegroundControl = lambda: None
    result = uia._computer_uia_tree(include_text=True)
    assert result["ok"] is False
    assert "foreground window unavailable" in result["error"]
    assert result["nodes"] == []
    assert calls == []


@pytest.mark.parametrize("count", [0, 2])
def test_missing_or_ambiguous_title_never_uses_foreground(provider, count):
    _, desktop, target, calls = provider
    desktop.GetChildren = lambda: [target] * count
    result = uia._computer_uia_find(root="window:Fixture - Notepad", query="Window")
    assert result["ok"] is False
    assert f"found {count}" in result["error"]
    assert calls == ["desktop"]


def test_explicit_title_with_outer_whitespace_keeps_action_binding(provider, monkeypatch):
    from runtime.execution.suckers import computer_windows

    monkeypatch.setattr(computer_windows, "window_target", lambda hwnd: f"win32:{hwnd}:123")
    result = uia._computer_uia_find(root="  window:Fixture - Notepad  ", query="Window")
    assert result["ok"] is True
    assert result["count"] == 1
    assert result["automation_target"] == "win32:42:123"
    assert provider[3] == ["desktop"]


@pytest.mark.parametrize("scope", ["desktop", "root", "foreground"])
def test_explicit_supported_scopes_still_resolve(provider, scope):
    _, desktop, target, calls = provider
    resolved, error = uia._resolve_root(scope)
    assert error is None
    assert resolved is (target if scope == "foreground" else desktop)
    assert calls == ["foreground" if scope == "foreground" else "desktop"]
