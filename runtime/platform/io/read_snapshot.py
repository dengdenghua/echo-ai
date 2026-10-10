"""Reuse file reads within one logical operation.

Some listings ask the same store the same question once per item.
``CapabilityRegistry.list()`` re-read and re-validated the permission-grant
file about 440 times per call, and re-parsed the connector manifest about 220
times. Inside ``read_snapshot()``, a read wrapped in ``snapshot_read`` runs
once per key and later calls get the same result. A store that writes a file
calls ``forget_snapshot_read`` for its key, so the scope never serves a value
older than its own write. Outside a scope every call reads through.

Snapshot values are shared, so callers must treat them as read-only. The scope
lives in a ContextVar, so concurrent requests do not share it.
"""

from __future__ import annotations

from collections.abc import Callable, Hashable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, TypeVar

_T = TypeVar("_T")
_SNAPSHOT: ContextVar[dict[Hashable, Any] | None] = ContextVar("read_snapshot", default=None)


@contextmanager
def read_snapshot() -> Iterator[None]:
    """Reuse ``snapshot_read`` results until the outermost scope exits."""

    if _SNAPSHOT.get() is not None:
        yield
        return
    token = _SNAPSHOT.set({})
    try:
        yield
    finally:
        _SNAPSHOT.reset(token)


def snapshot_read(key: Hashable, read: Callable[[], _T]) -> _T:
    """Return ``read()``, reusing this scope's earlier result for ``key``."""

    cache = _SNAPSHOT.get()
    if cache is None:
        return read()
    if key not in cache:
        cache[key] = read()
    return cache[key]  # type: ignore[no-any-return]


def forget_snapshot_read(key: Hashable) -> None:
    """Drop ``key`` from the active scope after its file was written."""

    cache = _SNAPSHOT.get()
    if cache is not None:
        cache.pop(key, None)
