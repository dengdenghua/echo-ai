"""Content-free desktop activity signal for the owning Electron shell.

This is visual feedback only. It cannot authorize or execute input. The shell
supplies a per-launch file and session; no keys, typed text or window titles
are written. A heartbeat expires if the worker crashes or is interrupted.
"""
from __future__ import annotations

import functools
import itertools
import json
import os
import re
import stat
import sys
import threading
import time
import uuid
from pathlib import Path


def _discovered_feedback():
    """Discover one live desktop owned by this service user, never another seat.

    Native systemd Agents opt in explicitly. The short-lived descriptor is
    decoration-only; no command, typed content or authorization travels here.
    Ambiguous displays fail closed instead of attributing input to a wrong UI.
    """
    if sys.platform != "linux" or os.environ.get("ECHO_AUTOMATION_FEEDBACK_DISCOVERY") != "1":
        return None
    directory = Path.home().resolve() / ".cache" / "echo-os" / "automation-feedback"
    try:
        info = directory.lstat()
        if (not stat.S_ISDIR(info.st_mode) or directory.resolve() != directory
                or info.st_uid != os.getuid() or info.st_mode & 0o077):
            return None
        owners = list(itertools.islice(directory.glob("owner-*.json"), 65))
        if len(owners) > 64:
            return None
        candidates = []
        now = int(time.time() * 1000)
        display = os.environ.get("DISPLAY", "")
        for owner in owners:
            try:
                fd = os.open(owner, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, "r", encoding="utf-8") as stream:
                    info = os.fstat(stream.fileno())
                    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                            or info.st_mode & 0o077 or info.st_size > 512):
                        continue
                    value = json.loads(stream.read(513))
                if not isinstance(value, dict):
                    continue
                session = value.get("session")
                at = value.get("at")
                if (not isinstance(session, str) or not re.fullmatch(r"[a-f0-9]{32}", session)
                        or owner.name != f"owner-{session}.json"
                        or type(at) not in (int, float) or not (-1000 <= now - at <= 3500)
                        or not isinstance(value.get("display"), str)
                        or (display and value["display"] != display)):
                    continue
                candidates.append((directory / f"automation-feedback-{session}.json", session))
            except (OSError, ValueError, UnicodeError):
                continue
        return candidates[0] if len(candidates) == 1 else None
    except OSError:
        return None


def _feedback_endpoint():
    raw = os.environ.get("ECHO_AUTOMATION_FEEDBACK_FILE", "")
    session = os.environ.get("ECHO_AUTOMATION_FEEDBACK_SESSION", "")
    if raw or session:
        return (Path(raw), session) if raw and session and Path(raw).is_absolute() else None
    return _discovered_feedback()


def _publish(path, session, action_id, kind, phase, point):
    payload = {"session": session, "id": action_id, "kind": kind, "phase": phase,
               "at": int(time.time() * 1000), **point}
    temporary = path.with_name(path.name + "." + action_id + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(payload, stream, separators=(",", ":"))
        os.replace(temporary, path)
    except OSError:
        pass  # Decoration must never change the result of the real action.
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def desktop_feedback(kind):
    def decorate(handler):
        @functools.wraps(handler)
        def wrapped(*args, **kwargs):
            try:
                endpoint = _feedback_endpoint()
            except (OSError, ValueError, RuntimeError):
                endpoint = None  # Discovery must never prevent real input.
            if endpoint is None:
                return handler(*args, **kwargs)
            path, session = endpoint
            point = {}
            for key in ("x", "y"):
                value = kwargs.get(key)
                if type(value) is int:
                    point[key] = value
            action_id = uuid.uuid4().hex
            stop = threading.Event()
            def heartbeat():
                while not stop.wait(0.4):
                    _publish(path, session, action_id, kind, "active", point)
            _publish(path, session, action_id, kind, "active", point)
            worker = threading.Thread(target=heartbeat, daemon=True, name="echo-input-feedback")
            try:
                worker.start()
            except RuntimeError:
                worker = None  # Resource pressure must not block actual input.
            phase = "error"
            try:
                result = handler(*args, **kwargs)
                phase = "error" if isinstance(result, dict) and "error" in result else "done"
                return result
            finally:
                stop.set()
                if worker is not None:
                    worker.join(timeout=0.6)
                _publish(path, session, action_id, kind, phase, point)
        return wrapped
    return decorate
