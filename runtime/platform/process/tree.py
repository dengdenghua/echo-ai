"""Synchronous subprocess group lifecycle helpers.

On Windows, :func:`spawn_in_job` additionally binds the child's whole tree to
a Job Object (see :mod:`runtime.platform.process.win_job`), and
:func:`terminate_process_tree` prefers ending that job over ``taskkill``.
"""

from __future__ import annotations

import contextlib
import logging
import os
import signal
import subprocess
import sys
import time
from typing import Any

from runtime.platform.process.win_job import (
    CREATE_SUSPENDED,
    JobLimits,
    WindowsJob,
    attach_suspended,
    job_for,
    release_job,
)

_logger = logging.getLogger(__name__)


def process_group_kwargs() -> dict[str, Any]:
    """Return kwargs that launch a child in its own process group/session."""
    if sys.platform == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)}
    return {"start_new_session": True}


def spawn_in_job(
    args: Any,
    *,
    limits: JobLimits | None = None,
    **popen_kwargs: Any,
) -> subprocess.Popen[Any]:
    """``Popen`` in its own process group/session and, on Windows, a Job Object.

    POSIX: exactly ``Popen(args, start_new_session=True, **popen_kwargs)``.

    Windows: ``creationflags`` gain ``CREATE_NEW_PROCESS_GROUP``; the child
    is created ``CREATE_SUSPENDED``, assigned to a fresh job (kill-on-close
    unless ``limits`` says otherwise) and only then resumed, so nothing it
    spawns can start outside the job. Any job failure logs a warning and
    degrades to the plain process-group launch, which
    :func:`terminate_process_tree` ends with ``taskkill /T`` as before.

    The job closes, killing whatever is still in it, when the returned
    ``Popen`` is garbage collected, when this process exits, or earlier via
    :func:`close_process_job`.
    """
    if sys.platform != "win32":
        return subprocess.Popen(args, **{**process_group_kwargs(), **popen_kwargs})
    flags = int(popen_kwargs.pop("creationflags", 0)) | int(process_group_kwargs()["creationflags"])
    job = WindowsJob(limits)
    if not job.active:
        return subprocess.Popen(args, creationflags=flags, **popen_kwargs)
    try:
        proc = subprocess.Popen(args, creationflags=flags | CREATE_SUSPENDED, **popen_kwargs)
    except BaseException:
        job.close()
        raise
    # A caller that asked for CREATE_SUSPENDED itself resumes the child.
    if attach_suspended(job, proc, resume=not (flags & CREATE_SUSPENDED)):
        return proc
    # The child never ran a single instruction, so relaunching is side-effect free.
    _discard_unstarted(proc)
    return subprocess.Popen(args, creationflags=flags, **popen_kwargs)


def process_job(proc: object) -> WindowsJob | None:
    """The Job Object :func:`spawn_in_job` bound to ``proc``, if any."""
    return job_for(proc)


def close_process_job(proc: object) -> None:
    """Close ``proc``'s job now: kill-on-close ends any surviving descendants."""
    release_job(proc)


def detach_process_job(proc: object) -> None:
    """Drop ``proc``'s job but let descendants that are still running live on."""
    release_job(proc, kill_survivors=False)


def _discard_unstarted(proc: subprocess.Popen[Any]) -> None:
    with contextlib.suppress(OSError):
        proc.kill()
    with contextlib.suppress(subprocess.TimeoutExpired):
        proc.wait(timeout=5)
    for stream in (proc.stdin, proc.stdout, proc.stderr):
        if stream is not None:
            with contextlib.suppress(OSError):
                stream.close()


def windows_pid_alive(pid: int) -> bool:
    """Query a Windows process without delivering console control events."""
    import ctypes
    from ctypes import wintypes

    if pid <= 0:
        return False
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ctypes.get_last_error() == 5  # type: ignore[attr-defined]  # Access denied
    try:
        exit_code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return True
        return exit_code.value == 259  # STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def terminate_process_tree(
    proc: subprocess.Popen[Any],
    *,
    grace_s: float = 1.0,
    kill_wait_s: float = 2.0,
) -> bool:
    """Best-effort terminate of ``proc`` and descendants.

    Returns True when the process has exited by the end of the attempt. With
    a Job Object (see :func:`spawn_in_job`) the whole job is ended first,
    even when ``proc`` itself already exited: that is how grandchildren
    orphaned by an exited parent, which ``taskkill /T`` cannot see, are
    reached.
    """
    if _terminate_job(proc, grace_s + kill_wait_s):
        return True
    if proc.poll() is not None:
        return True
    if sys.platform == "win32":
        _terminate_windows_tree(proc)
    else:
        _signal_posix_group(proc, signal.SIGTERM)
    if _wait_exited(proc, grace_s):
        return True
    if sys.platform == "win32":
        with contextlib.suppress(OSError):
            proc.kill()
    else:
        _signal_posix_group(proc, signal.SIGKILL)
    return _wait_exited(proc, kill_wait_s)


