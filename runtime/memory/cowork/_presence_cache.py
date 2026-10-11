"""Share transient presence across store instances in one backend process."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from weakref import WeakValueDictionary

from .transient_presence import TransientPresence

_LOCK = threading.Lock()
_CACHES: WeakValueDictionary[str, TransientPresence] = WeakValueDictionary()


def presence_cache(directory: Path, explicit: TransientPresence | None) -> TransientPresence:
    key = os.path.normcase(str(directory.resolve()))
    with _LOCK:
        if explicit is not None:
            _CACHES[key] = explicit
            return explicit
        cache = _CACHES.get(key)
        if cache is None:
            cache = TransientPresence()
            _CACHES[key] = cache
        return cache
