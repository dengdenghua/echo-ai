import json
import threading
import time

import pytest

from runtime.execution.suckers.computer_feedback import desktop_feedback


@pytest.fixture
def signal(tmp_path, monkeypatch):
    path = tmp_path / "feedback.json"
    monkeypatch.setenv("ECHO_AUTOMATION_FEEDBACK_FILE", str(path))
    monkeypatch.setenv("ECHO_AUTOMATION_FEEDBACK_SESSION", "private-session")
    return path


def test_input_is_never_recorded_and_result_is_preserved(signal):
    @desktop_feedback("type")
    def action(**kwargs):
        assert json.loads(signal.read_text())["phase"] == "active"
        return {"text_len": len(kwargs["text"])}
    result = action(text="私密内容🙂", keys=["secret"], title="private window")
    data = json.loads(signal.read_text())
    assert result == {"text_len": 5}
    assert data["phase"] == "done"
    assert set(data) == {"session", "id", "kind", "phase", "at"}
    assert not list(signal.parent.glob("*.tmp"))


@pytest.mark.parametrize("failure", [ValueError, KeyboardInterrupt])
def test_exception_is_preserved_and_error_published(signal, failure):
    @desktop_feedback("click")
    def action(**kwargs):
        raise failure("original")
    with pytest.raises(failure, match="original"):
        action(x=100, y=200)
    assert json.loads(signal.read_text())["phase"] == "error"
    assert not any(t.name == "echo-input-feedback" for t in threading.enumerate())


def test_error_result_does_not_claim_success(signal):
    @desktop_feedback("key")
    def action():
        return {"error": "blocked"}
    assert action() == {"error": "blocked"}
    assert json.loads(signal.read_text())["phase"] == "error"


def test_unwritable_path_does_not_prevent_action(signal, monkeypatch):
    monkeypatch.setenv("ECHO_AUTOMATION_FEEDBACK_FILE", str(signal / "missing" / "signal"))
    assert desktop_feedback("click")(lambda: "executed")() == "executed"


def test_unavailable_thread_does_not_prevent_action(signal, monkeypatch):
    def unavailable(self):
        raise RuntimeError("cannot start thread")
    monkeypatch.setattr(threading.Thread, "start", unavailable)
    assert desktop_feedback("key")(lambda: "executed")() == "executed"
    assert json.loads(signal.read_text())["phase"] == "done"


def test_heartbeat_stays_active_then_stops(signal):
    @desktop_feedback("move")
    def action(**kwargs):
        first = json.loads(signal.read_text())["at"]
        time.sleep(0.55)
        active = json.loads(signal.read_text())
        assert active["at"] > first and active["phase"] == "active"
    action(x=100, y=200)
    final = signal.read_text()
    time.sleep(0.5)
    assert signal.read_text() == final


@pytest.mark.parametrize("value", ["", "relative.json"])
def test_absent_or_relative_signal_is_disabled(signal, monkeypatch, value):
    monkeypatch.setenv("ECHO_AUTOMATION_FEEDBACK_FILE", value)
    assert desktop_feedback("key")(lambda: 42)() == 42
    assert not signal.exists()
