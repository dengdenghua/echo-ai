"""Background shell fallback requires the same human consent as foreground execution."""

import sys
from types import SimpleNamespace

import pytest

from runtime.execution.suckers import _write_skills_exec as commands
from runtime.safety.approval.exec_consent import exec_consent_scope
from runtime.safety.sandboxing.sandbox import BackendChoice, DirectBackend


@pytest.fixture
def fallback_host(tmp_path, monkeypatch):
    from runtime.safety.sandboxing import execution_mode

    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(commands, "_BACKGROUND_PROCESSES", {})
    monkeypatch.setattr(commands, "_inference_domains", lambda: ())
    monkeypatch.setattr(
        execution_mode,
        "command_process_backend",
        lambda: BackendChoice(DirectBackend(), "direct", hard=False, needs_approval=True),
    )
    yield
    for task in list(commands._BACKGROUND_PROCESSES.values()):
        if task.proc.poll() is None:
            task.kill()
        task.proc.wait(timeout=5)
        task._wait_thread.join(timeout=5)


def _start(tmp_path):
    return commands._exec_shell(
        [sys.executable, "-c", "from pathlib import Path; Path('consented').touch()"],
        sandbox_dir=str(tmp_path),
        run_in_background=True,
    )


def _assert_completed(result):
    assert "error" not in result, result
    task = commands._BACKGROUND_PROCESSES[result["task_id"]]
    assert task.proc.wait(timeout=10) == 0
    task._wait_thread.join(timeout=5)
    assert task.snapshot()["status"] == "completed"


def test_background_fallback_without_human_provider_cannot_spawn(tmp_path, fallback_host):
    with exec_consent_scope(approved=False, provider=None):
        result = _start(tmp_path)
    assert result["error"].startswith("sandbox_fallback_needs_approval:")
    assert result["execution_policy"]["result"]["status"] == "needs_approval"
    assert not commands._BACKGROUND_PROCESSES
    assert not (tmp_path / "consented").exists()


@pytest.mark.parametrize("approved", [False, True])
def test_background_fallback_asks_once_with_explicit_unconfined_notice(
    tmp_path, fallback_host, approved
):
    requests = []

    class Broker:
        def request(self, request, *, timeout):
            requests.append(request)
            return SimpleNamespace(approved=approved)

    with exec_consent_scope(approved=False, provider=Broker()):
        result = _start(tmp_path)
    assert len(requests) == 1
    assert requests[0].unconfined is True
    assert requests[0].tool_name == "background_exec"
    if approved:
        _assert_completed(result)
        assert (tmp_path / "consented").exists()
    else:
        assert result["error"].startswith("sandbox_fallback_denied:")
        assert result["execution_policy"]["result"]["status"] == "denied"
        assert not commands._BACKGROUND_PROCESSES
        assert not (tmp_path / "consented").exists()


def test_background_fallback_reuses_prior_human_consent(tmp_path, fallback_host):
    class Broker:
        def request(self, request, *, timeout):
            pytest.fail("already approved unconfined execution must not ask twice")

    with exec_consent_scope(approved=True, provider=Broker()):
        result = _start(tmp_path)
    _assert_completed(result)
    assert (tmp_path / "consented").exists()
