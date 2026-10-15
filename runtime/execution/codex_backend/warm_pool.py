"""Keep a conversation's Codex App Server process between its turns.

A fresh App Server spent ~4.4 s before the model saw a turn (measured
2026-10-15 with ``RUST_LOG``): the model list refresh, the Responses
websocket connect, Codex's own warm-up request, and an account request while
building the first turn's world state. The next turn in the same process took
2.1 s in total. So after a turn that finished, the process stays for up to
``IDLE_SECONDS``, and at most ``MAX_WARM`` of them do.

Still per turn: ``security.prepare`` and its config/read check, the
``thread/resume`` that reasserts this turn's dynamic tools and instructions,
``turn/start``'s security overrides, and the approval broker and dynamic tool
handler, swapped in through ``TurnHandlers``. Per process instead of per turn:
the App Server's own HOME/TEMP and tool scratch, which are the launching
turn's and are removed when the process is retired.

Only plain local launches are kept: no outer sandbox wrapper, and no
turn-scoped provider credential in the process environment.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import inspect
import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ._transport import deny_approval
from .client import CodexAppServerClient
from .dynamic_tools import dynamic_tool_failure

_logger = logging.getLogger(__name__)

IDLE_SECONDS = 600.0
MAX_WARM = 3

_pool: dict[str, WarmProcess] = {}


async def _call(handler: Any, request: Any, fallback: Mapping[str, Any]) -> Mapping[str, Any]:
    # The client's own calling convention for a sync or async handler.
    if handler is None:
        return fallback
    if inspect.iscoroutinefunction(handler) or inspect.iscoroutinefunction(type(handler).__call__):
        return await handler(request)
    result = await asyncio.to_thread(handler, request)
    if inspect.isawaitable(result):
        return await result
    return result


@dataclass
class TurnHandlers:
    """What the App Server's requests reach: the current turn's, or a refusal."""

    approval: Any = None
    dynamic_tool: Any = None

    async def approve(self, request: Any) -> Mapping[str, Any]:
        return await _call(self.approval, request, deny_approval(request.method))

    async def run_dynamic_tool(self, request: Any) -> Mapping[str, Any]:
        failure = dynamic_tool_failure("Echo dynamic tool bridge is unavailable")
        return await _call(self.dynamic_tool, request, failure)

    def clear(self) -> None:
        self.approval = None
        self.dynamic_tool = None


@dataclass
class WarmProcess:
    key: str
    client: CodexAppServerClient
    handlers: TurnHandlers
    owner: Any  # the CodexSidecarContext the process was launched with
    loop: asyncio.AbstractEventLoop
    in_use: bool = True
    idle_handle: asyncio.TimerHandle | None = field(default=None, repr=False)


def key_for(request: Any, context: Any, *, wrapped: bool) -> str | None:
    """The reuse key, or ``None`` when this launch must stay one-shot."""

    profile = request.provider_profile
    if wrapped or (profile is not None and profile.scoped_bearer_token is not None):
        return None
    material = {
        "command": list(request.command),
        "codex_home": str(context.codex_home),
        "workspace": str(context.workspace),
        "sandbox_mode": context.sandbox_mode,
        "approval_reviewer": context.approval_reviewer,
        "selected_app_ids": list(context.selected_app_ids),
        "locked_off_features": list(context.locked_off_features),
        "host_skills_isolated": context.host_skills_isolated,
        "provider": None if profile is None else [profile.provider_id, profile.model],
        "tool_free": request.tool_free,
        "host_tools_only": request.host_tools_only,
        "dynamic_tools": request.dynamic_tool_handler is not None,
        # A new login (or a logout) must not be answered by the old one.
        "login": _digest(getattr(request, "source_codex_home", None)),
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest()


def _digest(codex_home: Any) -> str | None:
    if codex_home is None:
        return None
    try:
        return hashlib.sha256((Path(codex_home) / "auth.json").read_bytes()).hexdigest()
    except OSError:
        return None


def take(key: str | None) -> WarmProcess | None:
    """Claim the idle process for ``key`` on this event loop, if one is alive."""

    if key is None:
        return None
    entry = _pool.get(key)
    if entry is None or entry.in_use:
        return None
    if entry.loop is not asyncio.get_running_loop() or not entry.client.ready:
        _pool.pop(key, None)
        _schedule_retire(entry)
        return None
    if entry.idle_handle is not None:
        entry.idle_handle.cancel()
        entry.idle_handle = None
    entry.in_use = True
    return entry


def keep(entry: WarmProcess) -> None:
    """Return a process whose turn finished; it waits for the next turn."""

    entry.handlers.clear()
    if not entry.client.ready:
        _pool.pop(entry.key, None)
        _schedule_retire(entry)
        return
    entry.in_use = False
    _pool.pop(entry.key, None)
    _pool[entry.key] = entry  # most recently used last
    entry.idle_handle = entry.loop.call_later(IDLE_SECONDS, _expire, entry)
    idle = [other for other in _pool.values() if not other.in_use]
    while len(_pool) > MAX_WARM and idle:
        victim = idle.pop(0)
        _pool.pop(victim.key, None)
        _schedule_retire(victim)


def adopt(
    key: str | None, client: CodexAppServerClient, handlers: TurnHandlers, owner: Any
) -> WarmProcess | None:
    """Pool a process launched for this turn, once that turn has finished."""

    if key is None or key in _pool:
        return None
    entry = WarmProcess(key, client, handlers, owner, asyncio.get_running_loop())
    _pool[key] = entry
    keep(entry)
    return entry if _pool.get(key) is entry else None


def discard(entry: WarmProcess) -> None:
    """Forget a claimed process; the caller closes it."""

    if _pool.get(entry.key) is entry:
        del _pool[entry.key]


def _expire(entry: WarmProcess) -> None:
    if _pool.get(entry.key) is entry and not entry.in_use:
        del _pool[entry.key]
        _schedule_retire(entry)


def _schedule_retire(entry: WarmProcess) -> None:
    if entry.idle_handle is not None:
        entry.idle_handle.cancel()
        entry.idle_handle = None
    if entry.loop.is_closed():
        return
    entry.loop.create_task(retire(entry))


async def retire(entry: WarmProcess) -> None:
    """Stop the process, then remove the directories it was launched with."""

    with contextlib.suppress(Exception):
        await entry.client.close()
    try:
        entry.owner.cleanup()
    except Exception:  # noqa: BLE001 - best effort; markers let the sweeper finish
        _logger.debug("warm Codex process cleanup failed", exc_info=True)


__all__ = [
    "IDLE_SECONDS",
    "MAX_WARM",
    "TurnHandlers",
    "WarmProcess",
    "adopt",
    "discard",
    "keep",
    "key_for",
    "retire",
    "take",
]
