from dataclasses import replace
from pathlib import Path

import pytest

from runtime.execution.environment import EnvironmentNotReady, ExecutionEnvironment
from runtime.execution.host_boundary import create_host_execution_boundary
from runtime.execution.request import current_execution_request, execution_request_scope
from runtime.platform.process.scope import ExecutionScope


def scope(root):
    return ExecutionScope("code", "code", (root,), (root,))


def test_environment_checks_device_dependencies_and_workspace(tmp_path, monkeypatch):
    (tmp_path / "project.toml").write_text("project")
    monkeypatch.setenv("ECHO_NODE_ID", "nas")
    monkeypatch.setattr("shutil.which", lambda name: "/bin/tool" if name == "tool" else None)
    spec = ExecutionEnvironment(tmp_path, "nas", ("tool",), ("project.toml",))
    assert spec.check(scope(tmp_path))["ready"] is True
    for invalid in (
        replace(spec, device_id="other"),
        replace(spec, executables=("missing",)),
        replace(spec, required_files=("missing.toml",)),
        replace(spec, required_files=("../secret",)),
        replace(spec, workspace=Path("relative")),
    ):
        with pytest.raises(EnvironmentNotReady):
            invalid.check(scope(tmp_path))


def test_missing_mount_fails_before_execution_without_creating_directory(tmp_path):
    missing = tmp_path / "offline-mount"
    boundary = create_host_execution_boundary(
        task_id="task",
        thread_id="thread",
        goal="edit",
        timeout_s=30,
        metadata={"workspace_path": str(missing), "mode": "code"},
    )
    entered = False
    with pytest.raises(EnvironmentNotReady), execution_request_scope(boundary.request):
        entered = True
    assert not entered
    assert not missing.exists()
    assert current_execution_request() is None


def test_existing_workspace_outside_permission_scope_is_rejected(tmp_path):
    outside = tmp_path / "outside"
    allowed = tmp_path / "allowed"
    outside.mkdir()
    allowed.mkdir()
    with pytest.raises(EnvironmentNotReady):
        ExecutionEnvironment(outside).check(scope(allowed))
