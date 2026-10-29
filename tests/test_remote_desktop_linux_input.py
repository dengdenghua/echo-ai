"""Linux text never enters the command line or clipboard, including failures."""

import subprocess
from types import SimpleNamespace

import pytest

from runtime.tentacle import remote_desktop_input as subject
from runtime.tentacle import remote_desktop_x11_keys as keyboard


@pytest.mark.parametrize("text", ["ASCII text", "中文，Hello 🌏\n第二行"])
def test_linux_unicode_uses_utf8_stdin(monkeypatch, text):
    calls = []
    monkeypatch.setattr(subject.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(subject.subprocess, "run", run)
    subject.type_unicode(text)
    args, kwargs = calls[0]
    assert args[0] == "/usr/bin/python3"
    assert args[1].endswith("remote_desktop_x11_text.py")
    assert kwargs["input"] == text.encode("utf-8")
    assert kwargs["env"]["LC_ALL"] == "C.UTF-8"
    assert kwargs["timeout"] == 5 and not kwargs["check"]


def test_only_known_unavailable_editor_falls_back(monkeypatch):
    calls = []
    monkeypatch.setattr(subject.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")

    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=69 if len(calls) == 1 else 0)

    monkeypatch.setattr(subject.subprocess, "run", run)
    values = []
    monkeypatch.setattr(keyboard, "type_x11_text", values.append)
    subject.type_unicode("终端输入")
    assert len(calls) == 1
    assert values == ["终端输入"]


def test_ambiguous_editor_failure_is_never_replayed(monkeypatch):
    calls = []
    monkeypatch.setattr(subject.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")

    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=70)

    monkeypatch.setattr(subject.subprocess, "run", run)
    with pytest.raises(OSError):
        subject.type_unicode("只输入一次")
    assert len(calls) == 1


@pytest.mark.parametrize(
    "failure",
    [
        FileNotFoundError(),
        subprocess.TimeoutExpired("xdotool", 15),
        subprocess.CalledProcessError(1, "xdotool", stderr=b"secret"),
    ],
)
def test_linux_failure_does_not_expose_text(monkeypatch, failure):
    monkeypatch.setattr(subject.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")

    def failed(*args, **kwargs):
        raise failure

    monkeypatch.setattr(subject.subprocess, "run", failed)
    monkeypatch.setattr(keyboard, "type_x11_text", lambda _: failed())
    with pytest.raises(OSError, match="Linux Unicode input failed") as exc:
        subject.type_unicode("secret 中文")
    assert "secret" not in str(exc.value)


def test_wayland_rejects_before_starting_process(monkeypatch):
    monkeypatch.setattr(subject.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "wayland")
    monkeypatch.setattr(subject.subprocess, "run", lambda *a, **kw: pytest.fail("process started"))
    with pytest.raises(ValueError, match="X11"):
        subject.type_unicode("中文")
