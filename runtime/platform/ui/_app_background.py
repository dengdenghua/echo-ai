"""Bounded shutdown for the background schedulers ``create_app`` starts.

The regeneration, camouflage, evolution auto-trigger and ambient-suggestion
schedulers are process singletons whose daemon threads are started while the
app is built. Nothing stopped them when the app shut down, so a finished
lifespan left them ticking: they outlived the app they were wired to and kept
touching its journal and data directory until the interpreter exited.

Each start site registers the matching ``stop`` here, before calling
``start``, so a start that fails half-way is still reaped. One shutdown handler
per app then stops every registered scheduler concurrently on worker threads:
the event loop is not blocked by a join, and the whole step is bounded by the
slowest join timeout instead of their sum. Every ``stop`` is idempotent, so
re-running shutdown (or stopping a scheduler that never started) is harmless.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

_LOG = logging.getLogger(__name__)

STOP_TIMEOUT_SECONDS = 5.0
_STOPS_STATE_KEY = "background_scheduler_stops"


def stop_on_shutdown(
    app: Any,
    name: str,
    stop: Callable[..., Any],
    *,
    timeout: float = STOP_TIMEOUT_SECONDS,
) -> None:
    """Call ``stop(timeout=timeout)`` when ``app`` shuts down.

    Registering the same ``name`` twice keeps one entry (the latest ``stop``),
    so a re-wired scheduler is stopped exactly once.
    """

    stops: dict[str, Callable[[], Any]] | None = getattr(app.state, _STOPS_STATE_KEY, None)
    if stops is None:
        stops = {}
        setattr(app.state, _STOPS_STATE_KEY, stops)
        app.router.add_event_handler("shutdown", _shutdown_handler(stops))
    stops[name] = lambda: stop(timeout=timeout)


def _shutdown_handler(stops: dict[str, Callable[[], Any]]) -> Callable[[], Any]:
    async def _stop_background_schedulers() -> None:
        entries = list(stops.items())
        if not entries:
            return
        results = await asyncio.gather(
            *(asyncio.to_thread(stop) for _, stop in entries),
            return_exceptions=True,
        )
        for (name, _), result in zip(entries, results, strict=True):
            # One scheduler failing to stop must not keep the remaining
            # shutdown handlers (stores, sockets, plugins) from running.
            if isinstance(result, BaseException):
                _LOG.warning("background scheduler %s failed to stop: %r", name, result)

    return _stop_background_schedulers


__all__ = ["STOP_TIMEOUT_SECONDS", "stop_on_shutdown"]
