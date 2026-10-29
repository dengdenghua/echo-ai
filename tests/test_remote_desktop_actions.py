"""Desktop actions must preserve Echo's interactive shell and other workspaces."""
import sys
from types import SimpleNamespace

from runtime.tentacle import remote_desktop_x11_actions as actions


def test_echo_show_desktop_preserves_shell_dock_and_other_workspaces(tmp_path, monkeypatch):
    marker = tmp_path / "echo-os/desktop-ready"
    marker.parent.mkdir()
    marker.touch()
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setattr(actions.os, "getuid", lambda: 1000, raising=False)
    calls = []
    def run(*args):
        calls.append(args)
        if args == ("/usr/bin/wmctrl", "-lp"):
            return "0x01 0 101 host ECHO OS\n0x02 0 202 host Editor\n0x03 -1 303 host Dock\n0x04 1 404 host Other workspace\n0x05 0 101 host Wallpaper\n"
        if args == ("/usr/bin/wmctrl", "-d"):
            return "0 * DG: 1280x800\n1 - DG: 1280x800\n"
        if args[0] == "/usr/bin/xprop":
            return "_NET_WM_WINDOW_TYPE_DOCK" if args[2] == "0x03" else "_NET_WM_WINDOW_TYPE_NORMAL"
        return ""
    monkeypatch.setattr(actions, "run", run)
    actions.show_desktop()
    assert ("/usr/bin/xdotool", "windowminimize", "0x02") in calls
    assert calls[-1] == ("/usr/bin/wmctrl", "-ia", "0x01")
    assert not any("0x04" in call or "0x05" in call for call in calls)
    assert ("/usr/bin/wmctrl", "-k", "on") not in calls


def test_other_desktops_use_their_standard_show_desktop(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setattr(actions.os, "getuid", lambda: 1000, raising=False)
    calls = []
    monkeypatch.setattr(actions, "run", lambda *args: calls.append(args))
    actions.show_desktop()
    assert calls == [("/usr/bin/wmctrl", "-k", "on")]


def test_locked_session_cannot_activate_window_overview(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["actions", "all_windows"])
    monkeypatch.setattr(actions.os, "getuid", lambda: 1000, raising=False)
    monkeypatch.setitem(sys.modules, "dbus", SimpleNamespace(SystemBus=lambda: object()))
    monkeypatch.setattr(actions, "unlocked_x11_session", lambda *args: False)
    assert actions.main() == actions.UNAVAILABLE
