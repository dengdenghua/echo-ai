"""Shared cooperative cancellation and renewal for durable execution claims.

Stores remain authoritative: every publication must also fence its generation
in the same transaction as the write. A heartbeat alone is never permission to
publish.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from runtime.safety.approval.cancellation import (
    CancellationSource,
    CancellationToken,
    current_cancellation_token,
    scoped_cancellation,
)


class ExecutionClaimGuard:
    def __init__(self, renew: Callable[[], bool], *, interval_s: float):
        self._renew = renew
        self._interval = max(0.01, interval_s)
        self._stop = threading.Event()
        self._lost = threading.Event()
        self._renew_lock = threading.Lock()
        self._cancellation = CancellationSource(parent=current_cancellation_token())

    @property
    def claim_lost(self) -> bool:
        return self._lost.is_set()

    @property
    def token(self) -> CancellationToken:
        return self._cancellation.token

    def verify(self) -> bool:
        """Fail closed on revoked ownership or an unavailable claim store."""
        with self._renew_lock:
            if self.claim_lost or self.token.is_cancelled:
                return False
            try:
                valid = self._renew()
            except Exception:  # noqa: BLE001 - ownership cannot be assumed on storage failure
                valid = False
            if not valid:
                self._lost.set()
                self._cancellation.cancel(reason="execution claim lost or unavailable")
            return valid

    def checkpoint(self) -> None:
        self.verify()
        self.token.throw_if_cancelled()

    @contextmanager
    def scope(self) -> Iterator[ExecutionClaimGuard]:
        def cancel(reason: str) -> None:
            self._cancellation.cancel(reason=reason)

        unlink = current_cancellation_token().on_cancelled(cancel)

        def pulse() -> None:
            while not self._stop.wait(self._interval):
                if not self.verify():
                    return

        thread = threading.Thread(target=pulse, name="execution-claim", daemon=True)
        try:
            thread.start()
            with scoped_cancellation(self.token):
                yield self
        finally:
            self._stop.set()
            if thread.ident is not None:
                thread.join(timeout=1)
            unlink()
