"""Where a conversation can run, besides this computer and execution nodes.

* **SSH** — an Echo runtime on another host, reached through an OpenSSH
  local forward (``remote_transport.SshTunnelForwarder``).
* **WSL** — an Echo runtime inside a local WSL distro, reached on loopback.

Both are entries in the remote backend registry, so they share the health
check, the HTTP proxy and the realtime relay. Turns are relayed by
``realtime_remote_echo``; the remote Echo keeps its own sandbox and tools.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from typing import Any

_WSL_CACHE_S = 30.0
_wsl_lock = threading.Lock()
_wsl_cache: tuple[float, dict[str, Any]] | None = None


def _decode_wsl(raw: bytes) -> str:
    # wsl.exe writes UTF-16LE to pipes; newer builds honour WSL_UTF8=1.
    if raw[:2] == b"\xff\xfe" or (len(raw) > 1 and raw[1:2] == b"\x00"):
        return raw.decode("utf-16-le", errors="replace").lstrip("﻿")
    return raw.decode("utf-8", errors="replace")


def parse_wsl_list(text: str) -> list[dict[str, Any]]:
    """Parse ``wsl.exe --list --verbose`` output."""
    distros: list[dict[str, Any]] = []
    for line in text.replace("\x00", "").splitlines()[1:]:
        default = line.lstrip().startswith("*")
        fields = line.replace("*", " ", 1).split()
        if len(fields) < 3:
            continue
        name, state, version = " ".join(fields[:-2]), fields[-2], fields[-1]
        distros.append(
            {
                "name": name,
                "state": state.lower(),
                "version": int(version) if version.isdigit() else None,
                "default": default,
            }
        )
    return distros


def wsl_distros(*, refresh: bool = False) -> dict[str, Any]:
    """Installed WSL distros on this Windows host (cached briefly)."""
    global _wsl_cache
    if os.name != "nt":
        return {"available": False, "distros": []}
    with _wsl_lock:
        if not refresh and _wsl_cache and time.monotonic() - _wsl_cache[0] < _WSL_CACHE_S:
            return _wsl_cache[1]
        result: dict[str, Any] = {"available": False, "distros": []}
        exe = shutil.which("wsl.exe") or shutil.which("wsl")
        if exe:
            try:
                completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
                    [exe, "--list", "--verbose"],
                    capture_output=True,
                    timeout=5,
                    env={**os.environ, "WSL_UTF8": "1"},
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if completed.returncode == 0:
                    distros = parse_wsl_list(_decode_wsl(completed.stdout))
                    result = {"available": bool(distros), "distros": distros}
            except (OSError, subprocess.TimeoutExpired):
                pass
        _wsl_cache = (time.monotonic(), result)
        return result


def remote_connections(registry: Any) -> list[dict[str, Any]]:
    """SSH and WSL entries of the remote backend registry, for the picker."""
    out = []
    for backend in registry.list():
        if backend.ssh is None and backend.wsl is None:
            continue
        entry: dict[str, Any] = {
            "id": backend.id,
            "name": backend.name,
            "transport": backend.transport,
            "health": backend.last_health,
            "health_detail": backend.health_detail,
            "has_auth": backend.has_auth,
        }
        if backend.ssh is not None:
            ssh = backend.ssh
            target = f"{ssh.user}@{ssh.host}" if ssh.user else ssh.host
            entry["target"] = target if ssh.port == 22 else f"{target}:{ssh.port}"
        else:
            entry["target"] = backend.wsl.distro
        out.append(entry)
    return out


__all__ = ["parse_wsl_list", "remote_connections", "wsl_distros"]
