"""Bounded X11 desktop actions, run by the session's system Python for D-Bus."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

if __package__:
    from .remote_desktop_x11_text import unlocked_x11_session
else:
    from remote_desktop_x11_text import unlocked_x11_session

UNAVAILABLE = 69
FAILED = 70


def run(*arguments):
    return subprocess.check_output(arguments, timeout=3, stderr=subprocess.DEVNULL).decode()


def show_desktop():
    marker = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")) / "echo-os/desktop-ready"
    if marker.is_file():
        # Echo's interactive desktop is a below-normal window. EWMH's global
        # "show desktop" hides it too; minimize other apps without hiding the shell.
        windows = [line.split(None, 4) for line in run("/usr/bin/wmctrl", "-lp").splitlines()]
        windows = [w for w in windows if len(w) == 5 and re.fullmatch(r"0x[0-9a-fA-F]+", w[0])]
        shells = [w for w in windows if w[4] == "ECHO OS"]
        if len(shells) == 1:
            shell = shells[0]
            run("/usr/bin/wmctrl", "-k", "off")
            current = next((line.split()[0] for line in run("/usr/bin/wmctrl", "-d").splitlines() if line.split()[1] == "*"), shell[1])
            targets = []
            for window in windows[:128]:
                if window[2] == shell[2] or window[1] not in {current, "-1"}:
                    continue
                kind = run("/usr/bin/xprop", "-id", window[0], "_NET_WM_WINDOW_TYPE")
                if any(role in kind for role in ("_DOCK", "_DESKTOP", "_NOTIFICATION")):
                    continue
                targets.extend(("windowminimize", window[0]))
            if targets:
                run("/usr/bin/xdotool", *targets)
            run("/usr/bin/wmctrl", "-ia", shell[0])
            return
    run("/usr/bin/wmctrl", "-k", "on")


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"show_desktop", "all_windows"}:
        return FAILED
    try:
        import dbus
        if not unlocked_x11_session(dbus.SystemBus(), os.getuid(), os.environ.get("DISPLAY", "")):
            return UNAVAILABLE
        if sys.argv[1] == "show_desktop":
            show_desktop()
        else:
            # KWin's D-Bus API accepts decimal X11 IDs; an empty list does nothing.
            # https://invent.kde.org/plasma/kwin/-/blob/v6.3.6/src/plugins/windowview/windowvieweffect.cpp
            handles = [str(int(line.split()[0], 16)) for line in run("/usr/bin/wmctrl", "-l").splitlines() if line.split() and re.fullmatch(r"0x[0-9a-fA-F]+", line.split()[0])][:128]
            if not handles:
                return UNAVAILABLE
            view = dbus.SessionBus().get_object("org.kde.KWin.Effect.WindowView1", "/org/kde/KWin/Effect/WindowView1")
            view.activate(dbus.Array(handles, signature="s"), dbus_interface="org.kde.KWin.Effect.WindowView1", timeout=2)
        return 0
    except Exception:
        # Never return native exceptions, window titles or session-bus details.
        return FAILED


if __name__ == "__main__":
    raise SystemExit(main())
