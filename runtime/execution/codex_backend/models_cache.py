"""Share Codex's model-list cache across a principal's conversations.

Every conversation gets its own CODEX_HOME, so its first turn found no
``models_cache.json`` and App Server fetched the model list online during
``thread/start`` (2.4–2.7 s measured on 2026-10-15). The list belongs to the
signed-in account, not to the conversation, so Echo keeps one copy per realm
and principal: a new home starts from it, and a home that refreshed it hands
the newer copy back. App Server still checks the cache's client version and
age itself and refetches when it is stale.

The cache is an optimisation only. Every failure is swallowed so a missing,
oversized or malformed file never blocks a turn.
"""

from __future__ import annotations

import json
import logging
import stat
from pathlib import Path
from typing import Any

from ._security_support import CodexSecurityError, _atomic_write_private, _opaque_id

_logger = logging.getLogger(__name__)

MODELS_CACHE_NAME = "models_cache.json"
_MAX_BYTES = 8 * 1024 * 1024


def shared_cache_path(context: Any) -> Path:
    """The principal's copy, outside every conversation's CODEX_HOME."""

    scope = _opaque_id("models-cache", f"{context.realm_key}\0{context.tenant_key}")
    return Path(context.state_root) / "model-caches" / scope / MODELS_CACHE_NAME


def _read_cache(path: Path) -> tuple[bytes, float] | None:
    try:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            return None
        if info.st_size > _MAX_BYTES:
            return None
        data = path.read_bytes()
        if not isinstance(json.loads(data), dict):
            return None
    except (OSError, ValueError):
        return None
    return data, info.st_mtime


def seed_models_cache(context: Any, *, fallback_home: Path | None = None) -> bool:
    """Start a new CODEX_HOME from the principal's last model list.

    Before any conversation has shared one, the home the login is inherited
    from (the managed account home, or ``~/.codex`` locally) may hold a list.
    """

    target = Path(context.codex_home) / MODELS_CACHE_NAME
    if target.exists():
        return False
    cached = _read_cache(shared_cache_path(context))
    if cached is None and fallback_home is not None:
        cached = _read_cache(Path(fallback_home) / MODELS_CACHE_NAME)
    if cached is None:
        return False
    try:
        _atomic_write_private(target, cached[0])
    except CodexSecurityError as exc:
        _logger.debug("Codex models cache not seeded: %s", exc)
        return False
    return True


def share_models_cache(context: Any) -> bool:
    """Hand a conversation's newer model list back to the principal's copy."""

    current = _read_cache(Path(context.codex_home) / MODELS_CACHE_NAME)
    if current is None:
        return False
    shared = shared_cache_path(context)
    known = _read_cache(shared)
    if known is not None and (known[0] == current[0] or known[1] >= current[1]):
        return False
    try:
        shared.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        _atomic_write_private(shared, current[0])
    except (OSError, CodexSecurityError) as exc:
        _logger.debug("Codex models cache not shared: %s", exc)
        return False
    return True


__all__ = ["MODELS_CACHE_NAME", "seed_models_cache", "share_models_cache", "shared_cache_path"]
