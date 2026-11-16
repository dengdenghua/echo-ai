"""Real Notepad dirty-title regression and cross-document target boundaries."""

import sys
from types import SimpleNamespace

import pytest

from runtime.execution.suckers import computer_windows


@pytest.mark.parametrize(
    "before,after,app_class,observed_class,allowed",
    [
        ("Echo-Input-QA.txt - Notepad", "*Echo-Input-QA.txt - Notepad", "Notepad", "Notepad", True),
        ("*Echo-Input-QA.txt - Notepad", "Echo-Input-QA.txt - Notepad", "Notepad", "Notepad", True),
        ("Echo-Input-QA.txt - Notepad", "*Other.txt - Notepad", "Notepad", "Notepad", False),
        (
            "Echo-Input-QA.txt - Notepad",
            "**Echo-Input-QA.txt - Notepad",
            "Notepad",
            "Notepad",
            False,
        ),
        ("Document", "*Document", "Editor", "Editor", False),
        ("Document", "*Document", "Notepad", "Editor", False),
        ("Document", "*Document", "Editor", "Notepad", False),
        ("Document", "*Document", "Notepad", None, False),
    ],
)
def test_dirty_marker_only_for_same_notepad_document(
    before, after, app_class, observed_class, allowed
):
    gui = SimpleNamespace(GetWindowText=lambda h: after, GetClassName=lambda h: app_class)
    assert (
        computer_windows._target_title_matches(
            {"title": before, "app_name": observed_class}, 100, gui
        )
        is allowed
    )


@pytest.mark.parametrize(
    "change_at,changed_title,changed_pid,allowed",
    [
        ("before", "*Echo-Input-QA.txt - Notepad", 200, True),
        ("focus", "*Echo-Input-QA.txt - Notepad", 200, True),
        ("focus", "Other.txt - Notepad", 200, False),
        ("hit_test", "Other.txt - Notepad", 200, False),
        ("before", "*Echo-Input-QA.txt - Notepad", 201, False),
        ("hit_test", "Echo-Input-QA.txt - Notepad", 201, False),
    ],
)
def test_activation_rechecks_document_after_focus_and_hit_test(
    monkeypatch, change_at, changed_title, changed_pid, allowed
):
    state = {"title": "Echo-Input-QA.txt - Notepad", "foreground": 50, "pid": 200}

    def mutate():
        state.update(title=changed_title, pid=changed_pid)

    if change_at == "before":
        mutate()

    def focus(hwnd, *args):
        state["foreground"] = hwnd
        if change_at == "focus":
            mutate()

    def hit(point):
        if change_at == "hit_test":
            mutate()
        return 101

    gui = SimpleNamespace(
        IsWindow=lambda h: True,
        GetWindowText=lambda h: state["title"],
        GetClassName=lambda h: "Notepad",
        IsIconic=lambda h: False,
        GetForegroundWindow=lambda: state["foreground"],
        WindowFromPoint=hit,
        GetAncestor=lambda *args: 100,
    )
    monkeypatch.setitem(sys.modules, "win32gui", gui)
    monkeypatch.setitem(sys.modules, "win32con", SimpleNamespace())
    monkeypatch.setitem(
        sys.modules,
        "win32process",
        SimpleNamespace(GetWindowThreadProcessId=lambda h: (1, state["pid"])),
    )
    monkeypatch.setattr(computer_windows, "_foreground", focus)
    result = computer_windows.activate_window_target(
        {"id": "win32:100:200", "title": "Echo-Input-QA.txt - Notepad", "app_name": "Notepad"},
        point=(20, 20),
    )
    assert (result.get("ok") is True) is allowed
    if not allowed:
        assert "error" in result
