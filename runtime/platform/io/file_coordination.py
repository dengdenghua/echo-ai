"""One mutation boundary for cooperating Echo writers on the same host.

Locks live outside project directories, so synchronization never copies them.
OS handles release on process death; canonical paths join aliasing mounts on
this host. This is not a distributed lock across independent Echo hosts.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import threading
from collections.abc import Iterable, Iterator
from contextlib import ExitStack, contextmanager
from pathlib import Path

from runtime.platform.io.atomic import AtomicWriteError, _cross_process_lock

_HELD = threading.local()


class FileCoordinationConflict(PermissionError):
    pass


def _lock_root() -> Path:
    from runtime.platform.process.paths import app_paths

    return app_paths().data_dir / "coordination" / "file-locks"


@contextmanager
def coordinate_file_mutations(
    paths: Iterable[str | Path], *, timeout_s: float = 0.0
) -> Iterator[None]:
    keys = sorted({os.path.normcase(str(Path(path).resolve())) for path in paths})
    try:
        owner = id(asyncio.current_task())
    except RuntimeError:
        owner = 0
    owners: dict[int, set[str]] = getattr(_HELD, "owners", {})
    _HELD.owners = owners
    held = owners.setdefault(owner, set())
    added: list[str] = []
    try:
        with ExitStack() as stack:
            for key in keys:
                if key in held:
                    continue
                target = _lock_root() / hashlib.sha256(key.encode()).hexdigest()
                try:
                    stack.enter_context(
                        _cross_process_lock(target, required=True, timeout_s=timeout_s)
                    )
                except AtomicWriteError as exc:
                    raise FileCoordinationConflict(
                        f"File is busy or cannot be locked: {key}"
                    ) from exc
                held.add(key)
                added.append(key)
            yield
    finally:
        held.difference_update(added)
        if not held:
            owners.pop(owner, None)
