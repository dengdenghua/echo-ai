"""Bounded in-memory presence, optionally shared through Redis Pub/Sub."""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import OrderedDict
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from runtime.platform.process.shared_pubsub import RedisPubSub, SharedPubSubUnavailable

_LIMIT = 8192
_WINDOW = 60.0
_LOG = logging.getLogger(__name__)


class TransientPresence:
    """Heartbeats and socket presence never become Redis keys or SQLite rows."""

    def __init__(self, bus: RedisPubSub | None = None) -> None:
        self.bus = bus
        self.origin = bus.origin if bus is not None else uuid4().hex
        self._lock = threading.RLock()
        self._entries: OrderedDict[tuple[str, str, str, str], dict[str, Any]] = OrderedDict()
        self._requested_generation = 0
        self._requesting = False
        self._unavailable = False
        self._sequence = 0
        self._revisions: OrderedDict[tuple[str, str, str], int] = OrderedDict()
        self._snapshot_arrived = threading.Event()
        if bus is not None:
            bus.subscribe("presence", self._receive)
            bus.subscribe("presence:request", self._snapshot)
            bus.subscribe("presence:snapshot", self._receive_snapshot)

    def _apply(
        self,
        origin: str,
        scope: str,
        scope_id: str,
        items: list[Any],
        *,
        complete: bool,
        revision: int,
    ) -> None:
        clean: dict[tuple[str, str, str, str], dict[str, Any]] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            member = item.get("member_id")
            seen = item.get("last_seen_at")
            if not isinstance(member, str) or not member or len(member) > 256:
                continue
            if not isinstance(seen, str) or type(item.get("online")) is not bool:
                continue
            try:
                stamp = datetime.fromisoformat(seen)
                if stamp.tzinfo is None:
                    stamp = stamp.replace(tzinfo=UTC)
                epoch = stamp.timestamp()
            except (ValueError, OverflowError):
                continue
            key = (scope, scope_id, member, origin)
            item_revision = item.get("revision", revision)
            if type(item_revision) is not int or item_revision < 0:
                continue
            remaining = item.get("ttl_seconds", _WINDOW)
            if (
                isinstance(remaining, bool)
                or not isinstance(remaining, (int, float))
                or not math.isfinite(remaining)
                or not 0 <= remaining <= _WINDOW
            ):
                continue
            clean[key] = {
                "last_seen_at": seen,
                "epoch": epoch,
                "online": item["online"],
                "revision": item_revision,
            }
            clean[key]["deadline"] = time.monotonic() + remaining
        with self._lock:
            scope_key = (scope, scope_id, origin)
            if complete and revision < self._revisions.get(scope_key, -1):
                return
            self._revisions[scope_key] = max(revision, self._revisions.get(scope_key, -1))
            self._revisions.move_to_end(scope_key)
            while len(self._revisions) > _LIMIT:
                self._revisions.popitem(last=False)
            if complete:
                for key in list(self._entries):
                    if (
                        key[0] == scope
                        and key[1] == scope_id
                        and key[3] == origin
                        and key not in clean
                    ):
                        self._entries[key]["online"] = False
                        self._entries[key]["revision"] = revision
            for key, value in clean.items():
                current = self._entries.get(key)
                if current is None or value["revision"] > current["revision"]:
                    self._entries[key] = value
                    self._entries.move_to_end(key)
            while len(self._entries) > _LIMIT:
                self._entries.popitem(last=False)

    def ensure_started(self) -> None:
        if self.bus is None:
            return
        try:
            self.bus.start()
        except SharedPubSubUnavailable:
            self._warn_unavailable()
            return
        generation = self.bus.generation
        with self._lock:
            if self._requesting or self._requested_generation == generation:
                return
            self._requesting = True
            self._snapshot_arrived.clear()
        try:
            self.bus.publish("presence:request", {})
        except SharedPubSubUnavailable:
            self._warn_unavailable()
            return
        else:
            with self._lock:
                self._requested_generation = generation
                self._unavailable = False
        finally:
            with self._lock:
                self._requesting = False
        # Initial peers can warm this worker without writing a snapshot store.
        # No-peer startup remains bounded; later replies still update the cache.
        self._snapshot_arrived.wait(timeout=0.2)

    def _warn_unavailable(self) -> None:
        with self._lock:
            if not self._unavailable:
                _LOG.warning("shared presence unavailable; local presence remains transient")
            self._unavailable = True

    def record(self, scope: str, scope_id: str, member: str, seen: str) -> None:
        self.replace(
            scope,
            scope_id,
            [{"member_id": member, "last_seen_at": seen, "online": True}],
            complete=False,
        )

    def replace(
        self, scope: str, scope_id: str, items: list[dict[str, Any]], *, complete: bool = True
    ) -> None:
        self.publish_prepared(self.prepare(scope, scope_id, items, complete=complete))

    def prepare(
        self, scope: str, scope_id: str, items: list[dict[str, Any]], *, complete: bool = True
    ) -> dict[str, Any]:
        """Capture and update local state under a caller's lock without network I/O."""
        with self._lock:
            self._sequence += 1
            revision = self._sequence
            stamped = [{**item, "revision": revision} for item in items]
            self._apply(self.origin, scope, scope_id, stamped, complete=complete, revision=revision)
        return {
            "scope": scope,
            "scope_id": scope_id,
            "items": stamped,
            "complete": complete,
            "revision": revision,
        }

    def publish_prepared(self, data: dict[str, Any]) -> None:
        if self.bus is not None:
            self.ensure_started()
            try:
                self.bus.publish("presence", data)
            except SharedPubSubUnavailable:
                self._warn_unavailable()

    def values(self, scope: str, scope_id: str) -> dict[str, dict[str, Any]]:
        now = time.monotonic()
        result: dict[str, dict[str, Any]] = {}
        with self._lock:
            for key, value in self._entries.items():
                if key[:2] != (scope, scope_id):
                    continue
                member = key[2]
                online = bool(value["online"] and now <= value["deadline"])
                current = result.get(member)
                if current is None:
                    result[member] = {**value, "online": online}
                else:
                    newer = value if value["epoch"] > current["epoch"] else current
                    result[member] = {**newer, "online": current["online"] or online}
        return result

    def _receive(self, event: dict[str, Any]) -> None:
        data = event["payload"]
        scope, scope_id = data.get("scope"), data.get("scope_id")
        items = data.get("items")
        if scope not in {"room", "cowork"} or not isinstance(scope_id, str) or not scope_id:
            return
        if (
            not isinstance(items, list)
            or len(items) > 1024
            or type(data.get("complete")) is not bool
        ):
            return
        revision = data.get("revision")
        if type(revision) is not int or revision < 0:
            return
        self._apply(
            event["origin"], scope, scope_id, items, complete=data["complete"], revision=revision
        )

    def _snapshot(self, event: dict[str, Any]) -> None:
        if self.bus is None:
            return
        with self._lock:
            entries = [
                {
                    "scope": key[0],
                    "scope_id": key[1],
                    "member_id": key[2],
                    "origin": key[3],
                    **value,
                    "ttl_seconds": max(0, min(_WINDOW, value["deadline"] - time.monotonic())),
                }
                for key, value in self._entries.items()
                if value["deadline"] > time.monotonic()
            ]
        for offset in range(0, max(1, len(entries)), 128):
            self.bus.publish(
                "presence:snapshot",
                {"target": event["origin"], "entries": entries[offset : offset + 128]},
            )

    def _receive_snapshot(self, event: dict[str, Any]) -> None:
        data = event["payload"]
        if data.get("target") != self.origin or not isinstance(data.get("entries"), list):
            return
        if len(data["entries"]) > 128:
            return
        for item in data["entries"]:
            if not isinstance(item, dict) or item.get("scope") not in {"room", "cowork"}:
                continue
            if not all(
                isinstance(item.get(key), str) and item[key] for key in ("origin", "scope_id")
            ):
                continue
            revision = item.get("revision")
            if type(revision) is not int or revision < 0:
                continue
            self._apply(
                item["origin"],
                item["scope"],
                item["scope_id"],
                [item],
                complete=False,
                revision=revision,
            )
        self._snapshot_arrived.set()
