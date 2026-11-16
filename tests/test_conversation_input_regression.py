"""Regression cases found by the installed desktop conversation acceptance."""
from contextlib import contextmanager, nullcontext
from types import SimpleNamespace

import pytest

from runtime.execution.suckers import computer_skills, computer_uia_skills
from runtime.tentacle import remote_desktop_input


@pytest.mark.parametrize("text", ["temp", "AI ASCII 2026!", "中文验收：你好，世界！Echo 2026", "简体繁體🙂🚀", "第一行\n第二行"])
def test_unicode_is_not_silently_sent_to_ascii_writer(monkeypatch, text):
    calls = []
    guard = []
    monkeypatch.setattr(computer_skills.sys, "platform", "win32")
    monkeypatch.setattr(computer_skills, "_check_pyautogui", lambda: None)
    monkeypatch.setattr(computer_skills, "PYAUTOGUI_AVAILABLE", True)
    monkeypatch.setattr(computer_skills, "pyautogui", SimpleNamespace(failSafeCheck=lambda: guard.append(True)))
    monkeypatch.setattr(remote_desktop_input, "type_unicode", calls.append)
    result = computer_skills._keyboard_type(text, interval=0)
    assert "error" not in result
    assert "".join(calls) == text
    assert len(guard) == len(text)


@pytest.mark.parametrize("failure", ["failsafe", "native_input"])
def test_unicode_failure_is_reported_without_ascii_fallback(monkeypatch, failure):
    calls = []
    def fail():
        raise OSError("input unavailable")
    monkeypatch.setattr(computer_skills, "_check_pyautogui", lambda: None)
    monkeypatch.setattr(computer_skills, "PYAUTOGUI_AVAILABLE", True)
    monkeypatch.setattr(computer_skills, "pyautogui", SimpleNamespace(failSafeCheck=fail if failure == "failsafe" else lambda: None))
    def native(text):
        calls.append(text)
        fail()
    monkeypatch.setattr(remote_desktop_input, "type_unicode", native)
    assert "error" in computer_skills._keyboard_type("中文", interval=0)
    assert calls == ([] if failure == "failsafe" else ["中"])


@pytest.mark.parametrize("raises", [False, True])
def test_uia_com_scope_covers_entire_traversal_and_releases(monkeypatch, raises):
    events = []
    @contextmanager
    def initialized():
        events.append("init")
        try:
            yield
        finally:
            events.append("release")
    monkeypatch.setattr(computer_uia_skills, "_check_uia", lambda: None)
    monkeypatch.setattr(computer_uia_skills, "uiautomation", SimpleNamespace(UIAutomationInitializerInThread=initialized))
    def traverse(**kw):
        assert events == ["init"]
        events.append("traverse")
        if raises:
            raise OSError("tree unavailable")
        return {"ok": True, "nodes": []}
    monkeypatch.setattr(computer_uia_skills, "_computer_uia_tree_initialized", traverse)
    assert computer_uia_skills._computer_uia_tree()["ok"] is not raises
    assert events == ["init", "traverse", "release"]


def test_capture_output_does_not_follow_packaged_roaming_cwd(monkeypatch, tmp_path):
    from runtime.sensing.gateway.computer_router_state import ComputerRouterState
    from runtime.safety.auth.path_guard import check_path
    roaming = tmp_path / "Roaming"
    roaming.mkdir()
    monkeypatch.chdir(roaming)
    monkeypatch.setenv("APPDATA", str(roaming))
    monkeypatch.setattr("tempfile.gettempdir", lambda: str(tmp_path / "Temp"))
    state = ComputerRouterState()
    assert not state.screenshot_root.is_relative_to(roaming)
    assert check_path(state.screenshot_root / "test.png", sandbox_dir=state.screenshot_root).allow


def test_named_window_finds_deep_electron_controls_without_scanning_other_apps(monkeypatch):
    import sys
    def node(name, children=()):
        return SimpleNamespace(Name=name, ControlTypeName="PaneControl", GetChildren=lambda: list(children))
    deep = node("中文输入验收")
    for _ in range(10):
        deep = node("", [deep])
    window = node("Echo 输入验收靶场", [deep])
    window.NativeWindowHandle = 123
    monkeypatch.setitem(sys.modules, "win32gui", SimpleNamespace(
        IsWindow=lambda hwnd: hwnd == 123, GetWindowText=lambda hwnd: window.Name,
        GetClassName=lambda hwnd: "Chrome_WidgetWin_1", GetForegroundWindow=lambda: 123,
        IsIconic=lambda hwnd: False,
    ))
    monkeypatch.setitem(sys.modules, "win32process", SimpleNamespace(GetWindowThreadProcessId=lambda hwnd: (1, 456)))
    def unrelated_children():
        raise AssertionError("must not traverse unrelated windows")
    unrelated = SimpleNamespace(Name="Other app", GetChildren=unrelated_children)
    desktop = node("Desktop", [unrelated, window])
    monkeypatch.setattr(computer_uia_skills, "_check_uia", lambda: None)
    monkeypatch.setattr(computer_uia_skills, "uiautomation", SimpleNamespace(GetRootControl=lambda: desktop))
    result = computer_uia_skills._computer_uia_find(query="中文输入验收", exact=True, root="window:Echo 输入验收靶场")
    assert result["ok"] and result["count"] == 1
    assert result["automation_target"]["id"] == "win32:123:456"
    assert result["automation_target"]["title"] == "Echo 输入验收靶场"


