"""Stream queueing and result-validation helpers for the App Server client.

Extracted from ``client`` to keep the client class under the god-file
threshold. These names are re-imported by the client module, so nothing
outside ``codex_backend`` should depend on this module directly.
"""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import TypeAlias, cast

from .types import (
    BackpressureError,
    JsonObject,
    JsonValue,
    MessageTooLargeError,
    Notification,
    ProtocolError,
    RemoteError,
    RequestTimeoutError,
    TransportClosedError,
)

# Keep isinstance narrow without hiding programming errors behind fail-closed
# transport wrapping.
CodexAppServerBaseErrors = (
    BackpressureError,
    MessageTooLargeError,
    ProtocolError,
    RemoteError,
    RequestTimeoutError,
    TransportClosedError,
)


class _State(Enum):
    NEW = "new"
    STARTING = "starting"
    READY = "ready"
    FAILED = "failed"
    CLOSING = "closing"
    CLOSED = "closed"


@dataclass(frozen=True, slots=True)
class _StreamTerminal:
    error: BaseException | None


_StreamItem: TypeAlias = Notification | _StreamTerminal

_COALESCIBLE_DELTA_METHODS = frozenset(
    {
        "item/agentMessage/delta",
        "item/reasoning/textDelta",
        "item/reasoning/summaryTextDelta",
        "item/plan/delta",
        "item/commandExecution/outputDelta",
        "item/fileChange/outputDelta",
        "item/process/outputDelta",
    }
)
_REPLACEABLE_SNAPSHOT_METHODS = frozenset({"thread/tokenUsage/updated"})
_MAX_COALESCED_DELTA_CHARS = 64 * 1024


def _notification_stream_key(notification: Notification) -> tuple[object, ...]:
    params = notification.params
    return (
        notification.method,
        params.get("threadId"),
        params.get("turnId"),
        params.get("itemId"),
        params.get("processId"),
    )


def _coalesce_notifications(
    previous: _StreamItem,
    current: _StreamItem,
) -> Notification | None:
    """Combine adjacent high-frequency frames without changing event order."""

    if not isinstance(previous, Notification) or not isinstance(current, Notification):
        return None
    if _notification_stream_key(previous) != _notification_stream_key(current):
        return None
    if current.method in _REPLACEABLE_SNAPSHOT_METHODS:
        return current
    if current.method not in _COALESCIBLE_DELTA_METHODS:
        return None
    previous_delta = previous.params.get("delta")
    current_delta = current.params.get("delta")
    if not isinstance(previous_delta, str) or not isinstance(current_delta, str):
        return None
    if len(previous_delta) + len(current_delta) > _MAX_COALESCED_DELTA_CHARS:
        return None
    return Notification(
        current.method,
        {**previous.params, **current.params, "delta": previous_delta + current_delta},
    )


class _CoalescingNotificationQueue:
    """Bounded single-consumer queue that compacts adjacent stream deltas.

    App Server can emit hundreds of token or process-output frames between two
    consumer scheduling opportunities. Counting every frame as a separate
    queue slot made a healthy turn fail under a harmless burst. Adjacent
    frames from the same logical stream are losslessly merged while lifecycle
    and terminal events retain their original ordering and hard bound.
    """

    def __init__(self, *, maxsize: int) -> None:
        self._maxsize = maxsize
        self._items: deque[_StreamItem] = deque()
        self._ready = asyncio.Event()

    def put_nowait(self, item: _StreamItem) -> None:
        if isinstance(item, Notification) and item.method in _REPLACEABLE_SNAPSHOT_METHODS:
            item_key = _notification_stream_key(item)
            for index in range(len(self._items) - 1, -1, -1):
                existing = self._items[index]
                if (
                    isinstance(existing, Notification)
                    and _notification_stream_key(existing) == item_key
                ):
                    # Usage is a latest-value snapshot, not an ordered delta.
                    # Replacing it in place keeps telemetry from separating
                    # otherwise adjacent content frames during a burst.
                    self._items[index] = item
                    return
        if self._items:
            merged = _coalesce_notifications(self._items[-1], item)
            if merged is not None:
                self._items[-1] = merged
                return
        if len(self._items) >= self._maxsize:
            raise asyncio.QueueFull
        self._items.append(item)
        self._ready.set()

    def get_nowait(self) -> _StreamItem:
        if not self._items:
            raise asyncio.QueueEmpty
        item = self._items.popleft()
        if not self._items:
            self._ready.clear()
        return item

    async def get(self) -> _StreamItem:
        while True:
            try:
                return self.get_nowait()
            except asyncio.QueueEmpty:
                await self._ready.wait()

    def qsize(self) -> int:
        return len(self._items)


def _require_object_result(result: JsonValue, operation: str) -> JsonObject:
    if not isinstance(result, dict):
        raise ProtocolError(f"{operation} response must be a JSON object")
    return cast(JsonObject, result)
