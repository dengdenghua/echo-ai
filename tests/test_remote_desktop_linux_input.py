"""Linux text never enters the command line or clipboard, including failures."""

import subprocess

import pytest

from runtime.tentacle import remote_desktop_input as subject


def test_linux_unicode_uses_utf8_stdin(monkeypatch):
    calls = []
    monkeypatch.setattr(subject.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")
    monkeypatch.setattr(subject.subprocess, "run", lambda args, **kw: calls.append((args, kw)))
    text = "中文，Hello 🌏\n第二行"
    subject.type_unicode(text)
    args, kwargs = calls[0]
    assert args == ["/usr/bin/xdotool", "type", "--clearmodifiers", "--delay", "1", "--file", "-"]
    assert kwargs["input"] == text.encode("utf-8")
    assert kwargs["env"]["LC_ALL"] == "C.UTF-8"
    assert kwargs["timeout"] == 15 and kwargs["check"]


@pytest.mark.parametrize("failure", [FileNotFoundError(), subprocess.TimeoutExpired("xdotool", 15), subprocess.CalledProcessError(1, "xdotool", stderr=b"secret")])
def test_linux_failure_does_not_expose_text(monkeypatch, failure):
    monkeypatch.setattr(subject.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")

    def failed(*args, **kwargs):
        raise failure

    monkeypatch.setattr(subject.subprocess, "run", failed)
    with pytest.raises(OSError, match="Linux Unicode input failed") as exc:
        subject.type_unicode("secret 中文")
    assert "secret" not in str(exc.value)


def test_wayland_rejects_before_starting_process(monkeypatch):
    monkeypatch.setattr(subject.sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "wayland")
    monkeypatch.setattr(subject.subprocess, "run", lambda *a, **kw: pytest.fail("process started"))
    with pytest.raises(ValueError, match="X11"):
        subject.type_unicode("中文")