def terminate_pid_tree(
    pid: int,
    *,
    grace_s: float = 1.0,
    kill_wait_s: float = 2.0,
) -> bool:
    """Best-effort terminate of a process tree when only the pid is known."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        _taskkill_windows_pid(pid)
        return True
    _signal_posix_pid_group(pid, signal.SIGTERM)
    if _pid_exited(pid, grace_s):
        return True
    _signal_posix_pid_group(pid, signal.SIGKILL)
    return _pid_exited(pid, kill_wait_s)


def run_capture(
    argv: list[str],
    *,
    cwd: str | None = None,
    env: dict[str, str] | None = None,
    timeout: float | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a command with captured output and descendant-safe timeout cleanup.

    This is the bounded-output counterpart for callers that need the familiar
    ``CompletedProcess`` contract. Unlike ``subprocess.run(timeout=...)``, a
    timeout terminates the process group/session before reaping the direct
    child, so shells and CLI descendants do not survive the request.
    """
    proc = spawn_in_job(
        argv,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        terminate_process_tree(proc, grace_s=0.2, kill_wait_s=0.5)
        try:
            stdout, stderr = proc.communicate(timeout=1.0)
        except subprocess.TimeoutExpired as final_exc:
            with contextlib.suppress(OSError):
                proc.kill()
            stdout, stderr = proc.communicate()
            if not stdout:
                stdout = final_exc.stdout or exc.stdout or ""
            if not stderr:
                stderr = final_exc.stderr or exc.stderr or ""
        raise subprocess.TimeoutExpired(
            cmd=argv,
            timeout=exc.timeout,
            output=stdout or exc.stdout,
            stderr=stderr or exc.stderr,
        ) from exc
    finally:
        close_process_job(proc)
    return subprocess.CompletedProcess(argv, proc.returncode, stdout, stderr)


def _wait_exited(proc: subprocess.Popen[Any], timeout_s: float) -> bool:
    try:
        proc.wait(timeout=timeout_s)
        return True
    except subprocess.TimeoutExpired:
        return False


def _signal_posix_group(proc: subprocess.Popen[Any], sig: int) -> None:
    try:
        pgid = os.getpgid(proc.pid)
        if pgid == proc.pid and pgid != os.getpgrp():
            os.killpg(pgid, sig)
            return
    except OSError:  # best-effort · falls through to the direct proc.terminate/kill below
        pass
    with contextlib.suppress(OSError):
        if sig == signal.SIGTERM:
            proc.terminate()
        else:
            proc.kill()


def _signal_posix_pid_group(pid: int, sig: int) -> None:
    try:
        pgid = os.getpgid(pid)
        if pgid == pid and pgid != os.getpgrp():
            os.killpg(pgid, sig)
            return
    except OSError:  # best-effort · falls through to the direct os.kill below
        pass
    with contextlib.suppress(OSError):
        os.kill(pid, sig)


def _pid_exited(pid: int, timeout_s: float) -> bool:
    deadline = time.monotonic() + max(0.0, timeout_s)
    while time.monotonic() <= deadline:
        try:
            os.kill(pid, 0)
        except OSError:
            return True
        time.sleep(0.05)
    return False


def _terminate_job(proc: subprocess.Popen[Any], wait_s: float) -> bool:
    job = job_for(proc)
    if job is None or not job.terminate(1):  # exit code 1 matches taskkill /F
        return False
    if _wait_exited(proc, wait_s):
        return True
    _logger.warning("pid %d still running after TerminateJobObject", proc.pid)
    return False


def _terminate_windows_tree(proc: subprocess.Popen[Any]) -> None:
    _taskkill_windows_pid(proc.pid)


def _taskkill_windows_pid(pid: int) -> None:
    taskkill = os.path.join(
        os.environ.get("SYSTEMROOT", r"C:\Windows"),
        "System32",
        "taskkill.exe",
    )
    with contextlib.suppress(Exception):
        subprocess.run(
            [taskkill, "/pid", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
