"""Windows Job Object helper: tie a child's whole process tree to one handle.

A Job Object is the Windows primitive for "this process and everything it
spawns". With ``JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`` the kernel kills every
process in the job when the last handle to it closes, and the handle is
closed when the owning (non-inheritable) process exits for any reason, crash
and ``TerminateProcess`` included. That is what ``taskkill /T`` cannot do: it
walks parent-pid links at kill time, so a grandchild whose parent already
exited is invisible to it, and nothing runs at all when the backend dies.

Only ``ctypes`` + kernel32 are used. On other platforms every class and
function here imports cleanly and does nothing (``WindowsJob.active`` is
False), so callers need no platform branches.

Failure policy: a job is a hardening layer, never a launch prerequisite.
Creating, configuring or assigning can fail (an outer job that forbids
nesting, missing rights, ``ECHO_WINDOWS_JOB_OBJECTS=0``); each failure logs a
warning and the caller keeps its previous behaviour (process group +
``taskkill /T``).

Race: a process can start a grandchild between ``CreateProcess`` returning
and ``AssignProcessToJobObject``; that grandchild would never join the job.
Launchers therefore create the child with ``CREATE_SUSPENDED``, assign it
while its first thread has not executed a single instruction, and only then
resume it (:func:`attach_suspended`). ``subprocess.Popen`` closes the primary
thread handle, so resuming goes through ``NtResumeProcess`` (falling back to
a Toolhelp32 thread walk), see :func:`resume_suspended_process`.
"""

from __future__ import annotations

import contextlib
import ctypes
import dataclasses
import functools
import logging
import os
import sys
import threading
import weakref
from dataclasses import dataclass
from typing import Any

_logger = logging.getLogger(__name__)

#: ``CreateProcess`` flag; exported so launchers can OR it into creationflags.
CREATE_SUSPENDED = 0x00000004

_DISABLE_ENV = "ECHO_WINDOWS_JOB_OBJECTS"
_DISABLED_VALUES = frozenset({"0", "false", "off", "no"})

_JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
_JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
_JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
_JOB_OBJECT_BASIC_PROCESS_ID_LIST = 3
_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9

_PROCESS_TERMINATE = 0x0001
_PROCESS_SET_QUOTA = 0x0100
_PROCESS_SUSPEND_RESUME = 0x0800
_THREAD_SUSPEND_RESUME = 0x0002
_TH32CS_SNAPTHREAD = 0x00000004
_ERROR_MORE_DATA = 234


@dataclass(frozen=True)
class JobLimits:
    """Limits applied to every process in one job.

    ``kill_on_close`` is the tree-lifetime guarantee; turn it off only for
    processes that are meant to outlive the backend (they still get reliable
    tree termination through :meth:`WindowsJob.terminate`). Memory limits are
    committed bytes; a process over its limit gets allocation failures, it is
    not killed. ``active_processes`` makes ``CreateProcess`` inside the job
    fail once that many processes are alive in it.
    """

    kill_on_close: bool = True
    process_memory_bytes: int | None = None
    job_memory_bytes: int | None = None
    active_processes: int | None = None

    def limit_flags(self) -> int:
        flags = _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE if self.kill_on_close else 0
        if self.process_memory_bytes:
            flags |= _JOB_OBJECT_LIMIT_PROCESS_MEMORY
        if self.job_memory_bytes:
            flags |= _JOB_OBJECT_LIMIT_JOB_MEMORY
        if self.active_processes:
            flags |= _JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        return flags


def job_objects_enabled() -> bool:
    """True on Windows unless ``ECHO_WINDOWS_JOB_OBJECTS`` disables jobs."""
    if sys.platform != "win32":
        return False
    return os.environ.get(_DISABLE_ENV, "").strip().lower() not in _DISABLED_VALUES


class _BasicLimitInformation(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_int64),
        ("PerJobUserTimeLimit", ctypes.c_int64),
        ("LimitFlags", ctypes.c_uint32),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", ctypes.c_uint32),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", ctypes.c_uint32),
        ("SchedulingClass", ctypes.c_uint32),
    ]


class _IoCounters(ctypes.Structure):
    _fields_ = [
        (name, ctypes.c_uint64)
        for name in (
            "ReadOperationCount",
            "WriteOperationCount",
            "OtherOperationCount",
            "ReadTransferCount",
            "WriteTransferCount",
            "OtherTransferCount",
        )
    ]


