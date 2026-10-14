"""Bounded async consumption of a synchronous model stream in one worker."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Iterator
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import suppress
from threading import Event

from runtime.platform.models.llm import ModelStreamEvent


async def model_events(
    factory: Callable[[], Iterator[ModelStreamEvent]],
) -> AsyncIterator[ModelStreamEvent]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[ModelStreamEvent | BaseException | None] = asyncio.Queue(maxsize=16)
    stopped = Event()

    def send(value: ModelStreamEvent | BaseException | None) -> bool:
        if stopped.is_set():
            return False
        pending = asyncio.run_coroutine_threadsafe(queue.put(value), loop)
        while not stopped.is_set():
            try:
                pending.result(timeout=0.1)
                return True
            except FutureTimeout:
                continue
        pending.cancel()
        return False

    def produce() -> None:
        iterator = None
        try:
            iterator = factory()
            for event in iterator:
                if not send(event):
                    return
        except BaseException as exc:
            send(exc)
        finally:
            close = getattr(iterator, "close", None)
            if callable(close):
                with suppress(Exception):
                    close()
            send(None)

    worker = asyncio.create_task(asyncio.to_thread(produce))
    try:
        while True:
            event = await queue.get()
            if event is None:
                return
            if isinstance(event, BaseException):
                raise event
            yield event
    finally:
        stopped.set()
        # A synchronous HTTP read cannot be force-cancelled. Its provider
        # timeout remains authoritative; stop queue writes and close its
        # iterator in the owning worker as soon as the read returns.
        worker.cancel()
        await asyncio.gather(worker, return_exceptions=True)
