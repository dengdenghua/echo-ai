"""Exercise the real scoped executor arguments through command launchers."""

import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from runtime.platform.process.scope import execution_scope_ceiling, resolve_execution_scope
from runtime.platform.process.session import Session, session_scope
from runtime.platform.process.streaming import stream_run
from runtime.safety.sandboxing.execution_mode import command_boundary


@pytest.fixture
def full_access(tmp_path, monkeypatch):
    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("ECHO_PROCESS_SANDBOX", raising=False)
    monkeypatch.delenv("ECHO_DEPLOYMENT_MODE", raising=False)
    return Session(
        actor="test",
        agent=SimpleNamespace(agent_id="coder", capabilities={}),
        thread_id="local",
        metadata={
            "mode": "code",
            "workspace_path": str(tmp_path),
            "extra_workspaces": [str(tmp_path)],
            "permission_mode": "bypassPermissions",
            "execution_environment": "local",
            "sandbox_mode": "full",
            "approval_policy": "never",
        },
    )


def test_full_access_scoped_exec_reaches_host_without_sandbox(tmp_path, full_access, monkeypatch):
    from runtime.execution.suckers._write_skills_exec import _exec_shell
    from runtime.execution.suckers.registry import Skill
    from runtime.execution.tool_engine.executor import _prepare_scoped_args
    from runtime.platform.models import SkillId

    monkeypatch.setattr(
        "runtime.safety.sandboxing.execution_mode.command_process_backend",
        lambda: pytest.fail("full access invoked sandbox"),
    )
    skill = Skill(
        name="exec_shell",
        affinity=["exec"],
        handler=_exec_shell,
        trusted_source="skill://test/exec",
    )
    with session_scope(full_access):
        args = _prepare_scoped_args(
            skill,
            SkillId("exec_shell"),
            {
                "command": [sys.executable, "-c", "import os; print(os.getcwd())"],
                "cwd": str(tmp_path),
            },
        )
        assert args["sandbox_dir"]
        result = _exec_shell(**args)
    assert result["exit_code"] == 0, result
    assert result["sandbox_backend"] == "direct"
    assert result["execution_policy"]["sandbox_requested"] is False
    assert result["stdout"].strip() == str(tmp_path)


def test_full_access_stream_defaults_to_original_working_directory(tmp_path, full_access):
    with session_scope(full_access):
        result = stream_run(
            [sys.executable, "-c", "import os; print(os.getcwd())"],
            sandbox_dir=str(tmp_path),
            timeout=10,
        )
    assert result["exit_code"] == 0
    assert result["stdout"].strip() == str(tmp_path)
    assert result["execution_policy"]["sandbox_requested"] is False


def test_background_full_access_is_host_execution(tmp_path, full_access, monkeypatch):
    from runtime.execution.suckers import _write_skills_exec as commands

    monkeypatch.setattr(commands, "_BACKGROUND_PROCESSES", {})
    monkeypatch.setattr(
        "runtime.safety.sandboxing.execution_mode.command_process_backend",
        lambda: pytest.fail("full access invoked sandbox"),
    )
    with session_scope(full_access):
        result = commands._background_exec(
            [sys.executable, "-c", "print('host-ok')"], cwd=str(tmp_path), sandbox_dir=str(tmp_path)
        )
    task = commands._BACKGROUND_PROCESSES[result["task_id"]]
    try:
        assert task.proc.wait(timeout=10) == 0
        task._wait_thread.join(timeout=5)
        assert result["execution_policy"]["sandbox_requested"] is False
    finally:
        if task.proc.poll() is None:
            task.kill()


@pytest.mark.parametrize("mode", ["default", "acceptEdits", "autoSandbox"])
def test_bounded_modes_keep_requested_isolation(tmp_path, full_access, mode):
    full_access.metadata.update(permission_mode=mode, execution_environment="sandbox")
    with session_scope(full_access):
        assert command_boundary(None, str(tmp_path)) == (None, str(tmp_path))


@pytest.mark.parametrize(
    "variable,value", [("ECHO_PROCESS_SANDBOX", "strict"), ("ECHO_DEPLOYMENT_MODE", "shared")]
)
def test_deployment_required_isolation_still_wins(
    tmp_path, full_access, monkeypatch, variable, value
):
    monkeypatch.setenv(variable, value)
    with session_scope(full_access):
        assert command_boundary(None, str(tmp_path)) == (None, str(tmp_path))


