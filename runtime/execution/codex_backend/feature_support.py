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

import contextlib
import json
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


_override_cache: dict[tuple[str, int, int, tuple[str, ...]], bool] = {}


def accepts_config_overrides(
    executable: str | None, overrides: tuple[str, ...], *, cache_path: Path | None = None
) -> bool:
    """Whether ``executable`` starts its App Server with ``-c`` ``overrides``.

    ``--strict-config`` refuses unknown keys and wrong types at startup, so an
    App Server that reads its (empty) stdin and exits cleanly knows them all.
    Any failure answers ``False``: the caller then keeps the older config.
    That start takes ~1.7 s, so a positive answer is also kept in
    ``cache_path`` for the same executable file (path, mtime, size).
    """
    if not executable or not overrides:
        return False
    path = Path(executable)
    try:
        stat = path.stat()
    except OSError:
        return False
    key = (str(path), stat.st_mtime_ns, stat.st_size, overrides)
    with _lock:
        if key in _override_cache:
            return _override_cache[key]
    stored = _stored_answers(cache_path)
    if stored.get(repr(key)) is True:
        with _lock:
            _override_cache[key] = True
        return True
    flags = [part for override in overrides for part in ("-c", override)]
    with tempfile.TemporaryDirectory(prefix="echo-codex-config-") as home:
        env = {name: value for name in _PASSTHROUGH_ENV if (value := os.environ.get(name))}
        env["CODEX_HOME"] = home
        try:
            completed = subprocess.run(
                [str(path), *flags, "app-server", "--strict-config", "--listen", "stdio://"],
                input="",
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=_PROBE_TIMEOUT_S,
                env=env,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            accepted = completed.returncode == 0 and "configuration field" not in completed.stderr
        except (OSError, subprocess.SubprocessError):
            accepted = False
    with _lock:
        _override_cache[key] = accepted
    if accepted and cache_path is not None:
        with contextlib.suppress(OSError):
            cache_path.write_text(json.dumps({**stored, repr(key): True}), encoding="utf-8")
    return accepted


def _stored_answers(cache_path: Path | None) -> dict[str, object]:
    if cache_path is None:
        return {}
    try:
        value = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def clear_feature_support_cache() -> None:
    """Test seam."""
    with _lock:
        _cache.clear()
        _override_cache.clear()


__all__ = ["accepts_config_overrides", "clear_feature_support_cache", "supported_codex_features"]