@pytest.mark.parametrize("titles", [[], ["Target", "Target"]])
def test_named_window_refuses_missing_or_ambiguous_target(monkeypatch, titles):
    desktop = SimpleNamespace(GetChildren=lambda: [SimpleNamespace(Name=t) for t in titles])
    monkeypatch.setattr(computer_uia_skills, "_check_uia", lambda: None)
    monkeypatch.setattr(computer_uia_skills, "uiautomation", SimpleNamespace(GetRootControl=lambda: desktop))
    result = computer_uia_skills._computer_uia_find(query="button", root="window:Target")
    assert not result["ok"]
    assert "one exact title match" in result["error"]


@pytest.mark.parametrize("failure", [None, "settling_z_order", "pid", "title", "focus", "occlusion", "closed"])
def test_windows_target_requires_identity_focus_and_visible_click(monkeypatch, failure):
    import sys
    from runtime.execution.suckers.computer_windows import activate_window_target
    calls = []
    foreground = [50]
    hits = []
    def hit_root(handle, flag):
        hits.append(handle)
        return 50 if failure == "occlusion" or failure == "settling_z_order" and len(hits) == 1 else 100
    def activate(hwnd):
        calls.append("activate")
        if failure != "focus":
            foreground[0] = hwnd
    gui = SimpleNamespace(IsWindow=lambda h: failure != "closed", GetWindowText=lambda h: "Changed" if failure == "title" else "Target", IsIconic=lambda h: True,
        ShowWindow=lambda *a: calls.append("restore"), GetForegroundWindow=lambda: foreground[0],
        SetForegroundWindow=activate, WindowFromPoint=lambda p: 101, GetAncestor=hit_root,
        GetWindowRect=lambda h: (0, 0, 200, 200))
    monkeypatch.setitem(sys.modules, "win32gui", gui)
    monkeypatch.setitem(sys.modules, "win32con", SimpleNamespace(SW_RESTORE=9))
    monkeypatch.setitem(sys.modules, "win32process", SimpleNamespace(GetWindowThreadProcessId=lambda h: (1, 201 if failure == "pid" else 200)))
    monkeypatch.setitem(sys.modules, "uiautomation", SimpleNamespace(UIAutomationInitializerInThread=nullcontext, ControlFromHandle=lambda h: None))
    result = activate_window_target({"id": "win32:100:200", "title": "Target"}, point=(10, 20))
    assert ("error" not in result) == (failure in (None, "settling_z_order"))
    if failure == "settling_z_order":
        assert len(hits) == 2
    if failure in {"pid", "title", "closed"}:
        assert calls == []


@pytest.mark.parametrize("action", [{"action": "click", "x": 10, "y": 20}, {"action": "type", "text": "中文"}, {"action": "key", "keys": ["enter"]}])
def test_no_input_when_windows_target_activation_fails(monkeypatch, action):
    from runtime.sensing.gateway import computer_actions
    from runtime.execution.suckers import computer_windows
    monkeypatch.setattr(computer_actions.sys, "platform", "win32")
    monkeypatch.setattr(computer_actions.computer_macos, "MACOS_NATIVE_AVAILABLE", False)
    monkeypatch.setattr(computer_windows, "activate_window_target", lambda *a, **kw: {"error": "focus denied"})
    def unexpected(**kw):
        raise AssertionError("input must not be dispatched")
    for method in ["_mouse_click", "_keyboard_type", "_keyboard_press"]:
        monkeypatch.setattr(computer_skills, method, unexpected)
    result = computer_actions._execute({**action, "automation_target": {"id": "win32:100:200"}})
    assert result["error"] == "focus denied"


@pytest.mark.parametrize("activation_fails", [False, True])
def test_provider_focus_releases_com_and_does_not_join_input_queues(monkeypatch, activation_fails):
    import sys
    from runtime.execution.suckers.computer_windows import _foreground
    calls = []
    focus = [50]
    def activate(hwnd):
        raise OSError("background worker")
    @contextmanager
    def initialized():
        calls.append("init")
        try:
            yield
        finally:
            calls.append("release")
    def provider_focus():
        calls.append("focus")
        if activation_fails:
            return False
        focus[0] = 100
        return True
    gui = SimpleNamespace(SetForegroundWindow=activate, GetForegroundWindow=lambda: focus[0])
    processes = SimpleNamespace()
    monkeypatch.setitem(sys.modules, "uiautomation", SimpleNamespace(UIAutomationInitializerInThread=initialized, ControlFromHandle=lambda h: SimpleNamespace(SetFocus=provider_focus)))
    if activation_fails:
        with pytest.raises(OSError):
            _foreground(100, gui, processes)
    else:
        _foreground(100, gui, processes)
        assert focus[0] == 100
    assert calls == ["init", "focus", "release"]


@pytest.mark.parametrize("delayed_focus", [True, False])
def test_provider_focus_is_verified_with_bounded_async_wait(monkeypatch, delayed_focus):
    import sys
    from runtime.execution.suckers import computer_windows
    clock = [0.0]
    def sleep(seconds):
        clock[0] += seconds
    gui = SimpleNamespace(SetForegroundWindow=lambda h: None,
        GetForegroundWindow=lambda: 100 if delayed_focus and clock[0] >= 0.05 else 50)
    monkeypatch.setattr(computer_windows.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(computer_windows.time, "sleep", sleep)
    monkeypatch.setitem(sys.modules, "uiautomation", SimpleNamespace(UIAutomationInitializerInThread=nullcontext,
        ControlFromHandle=lambda h: SimpleNamespace(SetFocus=lambda: True)))
    computer_windows._foreground(100, gui, SimpleNamespace())
    assert 0.05 <= clock[0] <= 1.025
    assert (gui.GetForegroundWindow() == 100) == delayed_focus
