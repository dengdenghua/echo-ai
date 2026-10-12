"""Own a realtime tunnel until bounded startup and cleanup have both finished."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any, TypeVar

import anyio

from runtime.sensing.gateway.remote_transport import RemoteBackend, connect_remote_backend

_Result = TypeVar("_Result")


async def _finish_owned_call(operation: Callable[[], _Result]) -> _Result:
    """Join a bounded thread operation before propagating cancellation.

    AnyIO scopes may repeatedly cancel ASGI checkpoints; direct asyncio task
    cancellation can also arrive while a shielded scope is active. Keep the
    operation's task alive and wait for it in either case. The tunnel methods
    impose their own connection/termination bounds.
    """
    cancelled = None
    with anyio.CancelScope(shield=True):
        task = asyncio.create_task(asyncio.to_thread(operation))
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError as exc:
                cancelled = exc
        result = task.result()
    if cancelled is not None:
        raise cancelled
    return result


@asynccontextmanager
async def realtime_backend_lifetime(
    backend: RemoteBackend, *, forwarder_factory: Callable[[RemoteBackend], Any]
) -> AsyncIterator[RemoteBackend]:
    if backend.wsl is not None:
        with connect_remote_backend(backend) as connected:
            yield connected
        return
    if backend.ssh is None:
        yield backend
        return
    await anyio.lowlevel.checkpoint_if_cancelled()
    forwarder = forwarder_factory(backend)
    try:
        connected = await _finish_owned_call(forwarder.start)
        await anyio.lowlevel.checkpoint_if_cancelled()
        yield connected
    finally:
        await _finish_owned_call(forwarder.close)
