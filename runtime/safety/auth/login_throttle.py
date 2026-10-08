"""Bounded, thread-safe attempt limits for public authentication endpoints.

Limits apply before upstream calls or password hashing, including failed attempts.
Use the ASGI peer address (or a trusted proxy's normalized address), never a raw
forwarding header. Each server process maintains its own window; deployments with
multiple replicas should also impose a shared limit at their ingress.
"""

from __future__ import annotations

import hashlib
import math
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable


class AuthAttemptLimiter:
    def __init__(
        self,
        *,
        ip_limit: int,
        subject_limit: int,
        window_s: float,
        max_keys: int = 4096,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ip_limit = ip_limit
        self._subject_limit = subject_limit
        self._window = window_s
        self._max_keys = max_keys
        self._clock = clock
        self._buckets: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def _take(self, key: str, limit: int, now: float) -> bool:
        bucket = self._buckets.get(key)
        if bucket is None:
            # Do not evict live limits: rotating identities must not reset them.
            if len(self._buckets) >= self._max_keys:
                return False
            bucket = deque()
            self._buckets[key] = bucket
        while bucket and bucket[0] <= now - self._window:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        self._buckets.move_to_end(key)
        return True

    def check(self, request, subject: str) -> None:
        from fastapi import HTTPException

        peer = request.client.host if request.client else "unknown"
        # Avoid retaining email addresses, usernames or refresh tokens in memory.
        subject_key = hashlib.sha256(subject.strip().casefold().encode()).hexdigest()
        with self._lock:
            now = self._clock()
            while self._buckets:
                first_key, bucket = next(iter(self._buckets.items()))
                if bucket[-1] > now - self._window:
                    break
                del self._buckets[first_key]
            allowed = self._take("ip:" + peer, self._ip_limit, now) and self._take(
                "subject:" + subject_key, self._subject_limit, now
            )
        if not allowed:
            raise HTTPException(
                429,
                "尝试过于频繁，请稍后重试",
                headers={"Retry-After": str(math.ceil(self._window))},
            )
