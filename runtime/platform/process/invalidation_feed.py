"""Bounded, best-effort canonical-state wake-ups across configured workers."""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from typing import Any

from .shared_pubsub import RedisPubSub, SharedPubSubUnavailable

_LOG = logging.getLogger(__name__)


class InvalidationFeed:
    def __init__(
        self,
        topic: str,
        bus: RedisPubSub | None = None,
        *,
        scoped: bool = False,
        max_subscribers: int = 1024,
        max_pending: int = 256,
    ) -> None:
        for value in (max_subscribers, max_pending):
            if type(value) is not int or not 1 <= value <= 8192:
                raise ValueError("invalidation limits must be 1..8192")
        self.bus, self.topic, self.scoped = bus, topic, scoped
        self._pid = os.getpid()
        self._limit, self._pending_limit = max_subscribers, max_pending
        self._lock = threading.Lock()
        self._callbacks: list[tuple[str, Callable[[], None]]] = []
        self._keys: set[str] = set()
        self._pending = threading.Event()
        self._stopped = threading.Event()
        self._thread: threading.Thread | None = None
        self.dropped = 0
        self._remove_bus = bus.subscribe(topic, self._remote) if bus is not None else None

    def start(self) -> None:
        if os.getpid() != self._pid:
            raise RuntimeError("construct invalidation delivery after worker fork")
        with self._lock:
            if self._stopped.is_set():
                raise RuntimeError("invalidation delivery is closed")
            if self._thread is None:
                self._thread = threading.Thread(
                    target=self._run, name="canonical-change-delivery", daemon=True
                )
                self._thread.start()

    def _valid_key(self, key: Any) -> bool:
        return isinstance(key, str) and (0 < len(key) <= 256 if self.scoped else key == "")

    def notify(self, key: str = "") -> None:
        """Enqueue only; never read state or publish under the source's lock."""
        if os.getpid() != self._pid or self._stopped.is_set() or not self._valid_key(key):
            return
        with self._lock:
            if key not in self._keys and len(self._keys) >= self._pending_limit:
                self.dropped += 1
                return
            self._keys.add(key)
            self._pending.set()

    def subscribe(self, callback: Callable[[], None], *, key: str = "") -> Callable[[], None]:
        if os.getpid() != self._pid:
            raise RuntimeError("construct invalidation delivery after worker fork")
        if not self._valid_key(key):
            raise ValueError("invalid canonical-state subscription key")
        entry = (key, callback)
        with self._lock:
            if self._stopped.is_set():
                raise RuntimeError("invalidation delivery is closed")
            if len(self._callbacks) >= self._limit:
                raise OverflowError("invalidation subscriber limit reached")
            self._callbacks.append(entry)

        def remove() -> None:
            with self._lock:
                if entry in self._callbacks:
                    self._callbacks.remove(entry)

        return remove

    def _deliver(self, key: str) -> None:
        with self._lock:
            callbacks = (
                ()
                if self._stopped.is_set()
                else tuple(callback for scope, callback in self._callbacks if scope == key)
            )
        for callback in callbacks:
            try:
                callback()
            except Exception:  # noqa: BLE001 -- closed consumers cannot stop other wake-ups
                _LOG.warning("invalidation consumer unavailable; HTTP catch-up retained")

    def _remote(self, event: dict[str, Any]) -> None:
        payload = event.get("payload")
        if event.get("kind") != self.topic:
            return
        if not self.scoped and payload == {}:
            self._deliver("")
        elif (
            self.scoped
            and isinstance(payload, dict)
            and set(payload) == {"key"}
            and self._valid_key(payload["key"])
        ):
            self._deliver(payload["key"])  # Never republish remote hints.

    def _run(self) -> None:
        while not self._stopped.is_set():
            if not self._pending.wait(0.5):
                continue
            if self._stopped.wait(0.05):
                break
            with self._lock:
                keys = tuple(self._keys)
                self._keys.clear()
                self._pending.clear()
            for key in keys:
                self._deliver(key)
                if self.bus is not None and not self._stopped.is_set():
                    try:
                        self.bus.publish(self.topic, {"key": key} if self.scoped else {})
                    except (SharedPubSubUnavailable, RuntimeError, ValueError):
                        _LOG.warning("shared invalidation unavailable; HTTP catch-up retained")

    def close(self) -> None:
        if os.getpid() != self._pid:
            raise RuntimeError("construct invalidation delivery after worker fork")
        self._stopped.set()
        self._pending.set()
        if self._remove_bus is not None:
            self._remove_bus()
            self._remove_bus = None
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=float(getattr(self.bus, "timeout", 0.5)) + 1)
            if thread.is_alive():
                raise RuntimeError("invalidation delivery did not stop")
        with self._lock:
            self._callbacks.clear()
            self._keys.clear()
