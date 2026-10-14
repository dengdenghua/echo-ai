"""Local process identity for crash recovery, with lease fallback when unknown."""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import sys
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from uuid import UUID


@lru_cache(maxsize=1)
def _process_namespace() -> str:
    try:
        if sys.platform == "win32":
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography"
            ) as key:
                identity = str(UUID(str(winreg.QueryValueEx(key, "MachineGuid")[0])))
        elif sys.platform.startswith("linux"):
            identity = (
                str(UUID(Path("/proc/sys/kernel/random/boot_id").read_text().strip()))
                + ":"
                + os.readlink("/proc/self/ns/pid")
            )
        else:
            return ""
    except (OSError, ValueError):
        return ""
    return hashlib.sha256(f"{sys.platform}:{identity}".encode()).hexdigest()


def _process_stamp(pid: int) -> str | None:
    """A creation stamp; missing PID is dead, unavailable inspection is unknown."""
    if sys.platform.startswith("linux"):
        try:
            fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        except FileNotFoundError as exc:
            raise ProcessLookupError(pid) from exc
        except (OSError, IndexError):
            return None
        if not fields:
            return None
        if fields[0] in {"Z", "X"}:
            raise ProcessLookupError(pid)
        return fields[19] if len(fields) > 19 else None
    if sys.platform != "win32":
        return None
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.GetProcessTimes.restype = wintypes.BOOL
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    handle = kernel.OpenProcess(0x1000 | 0x100000, False, pid)
    if not handle:
        if ctypes.get_last_error() == 87:
            raise ProcessLookupError(pid)
        return None
    try:
        wait_status = kernel.WaitForSingleObject(handle, 0)
        if wait_status == 0:
            raise ProcessLookupError(pid)
        if wait_status != 258:
            return None
        created, exited, system, user = (wintypes.FILETIME() for _ in range(4))
        if not kernel.GetProcessTimes(
            handle,
            ctypes.byref(created),
            ctypes.byref(exited),
            ctypes.byref(system),
            ctypes.byref(user),
        ):
            return None
        return str((created.dwHighDateTime << 32) | created.dwLowDateTime)
    finally:
        kernel.CloseHandle(handle)


def current_claim_owner(
    *,
    stamp_probe: Callable[[int], str | None] | None = None,
    namespace_probe: Callable[[], str] | None = None,
) -> str:
    pid = os.getpid()
    stamp = (stamp_probe or _process_stamp)(pid)
    namespace = (namespace_probe or _process_namespace)()
    return json.dumps({"namespace": namespace, "pid": pid, "stamp": stamp})


def claim_owner_alive(
    owner: str,
    *,
    stamp_probe: Callable[[int], str | None] | None = None,
    namespace_probe: Callable[[], str] | None = None,
) -> bool | None:
    try:
        payload = json.loads(owner)
        namespace = (namespace_probe or _process_namespace)()
        pid, stamp = payload["pid"], payload["stamp"]
        if (
            not namespace
            or payload["namespace"] != namespace
            or type(pid) is not int
            or pid <= 0
            or pid > 0xFFFFFFFF
            or not isinstance(stamp, str)
            or not stamp
        ):
            return None
        actual = (stamp_probe or _process_stamp)(pid)
        return actual == stamp if actual is not None else None
    except ProcessLookupError:
        return False
    except (ValueError, TypeError, KeyError, OSError):
        return None
