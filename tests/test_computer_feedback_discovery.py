"""Native Linux discovery: a separate Agent only sees its live private shell."""
import json
import os
import sys
import time

import pytest

from runtime.execution.suckers.computer_feedback import _feedback_endpoint, desktop_feedback

pytestmark = pytest.mark.skipif(sys.platform != "linux", reason="native Linux ownership/mode contract")


@pytest.fixture
def discovery(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setenv("ECHO_AUTOMATION_FEEDBACK_DISCOVERY", "1")
    monkeypatch.delenv("ECHO_AUTOMATION_FEEDBACK_FILE", raising=False)
    monkeypatch.delenv("ECHO_AUTOMATION_FEEDBACK_SESSION", raising=False)
    directory = tmp_path / ".cache/echo-os/automation-feedback"
    directory.mkdir(parents=True, mode=0o700)
    def owner(session="a" * 32, **extra):
        value = {"session": session, "display": ":0", "at": int(time.time() * 1000), **extra}
        path = directory / f"owner-{session}.json"
        path.write_text(json.dumps(value))
        path.chmod(0o600)
        return path
    return directory, owner


def test_independent_agent_discovers_live_shell_without_inherited_session(discovery):
    directory, owner = discovery
    owner()
    path, session = _feedback_endpoint()
    assert session == "a" * 32
    assert path == directory / f"automation-feedback-{session}.json"
    assert desktop_feedback("type")(lambda text: len(text))("不记录输入内容🙂") == 8
    packet = json.loads(path.read_text())
    assert packet["phase"] == "done"
    assert set(packet) == {"session", "id", "kind", "phase", "at"}


@pytest.mark.parametrize("extra", [
    {"at": 1}, {"at": int(time.time() * 1000) + 60000},
    {"at": "not a time"}, {"display": ":1"}, {"display": None},
    {"session": "../../outside"},
])
def test_stale_wrong_seat_and_malformed_owners_are_ignored(discovery, extra):
    directory, owner = discovery
    path = owner()
    value = json.loads(path.read_text())
    value.update(extra)
    path.write_text(json.dumps(value))
    assert _feedback_endpoint() is None
    assert desktop_feedback("key")(lambda: "actual action")() == "actual action"
    assert not list(directory.glob("automation-feedback-*.json"))


def test_ambiguous_shells_are_not_misattributed(discovery):
    _, owner = discovery
    owner()
    second = owner("b" * 32)
    assert _feedback_endpoint() is None
    second.unlink()
    assert _feedback_endpoint()[1] == "a" * 32


def test_old_owner_expires_and_new_shell_is_discovered(discovery):
    _, owner = discovery
    owner(at=int(time.time() * 1000) - 4000)
    newer = owner("b" * 32)
    assert _feedback_endpoint()[1] == "b" * 32
    newer.unlink()
    assert _feedback_endpoint() is None


@pytest.mark.parametrize("target", ["directory", "owner", "symlink", "oversize", "fifo"])
def test_untrusted_discovery_files_are_rejected(discovery, target):
    directory, owner = discovery
    entry = owner()
    if target == "directory":
        directory.chmod(0o755)
    elif target == "owner":
        entry.chmod(0o644)
    elif target == "oversize":
        entry.write_text(" " * 513)
    elif target == "symlink":
        real = entry.with_suffix(".saved")
        entry.rename(real)
        entry.symlink_to(real)
    else:
        entry.unlink()
        os.mkfifo(entry, 0o600)
    assert _feedback_endpoint() is None


def test_discovery_requires_service_opt_in(discovery, monkeypatch):
    _, owner = discovery
    owner()
    monkeypatch.delenv("ECHO_AUTOMATION_FEEDBACK_DISCOVERY")
    assert _feedback_endpoint() is None


def test_embedded_agent_keeps_its_explicit_shell_session(discovery, monkeypatch, tmp_path):
    _, owner = discovery
    owner()
    own = tmp_path / "own-signal.json"
    monkeypatch.setenv("ECHO_AUTOMATION_FEEDBACK_FILE", str(own))
    monkeypatch.setenv("ECHO_AUTOMATION_FEEDBACK_SESSION", "existing-session")
    assert _feedback_endpoint() == (own, "existing-session")
