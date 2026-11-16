"""Publish asynchronously discovered MCP tools only while their owner is alive."""

from __future__ import annotations

import contextlib
import logging
import threading
from collections.abc import Callable
from typing import Any

from runtime.execution.suckers import SkillRegistry

from .schema import MCPServerConfigEntry

_LOGGER = logging.getLogger(__name__)


class MCPBootstrap(threading.Thread):
    def __init__(
        self,
        servers: list[MCPServerConfigEntry],
        registry: SkillRegistry,
        clients: list[Any],
        connect: Callable[..., Any],
    ) -> None:
        super().__init__(name="mcp-bootstrap", daemon=True)
        self._servers = servers
        self._registry = registry
        self._clients = clients
        self._connect = connect
        self._closed = threading.Event()
        self._publish_lock = threading.Lock()

    def run(self) -> None:
        for server in self._servers:
            if self._closed.is_set():
                break
            staged = SkillRegistry()
            try:
                client = self._connect(staged, server)
            except Exception:  # noqa: BLE001 - one failed server must not stop other connections
                _LOGGER.warning("MCP bootstrap: %s failed", server.name, exc_info=True)
                continue
            if client is None:
                continue
            if not self._publish(staged, client):
                with contextlib.suppress(Exception):
                    client.close()

    def _publish(self, staged: SkillRegistry, client: Any) -> bool:
        with self._publish_lock:
            if self._closed.is_set():
                return False
            # Claim ownership before publishing handlers. Shutdown takes the
            # same lock, so it cannot miss a client whose tools became visible.
            self._clients.append(client)
            for name in staged.all_names():
                try:
                    self._registry.register(staged.get(name))
                except Exception:  # noqa: BLE001 - preserve per-tool registration failure isolation
                    _LOGGER.warning("MCP bootstrap: cannot publish %s", name, exc_info=True)
            return True

    def close(self, *, timeout: float = 10.0) -> None:
        with self._publish_lock:
            self._closed.set()
            clients = self._clients[:]
            self._clients.clear()
        for client in clients:
            with contextlib.suppress(Exception):
                client.close()
        # Discovery can be in a transport call longer than our shutdown budget.
        # When it returns, run() closes the late client without publishing it.
        if self.is_alive() and threading.current_thread() is not self:
            self.join(timeout=timeout)
