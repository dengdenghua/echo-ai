# ruff: noqa: N802
from types import SimpleNamespace

import pytest

from runtime.tentacle.remote_desktop_x11_text import (
    FAILED,
    UNAVAILABLE,
    insert_focused_text,
    unlocked_x11_session,
)

API = SimpleNamespace(STATE_ACTIVE="active", STATE_FOCUSED="focused", STATE_EDITABLE="editable")


class Node:
    def __init__(self, states=(), children=()):
        self.states, self.children = set(states), list(children)

    @property
    def childCount(self):
        return len(self.children)

    def getChildAtIndex(self, index):
        return self.children[index]

    def getState(self):
        return SimpleNamespace(contains=lambda name: name in self.states)


class Editor(Node):
    def __init__(self, value="", selection=None, utf16=False, reject=False):
        super().__init__(("focused", "editable"))
        self.value, self.selection, self.utf16, self.reject = value, selection, utf16, reject
        self.caretOffset = len(value)
        self.edits = 0

    def queryEditableText(self):
        return self

    def queryText(self):
        return self

    def getApplication(self):
        return SimpleNamespace(toolkitName="Qt" if self.utf16 else "GTK")

    def getNSelections(self):
        return int(self.selection is not None)

    def getSelection(self, index):
        return self.selection

    @property
    def characterCount(self):
        return len(self.value.encode("utf-16-le")) // 2 if self.utf16 else len(self.value)

    def deleteText(self, start, end):
        self.value = self.value[:start] + self.value[end:]
        self.selection = None
        return True

    def insertText(self, start, value, length):
        expected_length = len(value.encode("utf-16-le")) // 2 if self.utf16 else len(value)
        assert length == expected_length
        self.edits += 1
        if self.reject:
            return False
        self.value = self.value[:start] + value + self.value[start:]
        return True

    def setCaretOffset(self, value):
        self.caretOffset = value
        return True


def desktop(editor):
    return Node(children=[Node(children=[Node(("active",), [editor])])])


def test_unicode_replaces_selection_and_moves_caret():
    editor = Editor("start:old:end", (6, 9))
    assert insert_focused_text(desktop(editor), "中文🌏", API) == 0
    assert editor.value == "start:中文🌏:end"
    assert editor.caretOffset == 9
    assert editor.edits == 1


def test_caret_uses_the_editors_utf16_units_for_emoji():
    editor = Editor(utf16=True)
    assert insert_focused_text(desktop(editor), "中文🌏", API) == 0
    assert editor.value == "中文🌏"
    assert editor.caretOffset == 4


def test_unfocused_editor_is_unavailable_without_mutation():
    editor = Editor()
    editor.states.remove("focused")
    assert insert_focused_text(desktop(editor), "中文", API) == UNAVAILABLE
    assert editor.edits == 0


def test_rejected_edit_is_ambiguous_and_cannot_fall_back():
    editor = Editor("before", reject=True)
    assert insert_focused_text(desktop(editor), "中文", API) == FAILED
    assert editor.edits == 1


def test_locked_session_cannot_edit_background_accessibility_focus():
    editor = Editor("background")
    assert (
        insert_focused_text(desktop(editor), "remote", API, can_edit=lambda: False) == UNAVAILABLE
    )
    assert editor.value == "background"
    assert editor.edits == 0


@pytest.mark.parametrize(
    "active,locked,display,expected",
    [
        (True, False, ":0", True),
        (True, True, ":0", False),
        (False, False, ":0", False),
        (True, False, ":1", False),
    ],
)
def test_logind_guard_matches_the_active_unlocked_display(active, locked, display, expected):
    manager = SimpleNamespace(ListSessions=lambda **_: [("1", 1000, "echo", "seat0", "/session/1")])
    session = SimpleNamespace(
        GetAll=lambda *_, **__: {
            "Type": "x11",
            "Display": display,
            "Active": active,
            "LockedHint": locked,
        }
    )
    bus = SimpleNamespace(
        get_object=lambda _, path: manager if path.endswith("login1") else session
    )
    assert unlocked_x11_session(bus, 1000, ":0") is expected