class _ExtendedLimitInformation(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _BasicLimitInformation),
        ("IoInfo", _IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


class _ThreadEntry32(ctypes.Structure):
    _fields_ = [
        ("dwSize", ctypes.c_uint32),
        ("cntUsage", ctypes.c_uint32),
        ("th32ThreadID", ctypes.c_uint32),
        ("th32OwnerProcessID", ctypes.c_uint32),
        ("tpBasePri", ctypes.c_long),
        ("tpDeltaPri", ctypes.c_long),
        ("dwFlags", ctypes.c_uint32),
    ]


def _pid_list_type(capacity: int) -> Any:
    """JOBOBJECT_BASIC_PROCESS_ID_LIST with room for ``capacity`` pids."""

    class _PidList(ctypes.Structure):
        _fields_ = [
            ("NumberOfAssignedProcesses", ctypes.c_uint32),
            ("NumberOfProcessIdsInList", ctypes.c_uint32),
            ("ProcessIdList", ctypes.c_size_t * capacity),
        ]

    return _PidList


@functools.cache
def _kernel32() -> Any:
    """kernel32 with explicit prototypes (handles must not truncate to int32)."""
    if sys.platform != "win32":
        raise OSError("Job Objects are Windows-only")
    from ctypes import wintypes

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle, dword, boolean = wintypes.HANDLE, wintypes.DWORD, wintypes.BOOL
    prototypes: dict[str, tuple[Any, list[Any]]] = {
        "CreateJobObjectW": (handle, [ctypes.c_void_p, wintypes.LPCWSTR]),
        "SetInformationJobObject": (boolean, [handle, ctypes.c_int, ctypes.c_void_p, dword]),
        "QueryInformationJobObject": (
            boolean,
            [handle, ctypes.c_int, ctypes.c_void_p, dword, ctypes.POINTER(dword)],
        ),
        "AssignProcessToJobObject": (boolean, [handle, handle]),
        "TerminateJobObject": (boolean, [handle, ctypes.c_uint]),
        "OpenProcess": (handle, [dword, boolean, dword]),
        "OpenThread": (handle, [dword, boolean, dword]),
        "ResumeThread": (dword, [handle]),
        "CreateToolhelp32Snapshot": (handle, [dword, dword]),
        "Thread32First": (boolean, [handle, ctypes.POINTER(_ThreadEntry32)]),
        "Thread32Next": (boolean, [handle, ctypes.POINTER(_ThreadEntry32)]),
        "CloseHandle": (boolean, [handle]),
    }
    for name, (restype, argtypes) in prototypes.items():
        fn = getattr(k32, name)
        fn.restype = restype
        fn.argtypes = argtypes
    return k32


def _last_error() -> int:
    return int(getattr(ctypes, "get_last_error", lambda: 0)())


def _pid_of(proc_or_pid: object) -> int:
    pid = proc_or_pid if isinstance(proc_or_pid, int) else getattr(proc_or_pid, "pid", 0)
    return int(pid or 0)


def _create_job(limits: JobLimits) -> tuple[int | None, JobLimits]:
    """Create a configured job; returns (handle or None, limits actually applied)."""
    k32 = _kernel32()
    # NULL security attributes: the handle is not inheritable, so children
    # cannot keep the job (and themselves) alive after this process exits.
    handle = k32.CreateJobObjectW(None, None)
    if not handle:
        _logger.warning("CreateJobObjectW failed (winerror %d); job disabled", _last_error())
        return None, limits
    if _set_limits(handle, limits):
        return int(handle), limits
    reduced = JobLimits(kill_on_close=limits.kill_on_close)
    if reduced != limits and _set_limits(handle, reduced):
        _logger.warning("job resource limits rejected (%r); kept kill-on-close only", limits)
        return int(handle), reduced
    k32.CloseHandle(handle)
    return None, limits


def _set_limits(handle: int, limits: JobLimits) -> bool:
    info = _ExtendedLimitInformation()
    info.BasicLimitInformation.LimitFlags = limits.limit_flags()
    info.BasicLimitInformation.ActiveProcessLimit = int(limits.active_processes or 0)
    info.ProcessMemoryLimit = int(limits.process_memory_bytes or 0)
    info.JobMemoryLimit = int(limits.job_memory_bytes or 0)
    ok = _kernel32().SetInformationJobObject(
        handle,
        _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
        ctypes.byref(info),
        ctypes.sizeof(info),
    )
    if not ok:
        _logger.warning("SetInformationJobObject failed (winerror %d)", _last_error())
    return bool(ok)


class WindowsJob:
    """One Job Object handle. Inactive (all no-ops) when unavailable.

    Thread-safe: cancellation threads may call :meth:`terminate` while the
    launching thread calls :meth:`close`. Dropping the last reference closes
    the handle, which with ``kill_on_close`` kills whatever is still in the
    job — "owner gone, tree gone".
    """

    def __init__(self, limits: JobLimits | None = None) -> None:
        self.limits = limits or JobLimits()
        self._lock = threading.Lock()
        self._handle: int | None = None
        if job_objects_enabled():
            try:
                self._handle, self.limits = _create_job(self.limits)
            except OSError as exc:  # ctypes/loader failure: degrade, never block launch
                _logger.warning("Job Object unavailable: %s", exc)

    @property
    def active(self) -> bool:
        return self._handle is not None

    def assign_process(self, proc_or_pid: object) -> bool:
        """Put a process into the job. Returns False (and warns) on failure.

        Accepts a ``Popen``/asyncio ``Process`` or a pid. The caller must
        still hold the process (an un-reaped ``Popen``) so the pid cannot have
        been recycled.
        """
        pid = _pid_of(proc_or_pid)
        with self._lock:
            if self._handle is None or pid <= 0:
                return False
            k32 = _kernel32()
            process = k32.OpenProcess(_PROCESS_SET_QUOTA | _PROCESS_TERMINATE, False, pid)
            if not process:
                _logger.warning("OpenProcess(%d) failed (winerror %d)", pid, _last_error())
                return False
            try:
                if not k32.AssignProcessToJobObject(self._handle, process):
                    _logger.warning(
                        "AssignProcessToJobObject(%d) failed (winerror %d); "
                        "falling back to taskkill tree termination",
                        pid,
                        _last_error(),
                    )
                    return False
                return True
            finally:
                k32.CloseHandle(process)

    def terminate(self, exit_code: int = 1) -> bool:
        """Kill every process in the job, including orphaned grandchildren."""
        with self._lock:
            if self._handle is None:
                return False
            ok = bool(_kernel32().TerminateJobObject(self._handle, exit_code))
            if not ok:
                _logger.warning("TerminateJobObject failed (winerror %d)", _last_error())
            return ok

    def process_ids(self) -> list[int]:
        """Pids currently in the job (diagnostics/tests); [] when inactive."""
        capacity = 64
        with self._lock:
            while self._handle is not None and capacity <= 65536:
                buf = _pid_list_type(capacity)()
                ok = _kernel32().QueryInformationJobObject(
                    self._handle,
                    _JOB_OBJECT_BASIC_PROCESS_ID_LIST,
                    ctypes.byref(buf),
                    ctypes.sizeof(buf),
                    None,
                )
                if ok:
                    return [int(p) for p in buf.ProcessIdList[: buf.NumberOfProcessIdsInList]]
                if _last_error() != _ERROR_MORE_DATA:
                    break
                capacity *= 4
        return []

    def close(self) -> None:
        """Release the handle (kills remaining processes when kill_on_close)."""
        with self._lock:
            handle, self._handle = self._handle, None
            if handle is not None:
                _kernel32().CloseHandle(handle)

    def detach(self) -> None:
        """Release the handle but let survivors live (POSIX-like daemons).

        Clears kill-on-close first; limits may be changed on a live job.
        """
        with self._lock:
            handle, self._handle = self._handle, None
            if handle is None:
                return
            if self.limits.kill_on_close:
                relaxed = dataclasses.replace(self.limits, kill_on_close=False)
                if not _set_limits(handle, relaxed):
                    _logger.warning("could not clear kill-on-close; survivors will be killed")
            _kernel32().CloseHandle(handle)

    def __enter__(self) -> WindowsJob:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def __del__(self) -> None:
        try:  # noqa: SIM105 — contextlib may already be torn down at interpreter exit
            self.close()
        except Exception:  # nosec B110  # noqa: BLE001 — finalizers must never raise
            pass


def resume_suspended_process(pid: int) -> bool:
    """Resume every thread of a ``CREATE_SUSPENDED`` child; True on success.

    ``NtResumeProcess`` is one syscall (~0.1 ms). The documented alternative,
    a Toolhelp32 snapshot of every thread on the machine, measured ~100 ms on
    a busy desktop, too slow for per-command launches, so it is only the
    fallback for when the ntdll export is missing or refuses.
    """
    if sys.platform != "win32" or pid <= 0:
        return False
    return _nt_resume_process(pid) or _toolhelp_resume(pid)


def _nt_resume_process(pid: int) -> bool:
    k32 = _kernel32()
    process = k32.OpenProcess(_PROCESS_SUSPEND_RESUME, False, pid)
    if not process:
        return False
    try:
        nt_resume = _ntdll().NtResumeProcess
        return int(nt_resume(process)) >= 0  # NTSTATUS success codes are >= 0
    except (AttributeError, OSError):
        return False
    finally:
        k32.CloseHandle(process)


@functools.cache
def _ntdll() -> Any:
    if sys.platform != "win32":
        raise OSError("ntdll is Windows-only")
    ntdll = ctypes.WinDLL("ntdll")
    with contextlib.suppress(AttributeError):
        ntdll.NtResumeProcess.restype = ctypes.c_long
        ntdll.NtResumeProcess.argtypes = [ctypes.c_void_p]
    return ntdll


def _toolhelp_resume(pid: int) -> bool:
    k32 = _kernel32()
    resumed = 0
    snapshot = k32.CreateToolhelp32Snapshot(_TH32CS_SNAPTHREAD, 0)
    if not snapshot or snapshot == ctypes.c_void_p(-1).value:  # INVALID_HANDLE_VALUE
        return False
    try:
        entry = _ThreadEntry32()
        entry.dwSize = ctypes.sizeof(entry)
        more = k32.Thread32First(snapshot, ctypes.byref(entry))
        while more:
            if entry.th32OwnerProcessID == pid:
                resumed += _resume_thread(entry.th32ThreadID)
            more = k32.Thread32Next(snapshot, ctypes.byref(entry))
    finally:
        k32.CloseHandle(snapshot)
    return resumed > 0


def _resume_thread(tid: int) -> int:
    k32 = _kernel32()
    thread = k32.OpenThread(_THREAD_SUSPEND_RESUME, False, tid)
    if not thread:
        return 0
    try:
        return 0 if k32.ResumeThread(thread) == 0xFFFFFFFF else 1
    finally:
        k32.CloseHandle(thread)


# Owner (Popen / asyncio Process) -> job. Weak keys: the job lives exactly as
# long as the object that owns the child, then its handle is closed.
_JOBS: weakref.WeakKeyDictionary[Any, WindowsJob] = weakref.WeakKeyDictionary()
_JOBS_LOCK = threading.Lock()


def register_job(owner: object, job: WindowsJob) -> None:
    with _JOBS_LOCK:
        _JOBS[owner] = job


def job_for(owner: object) -> WindowsJob | None:
    """The job a launcher attached to ``owner``, if any."""
    with _JOBS_LOCK:
        try:
            return _JOBS.get(owner)
        except TypeError:  # not weak-referenceable: never registered
            return None


def release_job(owner: object, *, kill_survivors: bool = True) -> None:
    """Unregister and close ``owner``'s job.

    ``kill_survivors=True`` closes it (kill-on-close ends leftovers);
    False detaches it so processes still in the job keep running.
    """
    with _JOBS_LOCK:
        try:
            job = _JOBS.pop(owner, None)
        except TypeError:
            job = None
    if job is None:
        return
    if kill_survivors:
        job.close()
    else:
        job.detach()


def attach_suspended(job: WindowsJob, owner: object, *, resume: bool = True) -> bool:
    """Assign a suspended child to ``job``, register it, then resume it.

    Assignment failure is logged and degrades to "no job" (the job is
    closed). Returns False only when the child could not be resumed; it has
    then never executed, and the caller must kill it and relaunch plainly.
    """
    if job.assign_process(owner):
        register_job(owner, job)
    else:
        job.close()
    if not resume:
        return True
    if resume_suspended_process(_pid_of(owner)):
        return True
    _logger.warning("could not resume suspended child %d; relaunching", _pid_of(owner))
    release_job(owner)
    return False


__all__ = [
    "CREATE_SUSPENDED",
    "JobLimits",
    "WindowsJob",
    "attach_suspended",
    "job_for",
    "job_objects_enabled",
    "register_job",
    "release_job",
    "resume_suspended_process",
]
