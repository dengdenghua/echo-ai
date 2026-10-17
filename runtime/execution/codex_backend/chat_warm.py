"""One warm Codex App Server for a principal's tool-free chat turns.

A conversation's first chat reply paid a cold App Server start (~4.4 s
before the model saw the turn, 6.5 s to the first word in the UI on
2026-10-17) because every conversation had its own CODEX_HOME and so its own
process. Tool-free turns have no tools, no execution environment and a
read-only sandbox, so a principal's chat turns share one CODEX_HOME (per
provider) and a neutral working directory. Their warm-pool key is then the
same in every conversation, and a prewarm can start that process before the
first message. Each conversation still binds its own inner Codex thread.

Turns that share a CODEX_HOME serialize from writing its config.toml until
their thread is bound: ``config/read`` must see this turn's own file, and two
conversations of one principal (a team's member replies) can start together.
"""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from typing import Any

_SCOPE_VERSION = "tool-free-chat-v1"
_startup_locks: dict[str, threading.Lock] = {}


def home_scope(request: Any) -> str | None:
    """The shared CODEX_HOME scope for this request, or ``None`` (thread-owned)."""

    if not request.tool_free:
        return None
    profile = request.provider_profile
    provider = "" if profile is None else f"{profile.provider_id}\0{profile.model}"
    return f"{_SCOPE_VERSION}\0{provider}"


def chat_workspace(state_root: Path) -> Path:
    """The neutral working directory every tool-free turn runs in.

    A sibling of the Codex state root: never inside it (the sidecar must not
    see its own secrets) and never a user workspace (no project instructions
    or trust entries that would differ between conversations).
    """

    workspace = state_root.parent / f"{state_root.name}-chat-cwd"
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace.resolve(strict=True)


async def acquire_startup(key: str | None) -> threading.Lock | None:
    """Wait for this shared CODEX_HOME's startup slot; ``None`` needs none."""

    if key is None:
        return None
    lock = _startup_locks.setdefault(key, threading.Lock())
    # A threading lock: sync role runners start turns on their own loops.
    while not lock.acquire(blocking=False):
        await asyncio.sleep(0.01)
    return lock


def release_startup(lock: threading.Lock | None) -> None:
    """Free a slot from ``acquire_startup``; the caller releases it once."""

    if lock is not None:
        lock.release()
