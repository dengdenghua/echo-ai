"""Which feature flags one Codex executable defines.

Echo locks some Codex features off in the generated ``config.toml``. Newer
Codex builds add default-on features that must be locked too, but older
builds reject an unknown ``features.<name>`` key under ``--strict-config``.
Asking the executable lets one policy serve the pinned build and its
successor during an upgrade. Detection failure is safe: the extra key is
simply not written, and the post-start ``config/read`` check still rejects
any enabled feature Echo has not approved.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import threading
from pathlib import Path

_PROBE_TIMEOUT_S = 20
_PASSTHROUGH_ENV = ("PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE")

_cache: dict[tuple[str, int, int], frozenset[str] | None] = {}
_lock = threading.Lock()


def supported_codex_features(executable: str | None) -> frozenset[str] | None:
    """Return the feature names ``executable`` knows, or ``None`` if unknown."""
    if not executable:
        return None
    path = Path(executable)
    try:
        stat = path.stat()
    except OSError:
        return None
    # A Codex update replaces the file in place; size and mtime catch that.
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    with _lock:
        if key in _cache:
            return _cache[key]
    result = _probe(path)
    with _lock:
        _cache[key] = result
    return result


def _probe(path: Path) -> frozenset[str] | None:
    # An empty CODEX_HOME keeps the user's own config out of the answer.
    with tempfile.TemporaryDirectory(prefix="echo-codex-features-") as home:
        env = {name: value for name in _PASSTHROUGH_ENV if (value := os.environ.get(name))}
        env["CODEX_HOME"] = home
        try:
            completed = subprocess.run(
                [str(path), "features", "list"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=_PROBE_TIMEOUT_S,
                env=env,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.SubprocessError):
            return None
    if completed.returncode != 0:
        return None
    names = {line.split()[0] for line in completed.stdout.splitlines() if line.split()}
    return frozenset(names) or None


def clear_feature_support_cache() -> None:
    """Test seam."""
    with _lock:
        _cache.clear()


__all__ = ["clear_feature_support_cache", "supported_codex_features"]
