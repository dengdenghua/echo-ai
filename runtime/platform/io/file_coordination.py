"""One mutation boundary for cooperating Echo writers on the same host.

Locks share one per-user namespace outside instance data directories, so
separate ECHO_HOME/ECHO_DATA_DIR settings do not split ownership of a shared
file. The OS releases handles on process death. Canonical paths resolve local
symlinks; this is not a distributed lock or coordination with unrelated writers.
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
    override = os.environ.get("ECHO_FILE_LOCK_DIR")
    if override is not None:
        root = Path(override).expanduser()
        if not override.strip() or not root.is_absolute():
            raise FileCoordinationConflict("ECHO_FILE_LOCK_DIR must be an absolute directory")
        return root.resolve()
    return Path.home() / ".echo" / "coordination" / "file-locks-v1"


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
