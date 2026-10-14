"""Cooperatively drained workers that cannot hold interpreter exit indefinitely."""

from __future__ import annotations

import concurrent.futures.thread as thread_impl
import threading
import weakref
from concurrent.futures import ThreadPoolExecutor
from typing import cast


class DaemonThreadPoolExecutor(ThreadPoolExecutor):
    """Owners must stop submissions and drain/cancel work before process exit.

    Do not register workers in CPython's global atexit join table: daemon=True
    alone does not prevent that table from joining a stuck callback forever.
    A timed-out external operation may have an unknown outcome, so callers
    must report it and must not automatically retry a possible side effect.
    """

    def _adjust_thread_count(self) -> None:
        if self._idle_semaphore.acquire(timeout=0):
            return

        def on_gc(_reference, queue=self._work_queue):
            queue.put(None)

        if len(self._threads) >= self._max_workers:
            return
        reference = weakref.ref(self, on_gc)
        context = getattr(self, "_create_worker_context", None)
        args = (
            (reference, context(), self._work_queue)
            if callable(context)
            else (
                reference,
                self._work_queue,
                getattr(self, "_initializer", None),
                getattr(self, "_initargs", ()),
            )
        )
        worker = threading.Thread(
            name=f"{self._thread_name_prefix}_{len(self._threads)}",
            target=thread_impl._worker,
            args=args,
            daemon=True,
        )
        worker.start()
        cast(set[threading.Thread], self._threads).add(worker)
