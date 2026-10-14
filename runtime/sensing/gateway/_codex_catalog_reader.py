"""Bounded Codex marketplace reads for the capability list endpoint.

``CodexAccountService.list_plugins`` answers through the Codex App Server's
``plugin/list``, which first fetches the remote ChatGPT plugin directory. That
fetch is slow: on a local dev instance the GLOBAL scope alone took 22-26 s per
App Server, close to the 30 s RPC timeout. The App Server caches the result
only for its own lifetime, so the cost comes back after every idle reap and
after each install or uninstall.

The HUB list must not wait on that. ``CodexCatalogReader`` waits a short bound.
If the fetch is not done by then, it keeps the fetch running in the
background, one per principal, and returns the last catalog it saw for that
principal. Before the first fetch finishes it raises ``TimeoutError``, and the
router falls back to local capabilities as it does for any catalog failure.
Install and uninstall drop the stored catalog, so a list never serves install
state that is known to be stale.
"""

from __future__ import annotations

import asyncio
import logging
from functools import partial
from typing import Any

from runtime.execution.codex_backend.account import codex_account_scope_key

_LOG = logging.getLogger(__name__)

LIST_WAIT_S = 2.0
_Rows = list[dict[str, Any]]


class CodexCatalogReader:
    """Serve the Codex plugin catalog to list calls without blocking on it."""

    def __init__(self, accounts: Any, *, wait_s: float | None = None) -> None:
        self._accounts = accounts
        self._wait_s = LIST_WAIT_S if wait_s is None else wait_s
        self._fetches: dict[str, asyncio.Task[_Rows]] = {}
        self._last_good: dict[str, _Rows] = {}

    async def list_plugins(self, scope: Any, *, force_refetch: bool = False) -> _Rows:
        """Return live rows within ``wait_s``, else the last good rows."""

        key = codex_account_scope_key(scope)
        task = self._fetches.get(key)
        if task is None or task.done() or task.get_loop() is not asyncio.get_running_loop():
            task = asyncio.create_task(
                self._accounts.list_plugins(scope, force_refetch=force_refetch),
                name="codex-plugin-catalog-fetch",
            )
            task.add_done_callback(partial(self._settle, key))
            self._fetches[key] = task
        try:
            # shield: a slow fetch outlives this request and warms the cache.
            rows = await asyncio.wait_for(asyncio.shield(task), timeout=self._wait_s)
        except TimeoutError:
            last_good = self._last_good.get(key)
            if last_good is None:
                raise TimeoutError(
                    f"Codex plugin catalog not ready within {self._wait_s:g}s; "
                    "still fetching in the background"
                ) from None
            return [dict(row) for row in last_good]
        return [dict(row) for row in rows]

    async def install_plugin(self, scope: Any, *, catalog_id: str) -> dict[str, Any]:
        try:
            return await self._accounts.install_plugin(scope, catalog_id=catalog_id)
        finally:
            self._forget(scope)

    async def uninstall_plugin(self, scope: Any, *, catalog_id: str) -> dict[str, Any]:
        try:
            return await self._accounts.uninstall_plugin(scope, catalog_id=catalog_id)
        finally:
            self._forget(scope)

    def _forget(self, scope: Any) -> None:
        key = codex_account_scope_key(scope)
        self._last_good.pop(key, None)
        # A fetch started before the mutation would store pre-mutation rows.
        self._fetches.pop(key, None)

    def _settle(self, key: str, task: asyncio.Task[_Rows]) -> None:
        if self._fetches.get(key) is not task:
            return
        del self._fetches[key]
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            _LOG.debug("Codex plugin catalog fetch failed: %s", exc)
            return
        self._last_good[key] = [dict(row) for row in task.result()]