def test_parent_sandbox_ceiling_cannot_be_bypassed(tmp_path, full_access):
    with session_scope(full_access):
        parent = replace(
            resolve_execution_scope(full_access),
            permission_mode="default",
            execution_environment="sandbox",
            sandbox_mode="sandbox",
        )
        with execution_scope_ceiling(parent):
            assert command_boundary(None, str(tmp_path)) == (None, str(tmp_path))


def test_no_session_keeps_explicit_sandbox(tmp_path):
    assert command_boundary(None, str(tmp_path)) == (None, str(tmp_path))


@pytest.mark.parametrize("background", [False, True])
def test_relative_exec_cwd_uses_task_workspace(tmp_path, full_access, monkeypatch, background):
    from runtime.execution.suckers import _write_skills_exec as commands
    from runtime.execution.suckers.registry import Skill
    from runtime.execution.tool_engine.executor import _prepare_scoped_args
    from runtime.platform.models import SkillId

    (tmp_path / "child").mkdir()
    host = tmp_path / "host"
    (host / "child").mkdir(parents=True)
    monkeypatch.chdir(host)
    monkeypatch.setattr(commands, "_BACKGROUND_PROCESSES", {})
    skill = Skill(
        name="exec_shell",
        affinity=["exec"],
        handler=commands._exec_shell,
        trusted_source="skill://test/exec",
    )
    with session_scope(full_access):
        args = _prepare_scoped_args(
            skill,
            SkillId("exec_shell"),
            {
                "command": [sys.executable, "-c", "import os; print(os.getcwd())"],
                "cwd": "child",
                "run_in_background": background,
            },
        )
        result = commands._exec_shell(**args)
    if background:
        task = commands._BACKGROUND_PROCESSES[result["task_id"]]
        try:
            assert task.proc.wait(timeout=10) == 0
            task._wait_thread.join(timeout=5)
            stdout = task.stdout_path.read_text(encoding="utf-8")
        finally:
            if task.proc.poll() is None:
                task.kill()
    else:
        assert result["exit_code"] == 0, result
        stdout = result["stdout"]
    assert Path(stdout.strip()).resolve() == (tmp_path / "child").resolve()


def test_relative_stream_cwd_uses_task_workspace(tmp_path, full_access, monkeypatch):
    (tmp_path / "child").mkdir()
    host = tmp_path / "host"
    (host / "child").mkdir(parents=True)
    monkeypatch.chdir(host)
    with session_scope(full_access):
        result = stream_run(
            [sys.executable, "-c", "import os; print(os.getcwd())"],
            cwd="child",
            sandbox_dir=str(tmp_path),
            timeout=10,
        )
    assert result["exit_code"] == 0, result
    assert Path(result["stdout"].strip()).resolve() == (tmp_path / "child").resolve()


def test_command_backend_follows_full_access(tmp_path, full_access):
    """Direct callers of command_process_backend must honour 完全访问 too.

    The scoped exec path never asks for a backend under full access (it drops
    ``sandbox_dir``), but other callers do. Before this, they still resolved
    the kernel sandbox (Windows MXC), which is what an operator sees as
    "full access is on, yet commands are still sandboxed".
    """
    from runtime.safety.sandboxing.execution_mode import command_process_backend
    from runtime.safety.sandboxing.sandbox import _reset_process_backend_cache

    _reset_process_backend_cache()
    with session_scope(full_access):
        choice = command_process_backend()

    assert choice.name == "direct"
    assert choice.hard is False


def test_command_backend_keeps_operator_ceiling(tmp_path, full_access, monkeypatch):
    """An explicit hard request outranks full access (fail closed)."""
    from runtime.safety.sandboxing import sandbox
    from runtime.safety.sandboxing.execution_mode import command_process_backend

    backend = SimpleNamespace(available=lambda: True)

    monkeypatch.setenv("ECHO_PROCESS_SANDBOX", "strict")
    monkeypatch.setattr(sandbox, "_hard_backend_candidates", lambda mode: [(backend, "test-hard")])
    monkeypatch.setattr(sandbox, "probe_backend_runs", lambda backend: True)
    with session_scope(full_access):
        choice = command_process_backend()

    assert choice.name == "test-hard"
    assert choice.hard is True
    assert choice.strict is True
