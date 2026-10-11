"""Coalesced project invalidations, delivered locally and across configured workers.

Frames carry no project state. Readers authorize and fetch canonical state;
missed wake-ups never replace the existing HTTP catch-up path.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from typing import Any

from runtime.platform.process.shared_pubsub import RedisPubSub, SharedPubSubUnavailable

_LOG = logging.getLogger(__name__)
_KIND = "project:changed"


class ProjectChangeFeed:
    def __init__(self, bus: RedisPubSub | None = None, *, max_subscribers: int = 1024):
        if type(max_subscribers) is not int or not 1 <= max_subscribers <= 8192:
            raise ValueError("project delivery subscriber limit must be 1..8192")
        self.bus = bus
        self._pid = os.getpid()
        self._limit = max_subscribers
        self._lock = threading.Lock()
        self._callbacks: list[Callable[[], None]] = []
        self._pending = threading.Event()
        self._stopped = threading.Event()
        self._thread: threading.Thread | None = None
        self._remove_bus = bus.subscribe(_KIND, self._remote) if bus is not None else None

    def start(self) -> None:
        if os.getpid() != self._pid:
            raise RuntimeError("construct project delivery after worker fork")
        with self._lock:
            if self._stopped.is_set():
                raise RuntimeError("project delivery is closed")
            if self._thread is None:
                self._thread = threading.Thread(
                    target=self._run, name="project-change-delivery", daemon=True
                )
                self._thread.start()

    def notify(self) -> None:
        """Non-blocking commit callback: no reads, serialization or network I/O."""
        if os.getpid() == self._pid and not self._stopped.is_set():
            self._pending.set()

    def subscribe(self, callback: Callable[[], None]) -> Callable[[], None]:
        if os.getpid() != self._pid:
            raise RuntimeError("construct project delivery after worker fork")
        with self._lock:
            if self._stopped.is_set():
                raise RuntimeError("project delivery is closed")
            if len(self._callbacks) >= self._limit:
                raise OverflowError("project delivery subscriber limit reached")
            self._callbacks.append(callback)

        def remove() -> None:
            with self._lock:
                if callback in self._callbacks:
                    self._callbacks.remove(callback)

        return remove

    def _deliver(self) -> None:
        with self._lock:
            callbacks = () if self._stopped.is_set() else tuple(self._callbacks)
        for callback in callbacks:
            try:
                callback()
            except Exception:  # noqa: BLE001 -- a closed consumer cannot stop other wake-ups
                _LOG.warning("project update consumer unavailable; HTTP catch-up retained")

    def _remote(self, event: dict[str, Any]) -> None:
        if event.get("kind") == _KIND and event.get("payload") == {}:
            self._deliver()  # Never republish a remote hint.

    def _run(self) -> None:
        while not self._stopped.is_set():
            if not self._pending.wait(0.5):
                continue
            # A burst of commits needs only one canonical-state invalidation.
            if self._stopped.wait(0.05):
                break
            self._pending.clear()
            self._deliver()
            if self.bus is not None:
                try:
                    self.bus.publish(_KIND, {})
                except (SharedPubSubUnavailable, RuntimeError, ValueError):
                    _LOG.warning("shared project wake-up unavailable; HTTP catch-up retained")

    def close(self) -> None:
        if os.getpid() != self._pid:
            raise RuntimeError("construct project delivery after worker fork")
        self._stopped.set()
        self._pending.set()
        if self._remove_bus is not None:
            self._remove_bus()
            self._remove_bus = None
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=float(getattr(self.bus, "timeout", 0.5)) + 1)
            if thread.is_alive():
                raise RuntimeError("project delivery did not stop")
        with self._lock:
            self._callbacks.clear()
