"""Short-lived id -> icon file index for ``/api/capabilities/{id}/icon``.

``CapabilityRegistry.icon_path`` lists every connector and plugin to resolve a
single id. On a dev profile that is 1.5-2.5 s of file IO, and the endpoint ran
it on the event loop. The HUB requests one icon per listed row, so a screen of
icons queued behind each other and behind the list request itself.

Icon files only change on install or upgrade. One registry walk in a worker
thread can serve every icon for a short while, and concurrent cold lookups
share that walk. The endpoint still checks that the file exists before serving
it, so an icon removed inside the window returns 404 rather than an error.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

ICON_INDEX_TTL_S = 60.0
_Index = dict[str, Path | None]


class CapabilityIconIndex:
    """Resolve local capability icons from one cached registry walk."""

    def __init__(self, registry: Any, *, ttl_s: float | None = None) -> None:
        self._registry = registry
        self._ttl_s = ICON_INDEX_TTL_S if ttl_s is None else ttl_s
        self._index: _Index = {}
        self._built_at = float("-inf")
        self._building: asyncio.Task[_Index] | None = None

    async def lookup(self, cid: str) -> tuple[bool, Path | None]:
        """Return whether ``cid`` is a registry capability, and its icon path."""

        if time.monotonic() - self._built_at >= self._ttl_s:
            await self._refresh()
        return cid in self._index, self._index.get(cid)

    async def _refresh(self) -> None:
        task = self._building
        if task is None or task.get_loop() is not asyncio.get_running_loop():
            task = asyncio.create_task(asyncio.to_thread(self._build))
            self._building = task
        started = time.monotonic()
        try:
            index = await asyncio.shield(task)
        finally:
            if self._building is task and task.done():
                self._building = None
        self._index, self._built_at = index, started

    def _build(self) -> _Index:
        index: _Index = {}
        # list() yields connectors first, so first-seen wins gives connectors
        # the same precedence as CapabilityRegistry.icon_path.
        for item in self._registry.list():
            cid = str(item.get("id") or "")
            if not cid or cid in index:
                continue
            if item.get("source") == "connector":
                index[cid] = self._registry._connector_icon_path(item)
            else:
                raw = str(item.get("_icon_path") or "")
                index[cid] = Path(raw) if raw else None
        return index
