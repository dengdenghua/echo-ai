"""Kernel boundary and fail-closed regressions for workflow interpreter launch."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

from runtime.execution.workflow import WorkflowEngine, sandbox


@pytest.mark.parametrize("mode", ["production", "shared", "server", "commercial"])
def test_shared_modes_cannot_downgrade_to_unsandboxed(monkeypatch, mode):
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", mode)
    monkeypatch.setenv("ECHO_PROCESS_SANDBOX", "off")
    monkeypatch.setattr(sandbox.shutil, "which", lambda _: None)
    with pytest.raises(sandbox.WorkflowSandboxUnavailable, match="requires Linux bubblewrap"):
        sandbox.prepare_worker_launch({})


def test_strict_local_refuses_missing_backend(monkeypatch):
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "local")
    monkeypatch.setenv("ECHO_PROCESS_SANDBOX", "strict")
    monkeypatch.setattr(sandbox.shutil, "which", lambda _: None)
    with pytest.raises(sandbox.WorkflowSandboxUnavailable):
        sandbox.prepare_worker_launch({})


def test_local_snapshot_ignores_import_hooks_and_cleans_up(monkeypatch, tmp_path):
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "local")
    monkeypatch.setenv("ECHO_PROCESS_SANDBOX", "off")
    marker = tmp_path / "hook-ran"
    (tmp_path / "sitecustomize.py").write_text(f"open({str(marker)!r}, 'w').close()")
    launch = sandbox.prepare_worker_launch({**os.environ, "PYTHONPATH": str(tmp_path)})
    directory = Path(launch.cwd)
    try:
        assert not launch.isolated
        result = subprocess.run(
            launch.argv,
            env=launch.env,
            cwd=launch.cwd,
            text=True,
            input=json.dumps({"body": "return args", "args": "中文"}) + "\n",
            capture_output=True,
            timeout=15,
            encoding="utf-8",
        )
        assert result.returncode == 0, result.stderr
        assert "中文" in result.stdout
        assert not marker.exists()
        with zipfile.ZipFile(directory / "worker.pyz") as image:
            assert len(image.namelist()) == 6
    finally:
        launch.close()
    assert not directory.exists()


@pytest.mark.skipif(
    sys.platform != "linux" or not shutil.which("bwrap"), reason="requires Linux bubblewrap"
)
def test_kernel_blocks_host_files_and_host_network(monkeypatch, tmp_path):
    import socket

    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "production")
    secret = tmp_path / "host-secret"
    secret.write_text("not-visible-to-worker")
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    launch = sandbox.prepare_worker_launch({})
    # Trusted regression probe bypasses the DSL deliberately: the kernel, not
    # the AST allowlist, must deny direct Python filesystem/socket operations.
    code = f"""
import json, os, socket
from pathlib import Path
blocked = []
for operation in [lambda: Path({str(secret)!r}).read_text(),
                  lambda: Path({str(secret)!r}).write_text('bad'),
                  lambda: socket.create_connection(('127.0.0.1', {port}), timeout=1),
                  lambda: Path('/worker.pyz').write_text('bad')]:
    try:
        operation()
        blocked.append(False)
    except OSError:
        blocked.append(True)
print(json.dumps(blocked))
"""
    try:
        argv = launch.argv[:-1] + ["-c", code]
        result = subprocess.run(argv, env=launch.env, capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout) == [True] * 4
        assert secret.read_text() == "not-visible-to-worker"
    finally:
        listener.close()
        launch.close()


def test_unavailable_sandbox_resolves_run_error_without_dispatch(monkeypatch):
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "production")
    monkeypatch.setattr(sandbox.shutil, "which", lambda _: None)

    async def run():
        async def dispatch(request):
            pytest.fail("must not dispatch without isolation")

        engine = WorkflowEngine(child_dispatch=dispatch)
        task = engine.start(
            {
                "meta": {"name": "denied", "description": "test"},
                "script": 'return await agent("x")',
            }
        )
        result = await task.result
        assert result.stop_reason == "error"
        assert "requires Linux bubblewrap" in result.error
        await task.dispose()

    asyncio.run(run())


def test_broken_sandbox_does_not_retry_without_isolation(monkeypatch, tmp_path):
    from runtime.execution.workflow import engine as engine_module

    created = []

    def prepare(env):
        # Simulate an installed bwrap rejected by the host kernel. A failed
        # isolation launch must never be retried as a direct worker process.
        import tempfile

        directory = tempfile.TemporaryDirectory(dir=tmp_path)
        launch = sandbox.WorkerLaunch(
            [sys.executable, "-I", "-c", "raise SystemExit(77)"],
            env,
            directory.name,
            True,
            directory,
        )
        created.append(launch)
        return launch

    monkeypatch.setattr(engine_module, "prepare_worker_launch", prepare)

    async def run():
        async def dispatch(request):
            pytest.fail("broken sandbox must not dispatch")

        task = WorkflowEngine(child_dispatch=dispatch).start(
            {
                "meta": {"name": "denied", "description": "test"},
                "script": 'return await agent("x")',
            }
        )
        result = await task.result
        assert result.stop_reason == "error"
        assert "exit 77" in result.error
        await task.dispose()

    asyncio.run(run())
    assert len(created) == 1
    assert not Path(created[0].cwd).exists()
