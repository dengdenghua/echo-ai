"""Process tree management and graceful shutdown utilities.

Handles cross-platform process termination with:
- Signal cascade: SIGINT → 3s grace → SIGKILL (Unix)
- Process tree termination (child processes included)
- Windows Job Objects (kill-on-close) for children started via ``spawn``,
  with taskkill as the fallback for everything else
- Timeout-aware graceful shutdown
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import platform
import signal
from typing import Any

from runtime.platform.process.tree import process_group_kwargs
from runtime.platform.process.win_job import (
    CREATE_SUSPENDED,
    JobLimits,
    WindowsJob,
    attach_suspended,
    job_for,
    release_job,
)

_logger = logging.getLogger(__name__)

_GRACE_PERIOD_SEC = 3.0


class ProcessTreeManager:
    """Manages cross-platform process tree lifecycle.

    Usage:
        manager = ProcessTreeManager()
        proc = await manager.spawn("python", "worker.py", stdout=asyncio.subprocess.PIPE)
        ...
        await manager.terminate_all()

    ``spawn`` starts the child in its own process group/session and, on
    Windows, inside a kill-on-close Job Object (created suspended, assigned,
    then resumed), so its whole tree also dies when this process does.
    Processes started elsewhere can still be handed to ``track``; they get
    the killpg / taskkill path. ``untrack`` closes a spawned child's job,
    which kills anything still running in it.
    """

    def __init__(
        self,
        grace_period: float = _GRACE_PERIOD_SEC,
    ) -> None:
        self._grace_period = grace_period
        self._tracked: dict[int, asyncio.subprocess.Process] = {}
        self._terminated_pids: set[int] = set()

    async def spawn(
        self,
        program: str,
        *args: str,
        limits: JobLimits | None = None,
        **kwargs: Any,
    ) -> asyncio.subprocess.Process:
        """``asyncio.create_subprocess_exec`` in its own group (+ Windows job), tracked."""
        if platform.system() == "Windows":
            process = await _spawn_windows(program, args, limits, kwargs)
        else:
            kwargs.setdefault("start_new_session", True)
            process = await asyncio.create_subprocess_exec(program, *args, **kwargs)
        self.track(process.pid, process)
        return process

    def track(
        self,
        pid: int,
        process: asyncio.subprocess.Process,
    ) -> None:
        """Track a process by its PID for lifecycle management."""
        self._tracked[pid] = process

    def untrack(self, pid: int) -> None:
        process = self._tracked.pop(pid, None)
        self._terminated_pids.discard(pid)
        if process is not None:
            release_job(process)

    async def terminate_graceful(
        self,
        pid: int,
        process: asyncio.subprocess.Process,
    ) -> int:
        """Terminate a process gracefully with signal cascade.

        Returns the exit code, or -1 if the process couldn't be killed.
        """
        if process.returncode is not None:
            # The direct child is gone, but its job may still hold orphans.
            job = job_for(process)
            if job is not None:
                job.terminate(1)
            return process.returncode

        if platform.system() == "Windows":
            return await self._terminate_windows(pid, process)
        return await self._terminate_unix(pid, process)

    async def terminate_all(self) -> list[int]:
        """Terminate all tracked processes gracefully.

        Returns list of exit codes.
        """
        codes = []
        for pid, proc in list(self._tracked.items()):
            code = await self.terminate_graceful(pid, proc)
            codes.append(code)
        for proc in self._tracked.values():
            release_job(proc)
        self._tracked.clear()
        self._terminated_pids.clear()
        return codes

    async def _terminate_unix(
        self,
        pid: int,
        process: asyncio.subprocess.Process,
    ) -> int:
        """Unix: SIGINT → grace → SIGKILL."""
        if pid in self._terminated_pids:
            return process.returncode if process.returncode is not None else -1

        try:
            self._terminated_pids.add(pid)
            try:
                os.killpg(pid, signal.SIGINT)
            except ProcessLookupError:
                _logger.debug("process %d already exited", pid)
                return process.returncode if process.returncode is not None else -1

            _logger.debug("sent SIGINT to process group %d", pid)

            try:
                await asyncio.wait_for(
                    process.wait(),
                    timeout=self._grace_period,
                )
                _logger.info("process %d exited after SIGINT", pid)
                return process.returncode if process.returncode is not None else -1
            except TimeoutError:
                _logger.warning(
                    "process %d did not exit after SIGINT, sending SIGKILL",
                    pid,
                )
                os.killpg(pid, signal.SIGKILL)
                await process.wait()
                return process.returncode if process.returncode is not None else -1
        except Exception as exc:
            _logger.error("failed to terminate process %d: %s", pid, exc)
            return -1

    async def _terminate_windows(
        self,
        pid: int,
        process: asyncio.subprocess.Process,
    ) -> int:
        """Windows: end the Job Object if there is one, else taskkill /T /F."""
        if pid in self._terminated_pids:
            return process.returncode if process.returncode is not None else -1

        self._terminated_pids.add(pid)
        job = job_for(process)
        if job is not None and job.terminate(1):
            try:
                await asyncio.wait_for(process.wait(), timeout=5.0)
                _logger.info("process %d terminated via job object", pid)
                return process.returncode if process.returncode is not None else -1
            except TimeoutError:
                _logger.warning("pid %d survived TerminateJobObject; trying taskkill", pid)
        return await self._taskkill_windows(pid, process)

    async def _taskkill_windows(
        self,
        pid: int,
        process: asyncio.subprocess.Process,
    ) -> int:
        try:
            taskkill_path = os.path.join(
                os.environ.get("SYSTEMROOT", "C:\\Windows"),
                "System32",
                "taskkill.exe",
            )

            kill_proc = await asyncio.create_subprocess_exec(
                taskkill_path,
                "/pid",
                str(pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await kill_proc.wait()

            await asyncio.wait_for(
                process.wait(),
                timeout=5.0,
            )
            _logger.info("process %d terminated via taskkill", pid)
            return process.returncode if process.returncode is not None else -1
        except TimeoutError:
            _logger.warning("taskkill for pid %d timed out", pid)
            return -1
        except Exception as exc:
            _logger.error("failed to terminate Windows process %d: %s", pid, exc)
            return -1

    @property
    def active_count(self) -> int:
        """Number of currently tracked (non-terminated) processes."""
        return len(self._tracked) - len(self._terminated_pids)


async def _spawn_windows(
    program: str,
    args: tuple[str, ...],
    limits: JobLimits | None,
    kwargs: dict[str, Any],
) -> asyncio.subprocess.Process:
    """Create suspended → assign to job → resume; degrade to a plain launch."""
    flags = int(kwargs.pop("creationflags", 0)) | int(process_group_kwargs()["creationflags"])
    job = WindowsJob(limits)
    if job.active:
        process = await asyncio.create_subprocess_exec(
            program, *args, creationflags=flags | CREATE_SUSPENDED, **kwargs
        )
        if attach_suspended(job, process):
            return process
        # Never resumed, so it never ran: discard it and relaunch without a job.
        with contextlib.suppress(ProcessLookupError, OSError):
            process.kill()
        await process.wait()
    return await asyncio.create_subprocess_exec(program, *args, creationflags=flags, **kwargs)
