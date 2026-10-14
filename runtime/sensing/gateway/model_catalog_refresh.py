"""Cadenced re-discovery of connected model-provider catalogs.

``custom_models.json`` stores the catalog that was discovered when a provider
was connected, and nothing about a stored snapshot expires on its own: a model
the service publishes afterwards stays invisible in the picker until somebody
re-enables the connector by hand. This loop re-runs each connected provider's
own ``/models`` discovery on a cadence and rewrites the snapshot in place.

Failure is deliberately inert. The refresh callback is expected to leave the
previous catalog untouched when upstream is unreachable or answers with an
empty list, so a flaky network can never empty the picker, and a raised error
only costs one interval.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from contextlib import suppress
from typing import Any

_logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 6 * 60 * 60
DEFAULT_INITIAL_DELAY_SECONDS = 20.0


def _positive_seconds(raw: str | None) -> float | None:
    """Parse a seconds knob; ``None``/blank/unparseable means "use default"."""

    if raw is None or not str(raw).strip():
        return None
    try:
        return float(str(raw).strip())
    except ValueError:
        _logger.warning("ignoring non-numeric model catalog interval %r", raw)
        return None


class ModelCatalogRefreshLoop:
    """Keep provider catalogs fresh without blocking startup or traffic.

    The first refresh is delayed rather than awaited so a slow or unreachable
    provider never delays the control plane coming up. ``interval_seconds`` of
    zero or less disables the loop entirely.
    """

    def __init__(
        self,
        refresh: Callable[[], Any],
        *,
        interval_seconds: float | None = None,
        initial_delay_seconds: float | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        if interval_seconds is None:
            interval_seconds = _positive_seconds(
                os.environ.get("ECHO_MODEL_CATALOG_REFRESH_SECONDS")
            )
            # An explicit 0 means "stay manual": only a missing or unreadable
            # knob falls back to the default cadence.
            if interval_seconds is None:
                interval_seconds = DEFAULT_INTERVAL_SECONDS
        if initial_delay_seconds is None:
            initial_delay_seconds = _positive_seconds(
                os.environ.get("ECHO_MODEL_CATALOG_REFRESH_INITIAL_DELAY_SECONDS")
            )
            if initial_delay_seconds is None:
                initial_delay_seconds = DEFAULT_INITIAL_DELAY_SECONDS
        self._refresh = refresh
        self._interval_seconds = float(interval_seconds)
        self._initial_delay_seconds = max(0.0, float(initial_delay_seconds))
        self._logger = logger or _logger
        self._task: asyncio.Task[None] | None = None

    @property
    def interval_seconds(self) -> float:
        return self._interval_seconds

    async def start(self) -> None:
        """Arm the loop; a disabled or already-running loop is left alone."""

        if self._interval_seconds <= 0:
            return
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run())

    async def close(self) -> None:
        task, self._task = self._task, None
        if task is None or task.done():
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def run_once(self) -> Any:
        """Run one refresh off the event loop; also the manual trigger."""

        return await asyncio.to_thread(self._refresh)

    async def _run(self) -> None:
        await asyncio.sleep(self._initial_delay_seconds)
        while True:
            try:
                refreshed = await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - one bad pass must not end the loop
                self._logger.warning("model catalog refresh pass failed", exc_info=True)
            else:
                if refreshed:
                    self._logger.info("model catalog refreshed for %s connector(s)", refreshed)
            await asyncio.sleep(self._interval_seconds)


__all__ = [
    "DEFAULT_INITIAL_DELAY_SECONDS",
    "DEFAULT_INTERVAL_SECONDS",
    "ModelCatalogRefreshLoop",
]
