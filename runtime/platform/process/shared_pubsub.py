"""Bounded Redis Pub/Sub wake-ups; authoritative data stays in its source store."""

from __future__ import annotations

import json
import logging
import os
import queue
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

_LOG = logging.getLogger(__name__)
_MAX_BYTES = 256 * 1024
_QUEUE_SIZE = 256


class SharedPubSubUnavailable(RuntimeError):
    """The configured shared subscription or publisher is unavailable."""


class RedisPubSub:
    """One subscription reader and bounded callback worker per backend process.

    PubSub objects stay on the reader thread. Slow callbacks cannot block its
    socket indefinitely; overflow drops wake-ups, never committed source data.
    """

    def __init__(self, url: str, namespace: str, *, timeout: float = 2.0) -> None:
        from redis import Redis
        from redis.backoff import NoBackoff
        from redis.retry import Retry

        if not isinstance(namespace, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", namespace):
            raise ValueError("shared transport requires a distinct environment namespace")
        self._pid = os.getpid()
        self.namespace = namespace
        self.origin = uuid4().hex
        self.channel = f"echo:realtime:{namespace}:v1"
        self._client = Redis.from_url(
            url,
            socket_connect_timeout=timeout,
            socket_timeout=timeout,
            decode_responses=False,
            max_connections=8,
            # The reader owns reconnects; hidden client backoff must not outlive shutdown.
            retry=Retry(NoBackoff(), 0),
        )
        self._timeout = timeout
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._lock = threading.Lock()
        self._handlers: dict[str, list[Callable[[dict[str, Any]], None]]] = {}
        self._pending: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=_QUEUE_SIZE)
        self._reader: threading.Thread | None = None
        self._dispatcher: threading.Thread | None = None
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._closed = False
        self._generation = 0
        self._dropped_events = 0
        self._overflow_report_at = 0.0

    @property
    def connected(self) -> bool:
        return self._ready.is_set() and not self._stop.is_set()

    @property
    def generation(self) -> int:
        """Subscription acknowledgements, including reconnects."""
        with self._lock:
            return self._generation

    @property
    def dropped_events(self) -> int:
        return self._dropped_events

    def subscribe(
        self, kind: str, callback: Callable[[dict[str, Any]], None]
    ) -> Callable[[], None]:
        with self._lock:
            self._handlers.setdefault(kind, []).append(callback)

        def remove() -> None:
            with self._lock:
                handlers = self._handlers.get(kind, [])
                if callback in handlers:
                    handlers.remove(callback)

        return remove

    def start(self) -> None:
        if os.getpid() != self._pid:
            raise SharedPubSubUnavailable("initialize shared transport after the worker fork")
        with self._lock:
            if self._closed:
                raise SharedPubSubUnavailable("shared transport is closed")
            if self._reader is None:
                self._dispatcher = threading.Thread(
                    target=self._dispatch, name="shared-delivery", daemon=True
                )
                self._reader = threading.Thread(
                    target=self._listen, name="shared-subscribe", daemon=True
                )
                self._dispatcher.start()
                self._reader.start()
        if not self._ready.wait(timeout=self._timeout + 1):
            raise SharedPubSubUnavailable("shared subscription is unavailable")

    def publish(self, kind: str, payload: dict[str, Any]) -> None:
        self.start()
        raw = json.dumps(
            {
                "version": 1,
                "namespace": self.namespace,
                "origin": self.origin,
                "event_id": uuid4().hex,
                "kind": kind,
                "payload": payload,
            },
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        if len(raw) > _MAX_BYTES:
            raise ValueError("shared event exceeds the frame limit")
        try:
            self._client.publish(self.channel, raw)
        except Exception as exc:  # noqa: BLE001 - never expose a credential-bearing URL
            raise SharedPubSubUnavailable("shared publisher is unavailable") from exc

    def _decode(self, raw: Any) -> dict[str, Any] | None:
        if not isinstance(raw, bytes) or len(raw) > _MAX_BYTES:
            return None
        try:
            event = json.loads(raw)
            if (
                not isinstance(event, dict)
                or type(event.get("version")) is not int
                or event["version"] != 1
            ):
                return None
            if event.get("namespace") != self.namespace or event.get("origin") == self.origin:
                return None
            for key in ("origin", "event_id"):
                value = event.get(key)
                if not isinstance(value, str) or UUID(hex=value).hex != value:
                    return None
            if not isinstance(event.get("kind"), str) or not isinstance(event.get("payload"), dict):
                return None
            return event
        except (ValueError, TypeError, UnicodeDecodeError):
            return None

    def _listen(self) -> None:
        while not self._stop.is_set():
            try:
                with self._client.pubsub(ignore_subscribe_messages=False) as subscription:
                    subscription.subscribe(self.channel)
                    while not self._stop.is_set():
                        message = subscription.get_message(timeout=0.25)
                        if not message:
                            continue
                        if message["type"] == "subscribe":
                            with self._lock:
                                self._generation += 1
                            self._ready.set()
                            continue
                        if message["type"] != "message":
                            continue
                        event = self._decode(message.get("data"))
                        if event is not None:
                            try:
                                self._pending.put_nowait(event)
                            except queue.Full:
                                self._dropped_events += 1
                                now = time.monotonic()
                                if now >= self._overflow_report_at:
                                    self._overflow_report_at = now + 30
                                    _LOG.warning(
                                        "shared wake-up queue full; durable catch-up required"
                                    )
            except Exception:  # noqa: BLE001 - credentials and message bodies stay out of logs
                self._ready.clear()
                self._stop.wait(0.25)
        self._ready.clear()

    def _dispatch(self) -> None:
        while not self._stop.is_set():
            try:
                event = self._pending.get(timeout=0.25)
            except queue.Empty:
                continue
            event_id = event["event_id"]
            if event_id in self._seen:
                continue
            self._seen[event_id] = None
            while len(self._seen) > 4096:
                self._seen.popitem(last=False)
            with self._lock:
                handlers = list(self._handlers.get(event["kind"], []))
            for handler in handlers:
                try:
                    handler(event)
                except Exception:  # noqa: BLE001 - one consumer cannot stop the shared subscription
                    _LOG.warning("shared event consumer failed; durable catch-up required")

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._stop.set()
            workers = (self._reader, self._dispatcher)
        # Interrupt an in-flight socket read before waiting for its owner thread.
        self._client.close()
        for worker in workers:
            if worker is not None and worker is not threading.current_thread():
                worker.join(timeout=self._timeout + 1)
        if any(worker is not None and worker.is_alive() for worker in workers):
            raise SharedPubSubUnavailable("shared transport did not stop within its shutdown bound")
