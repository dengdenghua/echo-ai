"""Literal text through the focused X11 accessibility editor, without clipboard I/O.

Run with the system Python, whose distro provides pyatspi. Exit 69 only when no
editing operation was attempted; all ambiguous mutation failures use exit 70.
"""

from __future__ import annotations

import os
import sys

UNAVAILABLE = 69
FAILED = 70


def _children(node):
    for index in range(min(max(0, node.childCount), 10000)):
        child = node.getChildAtIndex(index)
        if child is not None:
            yield child


def unlocked_x11_session(bus, uid, display):
    manager = bus.get_object("org.freedesktop.login1", "/org/freedesktop/login1")
    for _, session_uid, _, seat, path in manager.ListSessions(
        dbus_interface="org.freedesktop.login1.Manager"
    ):
        if session_uid != uid or not seat:
            continue
        properties = bus.get_object("org.freedesktop.login1", path).GetAll(
            "org.freedesktop.login1.Session", dbus_interface="org.freedesktop.DBus.Properties"
        )
        if properties.get("Type") == "x11" and properties.get("Display") == display:
            return bool(properties.get("Active")) and not properties.get("LockedHint", True)
    return False


def insert_focused_text(desktop, value, api, can_edit=None):
    try:
        active = [
            window
            for app in _children(desktop)
            for window in _children(app)
            if window.getState().contains(api.STATE_ACTIVE)
        ]
        candidates = []
        stack = [(window, 0) for window in active]
        visited = 0
        while stack and visited < 10000:
            node, depth = stack.pop()
            visited += 1
            state = node.getState()
            if state.contains(api.STATE_FOCUSED) and state.contains(api.STATE_EDITABLE):
                candidates.append(node)
            if depth < 64:
                stack.extend((child, depth + 1) for child in _children(node))
        if len(candidates) != 1:
            return UNAVAILABLE
        node = candidates[0]
        editable, text = node.queryEditableText(), node.queryText()
        selections = text.getNSelections()
        if selections > 1:
            return UNAVAILABLE
        start, end = text.getSelection(0) if selections else (text.caretOffset, text.caretOffset)
        if start < 0 or end < start:
            return UNAVAILABLE
        # Qt's accessibility implementation slices QStrings in UTF-16 units.
        # Supplying a Unicode code-point count truncates an astral character.
        toolkit = node.getApplication().toolkitName.lower()
        length = len(value.encode("utf-16-le")) // 2 if toolkit == "qt" else len(value)
        # Accessibility focus can remain on a background editor while a locker
        # owns the keyboard. In that case use ordinary keyboard delivery only.
        if can_edit is not None and not can_edit():
            return UNAVAILABLE
    except Exception:
        return UNAVAILABLE

    # Once an edit can have occurred, never fall back to keyboard injection:
    # the caller cannot safely distinguish a rejected edit from a late reply.
    try:
        if not node.getState().contains(api.STATE_FOCUSED):
            return FAILED
        if end > start and not editable.deleteText(start, end):
            return FAILED
        before = text.characterCount
        if not editable.insertText(start, value, length):
            return FAILED
        # Qt and browser editors can count astral characters differently. Use
        # the editor's own offset units rather than splitting an emoji pair.
        inserted = text.characterCount - before
        if inserted not in (len(value), len(value.encode("utf-16-le")) // 2):
            return FAILED
        caret = start + inserted
        if not text.setCaretOffset(caret) and text.caretOffset != caret:
            return FAILED
        return 0
    except Exception:
        return FAILED


def main():
    value = sys.stdin.buffer.read(16385).decode("utf-8", errors="strict")
    if not value or len(value) > 4096 or "\0" in value:
        return FAILED
    try:
        import dbus
        import pyatspi

        desktop = pyatspi.Registry.getDesktop(0)
        bus = dbus.SystemBus()
    except Exception:
        return UNAVAILABLE
    return insert_focused_text(
        desktop,
        value,
        pyatspi,
        can_edit=lambda: unlocked_x11_session(bus, os.getuid(), os.environ.get("DISPLAY", "")),
    )


if __name__ == "__main__":
    raise SystemExit(main())
