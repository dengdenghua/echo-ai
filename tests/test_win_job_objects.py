"""Windows Job Object process-tree containment (runtime/platform/process/win_job.py).

The Windows tests launch real python children that start python
grandchildren and record their pids, then check the grandchildren are gone
after the job is closed, the parent is killed, or the tree is terminated.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from runtime.platform.process import win_job
from runtime.platform.process.tree import (
    close_process_job,
    detach_process_job,
    process_job,
    spawn_in_job,
    terminate_process_tree,
    windows_pid_alive,
)
from runtime.platform.process.win_job import JobLimits, WindowsJob

REPO_ROOT = Path(__file__).resolve().parents[1]
windows_only = pytest.mark.skipif(sys.platform != "win32", reason="Windows Job Objects")


def _wait_until(predicate: Callable[[], bool], timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


def _read_pid(path: Path) -> int:
    assert _wait_until(lambda: path.is_file() and path.read_text().strip() != ""), path
    return int(path.read_text().strip())


def _child_code(pid_file: Path, *, linger: bool) -> str:
    """A child that starts a 60 s grandchild, records its pid, then lingers or exits."""
    return (
        "import pathlib, subprocess, sys, time\n"
        "gc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
        f"pathlib.Path({str(pid_file)!r}).write_text(str(gc.pid))\n"
        + ("time.sleep(60)\n" if linger else "")
    )


@pytest.fixture
def reap() -> Any:
    """Kill anything a failing test leaves behind (by pid, via taskkill)."""
    pids: list[int] = []
    yield pids.append
    from runtime.platform.process.tree import terminate_pid_tree

    for pid in pids:
        if windows_pid_alive(pid):
            terminate_pid_tree(pid)


@windows_only
def test_closing_the_job_kills_child_and_grandchild(tmp_path: Path, reap: Any) -> None:
    pid_file = tmp_path / "grandchild.pid"
    proc = spawn_in_job([sys.executable, "-c", _child_code(pid_file, linger=True)])
    reap(proc.pid)
    grandchild = _read_pid(pid_file)
    reap(grandchild)
    job = process_job(proc)
    assert job is not None and job.active
    assert {proc.pid, grandchild} <= set(job.process_ids())

    close_process_job(proc)

    assert _wait_until(lambda: not windows_pid_alive(grandchild))
    assert proc.wait(timeout=10) is not None


@windows_only
def test_terminate_reaches_grandchild_orphaned_by_exited_parent(tmp_path: Path, reap: Any) -> None:
    # taskkill /T walks parent links and cannot see this grandchild once its
    # parent has exited; the job still contains it.
    pid_file = tmp_path / "grandchild.pid"
    proc = spawn_in_job([sys.executable, "-c", _child_code(pid_file, linger=False)])
    reap(proc.pid)
    grandchild = _read_pid(pid_file)
    reap(grandchild)
    assert proc.wait(timeout=10) == 0
    assert windows_pid_alive(grandchild)

    assert terminate_process_tree(proc) is True

    assert _wait_until(lambda: not windows_pid_alive(grandchild))


@windows_only
def test_detach_lets_survivors_live(tmp_path: Path, reap: Any) -> None:
    pid_file = tmp_path / "grandchild.pid"
    proc = spawn_in_job([sys.executable, "-c", _child_code(pid_file, linger=False)])
    reap(proc.pid)
    grandchild = _read_pid(pid_file)
    reap(grandchild)
    assert proc.wait(timeout=10) == 0

    detach_process_job(proc)

    assert process_job(proc) is None
    time.sleep(0.5)
    assert windows_pid_alive(grandchild)


@windows_only
def test_backend_exit_kills_the_whole_tree(tmp_path: Path, reap: Any) -> None:
    """The launching process dies hard (TerminateProcess); its job takes the tree."""
    child_pid_file = tmp_path / "child.pid"
    grandchild_pid_file = tmp_path / "grandchild.pid"
    launcher_code = (
        "import pathlib, sys, time\n"
        "from runtime.platform.process.tree import spawn_in_job\n"
        f"child = spawn_in_job([sys.executable, '-c', {_child_code(grandchild_pid_file, linger=True)!r}])\n"
        f"pathlib.Path({str(child_pid_file)!r}).write_text(str(child.pid))\n"
        "time.sleep(60)\n"
    )
    env = {**os.environ, "PYTHONPATH": str(REPO_ROOT)}
    launcher = subprocess.Popen([sys.executable, "-c", launcher_code], cwd=REPO_ROOT, env=env)
    reap(launcher.pid)
    child = _read_pid(child_pid_file)
    reap(child)
    grandchild = _read_pid(grandchild_pid_file)
    reap(grandchild)
    assert windows_pid_alive(child) and windows_pid_alive(grandchild)

    launcher.kill()
    launcher.wait(timeout=10)

    assert _wait_until(lambda: not windows_pid_alive(child))
    assert _wait_until(lambda: not windows_pid_alive(grandchild))


@windows_only
def test_process_memory_limit_fails_oversized_allocations() -> None:
    code = (
        "import sys\n"
        "small = bytearray(8 << 20)\n"
        "print('small-ok', flush=True)\n"
        "big = bytearray(512 << 20)\n"
        "print('big-ok', flush=True)\n"
    )
    proc = spawn_in_job(
        [sys.executable, "-c", code],
        limits=JobLimits(process_memory_bytes=128 << 20),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    stdout, stderr = proc.communicate(timeout=30)
    assert process_job(proc) is not None
    assert "small-ok" in stdout
    assert "big-ok" not in stdout
    assert proc.returncode != 0
    assert "MemoryError" in stderr


@windows_only
def test_active_process_limit_blocks_grandchildren() -> None:
    code = (
        "import subprocess, sys\n"
        "try:\n"
        "    subprocess.run([sys.executable, '-c', 'pass'], check=True)\n"
        "    print('spawned')\n"
        "except OSError as exc:\n"
        "    print('blocked', exc.winerror)\n"
    )
    # A venv's python.exe is a launcher that itself starts the real
    # interpreter as a second process; the base interpreter is one process.
    interpreter = getattr(sys, "_base_executable", None) or sys.executable
    proc = spawn_in_job(
        [interpreter, "-c", code],
        limits=JobLimits(active_processes=1),
        stdout=subprocess.PIPE,
        text=True,
    )
    stdout, _ = proc.communicate(timeout=30)
    assert stdout.startswith("blocked"), stdout


@windows_only
def test_assign_failure_degrades_to_plain_launch(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, tmp_path: Path, reap: Any
) -> None:
    monkeypatch.setattr(win_job._kernel32(), "AssignProcessToJobObject", lambda *_a: 0)
    pid_file = tmp_path / "grandchild.pid"
    with caplog.at_level(logging.WARNING, logger=win_job.__name__):
        proc = spawn_in_job([sys.executable, "-c", _child_code(pid_file, linger=True)])
    reap(proc.pid)
    grandchild = _read_pid(pid_file)  # the child was resumed and runs normally
    reap(grandchild)

    assert process_job(proc) is None
    assert "AssignProcessToJobObject" in caplog.text
    # Old behaviour is intact: taskkill /T still ends the live tree.
    assert terminate_process_tree(proc) is True
    assert _wait_until(lambda: not windows_pid_alive(grandchild))


@windows_only
def test_resume_failure_relaunches_without_a_job(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    launched: list[subprocess.Popen[Any]] = []
    real_popen = subprocess.Popen

    def recording_popen(*args: Any, **kwargs: Any) -> subprocess.Popen[Any]:
        proc = real_popen(*args, **kwargs)
        launched.append(proc)
        return proc

    monkeypatch.setattr(win_job, "resume_suspended_process", lambda _pid: False)
    monkeypatch.setattr(subprocess, "Popen", recording_popen)
    marker = tmp_path / "ran"
    code = f"import pathlib; pathlib.Path({str(marker)!r}).write_text('x')"

    proc = spawn_in_job([sys.executable, "-c", code])

    assert proc.wait(timeout=10) == 0
    assert marker.read_text() == "x"
    assert len(launched) == 2 and launched[1] is proc
    assert launched[0].poll() is not None  # the never-resumed first attempt is gone
    assert process_job(proc) is None


@windows_only
def test_kill_switch_disables_jobs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ECHO_WINDOWS_JOB_OBJECTS", "0")
    proc = spawn_in_job([sys.executable, "-c", "pass"])
    assert proc.wait(timeout=10) == 0
    assert process_job(proc) is None
    assert not WindowsJob().active


@windows_only
def test_process_tree_manager_spawn_contains_grandchildren(tmp_path: Path, reap: Any) -> None:
    from runtime.execution.arms.process_tree import ProcessTreeManager

    pid_file = tmp_path / "grandchild.pid"

    async def scenario() -> int:
        manager = ProcessTreeManager(grace_period=0.5)
        proc = await manager.spawn(sys.executable, "-c", _child_code(pid_file, linger=True))
        reap(proc.pid)
        grandchild = await asyncio.to_thread(_read_pid, pid_file)
        reap(grandchild)
        assert process_job(proc) is not None
        await manager.terminate_all()
        assert manager.active_count == 0
        return grandchild

    grandchild = asyncio.run(scenario())
    assert _wait_until(lambda: not windows_pid_alive(grandchild))


@windows_only
def test_background_exec_kill_reaches_orphaned_grandchild(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, reap: Any
) -> None:
    from runtime.execution.suckers._write_skills_background import _BACKGROUND_PROCESSES
    from runtime.execution.suckers._write_skills_exec import (
        _background_exec,
        _kill_background_exec,
    )

    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "data"))
    pid_file = tmp_path / "grandchild.pid"
    started = _background_exec(command=[sys.executable, "-c", _child_code(pid_file, linger=False)])
    assert "error" not in started, started
    task = _BACKGROUND_PROCESSES[started["task_id"]]
    grandchild = _read_pid(pid_file)
    reap(grandchild)
    job = process_job(task.proc)
    assert job is not None
    assert job.limits.kill_on_close is False  # background tasks survive a backend restart
    assert task.proc.wait(timeout=10) == 0
    assert windows_pid_alive(grandchild)

    result = _kill_background_exec(task_id=started["task_id"])

    assert result["status"] == "cancelled"
    assert _wait_until(lambda: not windows_pid_alive(grandchild))


@pytest.mark.skipif(sys.platform == "win32", reason="non-Windows no-op contract")
def test_job_helpers_are_noops_off_windows() -> None:
    job = WindowsJob(JobLimits(process_memory_bytes=1 << 20, active_processes=1))
    assert not job.active
    assert not win_job.job_objects_enabled()
    assert job.assign_process(os.getpid()) is False
    assert job.terminate() is False
    assert job.process_ids() == []
    job.close()
    assert win_job.resume_suspended_process(os.getpid()) is False

    proc = spawn_in_job([sys.executable, "-c", "pass"])
    assert proc.wait(timeout=10) == 0
    assert process_job(proc) is None
    close_process_job(proc)  # no-op, must not raise


def test_job_limits_flags() -> None:
    assert JobLimits().limit_flags() == 0x2000
    assert JobLimits(kill_on_close=False).limit_flags() == 0
    flags = JobLimits(process_memory_bytes=1, job_memory_bytes=1, active_processes=1).limit_flags()
    assert flags == 0x2000 | 0x100 | 0x200 | 0x8
