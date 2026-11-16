"""Activate and validate a confirmed Windows desktop target before input."""
from __future__ import annotations

from typing import Any
import time


def _target_title_matches(target: dict[str, Any], hwnd: int, gui: Any) -> bool:
    expected = target.get("title")
    current = gui.GetWindowText(hwnd)
    if not expected or current == expected:
        return True
    # Notepad adds exactly one leading '*' when its current document is dirty.
    # Windows filenames cannot contain '*'; keep the complete document title
    # and the already checked HWND/PID bound rather than relaxing title checks
    # for other applications or accepting a different tab in the same window.
    if current.removeprefix("*") != str(expected).removeprefix("*"):
        return False
    return (
        target.get("app_name") == "Notepad"
        and gui.GetClassName(hwnd) == "Notepad"
        and not current.removeprefix("*").startswith("*")
        and not str(expected).removeprefix("*").startswith("*")
    )


def window_target(hwnd: int) -> dict[str, Any]:
    """Return a read-only identity without depending on optional preview routes."""
    import win32gui
    import win32process

    if not win32gui.IsWindow(hwnd):
        raise ValueError("target window is no longer available")
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    return {
        "kind": "desktop_window", "source": "computer",
        "id": f"win32:{hwnd}:{pid}", "title": win32gui.GetWindowText(hwnd),
        "app_id": str(pid), "app_name": win32gui.GetClassName(hwnd),
        "frontmost": hwnd == win32gui.GetForegroundWindow(),
        "minimized": bool(win32gui.IsIconic(hwnd)),
    }


def _foreground(hwnd: int, gui: Any, processes: Any) -> None:
    try:
        gui.SetForegroundWindow(hwnd)
    except Exception:
        pass
    if gui.GetForegroundWindow() == hwnd:
        return
    # Let the accessibility provider focus its own window. Joining another
    # process's input queue can hang our execution worker if that app hangs.
    # No synthetic Alt press, global foreground-lock changes, or input sent to
    # the previously active application are used to acquire focus.
    import uiautomation as uia

    with uia.UIAutomationInitializerInThread():
        control = uia.ControlFromHandle(hwnd)
        if control is None or not control.SetFocus():
            raise OSError("target accessibility provider refused focus")
    # Cross-thread foreground activation is asynchronous. Wait only for this
    # exact HWND and let the caller enforce identity and visibility again.
    deadline = time.monotonic() + 1.0
    while gui.GetForegroundWindow() != hwnd and time.monotonic() < deadline:
        time.sleep(0.025)


def activate_window_target(target: dict[str, Any], *, point: tuple[int, int] | None = None) -> dict[str, Any]:
    try:
        import win32con
        import win32gui
        import win32process

        parts = str(target.get("id") or "").split(":")
        if len(parts) != 3 or parts[0] != "win32":
            return {"error": "invalid Windows target; observe the target window again"}
        hwnd, pid = int(parts[1]), int(parts[2])
        if not win32gui.IsWindow(hwnd) or win32process.GetWindowThreadProcessId(hwnd)[1] != pid:
            return {"error": "target window closed or changed identity"}
        if not _target_title_matches(target, hwnd, win32gui):
            return {"error": "target window title changed; observe again"}
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        if win32gui.GetForegroundWindow() != hwnd:
            _foreground(hwnd, win32gui, win32process)
        if win32gui.GetForegroundWindow() != hwnd:
            return {"error": "target window could not obtain foreground focus; no input sent"}
        if not win32gui.IsWindow(hwnd) or win32process.GetWindowThreadProcessId(hwnd)[1] != pid:
            return {"error": "target window changed identity during activation; no input sent"}
        if point is not None:
            # Accessibility focus and z-order changes can settle on different
            # messages. Wait briefly for the exact observed point to become
            # visible, never click through a covering window.
            deadline = time.monotonic() + 0.5
            while True:
                hit = win32gui.WindowFromPoint(point)
                hit_root = win32gui.GetAncestor(hit, 2) if hit else 0
                if hit_root == hwnd:
                    break
                if time.monotonic() >= deadline:
                    return {"error": "click point is not on the confirmed target window; observe again",
                            "point": list(point), "target_hwnd": hwnd, "hit_hwnd": hit,
                            "hit_root_hwnd": hit_root, "target_rect": list(win32gui.GetWindowRect(hwnd))}
                time.sleep(0.025)
            if win32gui.GetForegroundWindow() != hwnd:
                return {"error": "target lost foreground focus before input; no input sent"}
        if not win32gui.IsWindow(hwnd) or win32process.GetWindowThreadProcessId(hwnd)[1] != pid:
            return {"error": "target window changed identity before input; no input sent"}
        if not _target_title_matches(target, hwnd, win32gui):
            return {"error": "target window title changed during activation; observe again; no input sent"}
        return {"ok": True, "target_id": target["id"]}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"window activation failed: {type(exc).__name__}: {exc}"}
