"""Explicit, bounded two-way sync of OS-mounted directories.

Never propagates deletions. A baseline distinguishes one-sided edits from
conflicts; the preview digest fences stale confirmations. Symlinks/reparse
points and common dependency/secret directories are excluded.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import tempfile
from pathlib import Path
from typing import Any

SKIP = {
    ".git",
    ".env",
    ".ssh",
    ".aws",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".echo-work",
}
MAX_FILES = 5000
MAX_BYTES = 512 * 1024 * 1024


def _safe(path: Path) -> None:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise ValueError("Linked files and reparse points cannot be synchronized")


def _file(root: Path, relative: str) -> Path:
    path = root
    for part in Path(relative).parts:
        if part in {"..", "."} or Path(part).is_absolute():
            raise ValueError("Invalid sync path")
        path = path / part
        if path.exists() or path.is_symlink():
            _safe(path)
    if not path.resolve().is_relative_to(root):
        raise ValueError("Sync path escaped its directory")
    return path


def _hash(path: Path) -> str | None:
    if not path.exists():
        return None
    _safe(path)
    if not path.is_file():
        raise ValueError("A sync file was replaced by a directory")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _scan(root: Path) -> tuple[dict[str, str], list[str]]:
    files: dict[str, str] = {}
    skipped: list[str] = []
    total = 0

    def fail(error: OSError) -> None:
        raise error

    for directory, dirs, names in os.walk(root, followlinks=False, onerror=fail):
        for name in list(dirs) + names:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            try:
                _safe(path)
                excluded = name in SKIP or name.startswith((".env.", ".echo-sync-"))
            except ValueError:
                excluded = True
            if excluded:
                skipped.append(relative)
                if name in dirs:
                    dirs.remove(name)
                continue
            if name in dirs:
                continue
            if not stat.S_ISREG(path.lstat().st_mode):
                skipped.append(relative)
                continue
            total += path.stat().st_size
            if len(files) >= MAX_FILES or total > MAX_BYTES:
                raise ValueError("Sync exceeds 5000 files or 512 MiB; narrow the project directory")
            files[relative] = _hash(_file(root, relative)) or ""
    return files, skipped


def plan_sync(local: Path, shared: Path, baseline: dict[str, str]) -> dict[str, Any]:
    local, shared = local.resolve(strict=True), shared.resolve(strict=True)
    if not local.is_dir() or not shared.is_dir():
        raise ValueError("Both sync directories must be accessible")
    if local.is_relative_to(shared) or shared.is_relative_to(local):
        raise ValueError("Sync directories must be separate, non-nested directories")
    left, ignored_left = _scan(local)
    right, ignored_right = _scan(shared)
    actions: list[dict[str, Any]] = []
    conflicts: list[str] = []
    agreed = dict(baseline)
    for name in sorted(left.keys() | right.keys()):
        a, b, old = left.get(name), right.get(name), baseline.get(name)
        if a == b and a is not None:
            agreed[name] = a
        elif old is not None and (a is None or b is None):
            # An absence since last sync might be an intentional deletion.
            conflicts.append(name)
        elif a is None or (old is not None and a == old):
            actions.append({"path": name, "direction": "pull", "local": a, "shared": b})
        elif b is None or (old is not None and b == old):
            actions.append({"path": name, "direction": "push", "local": a, "shared": b})
        else:
            conflicts.append(name)
    payload = {
        "local": str(local),
        "shared": str(shared),
        "left": left,
        "right": right,
        "baseline": baseline,
    }
    token = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return {
        "token": token,
        "local_path": str(local),
        "shared_path": str(shared),
        "actions": actions,
        "conflicts": conflicts,
        "skipped": sorted(set(ignored_left + ignored_right)),
        "baseline": agreed,
    }


def apply_sync(local: Path, shared: Path, plan: dict[str, Any]) -> dict[str, str]:
    """Apply a freshly revalidated plan; persist baseline only after all writes."""
    from runtime.platform.io.file_coordination import coordinate_file_mutations

    paths = [_file(root, item["path"]) for item in plan["actions"] for root in (local, shared)]
    with coordinate_file_mutations(paths):
        # Check all pairs before the first write, not just before each copy.
        for item in plan["actions"]:
            if (
                _hash(_file(local, item["path"])) != item["local"]
                or _hash(_file(shared, item["path"])) != item["shared"]
            ):
                raise ValueError("Files changed during synchronization; preview again")
        return _apply_sync(local, shared, plan)


def _apply_sync(local: Path, shared: Path, plan: dict[str, Any]) -> dict[str, str]:
    baseline = dict(plan["baseline"])
    for item in plan["actions"]:
        a, b = _file(local, item["path"]), _file(shared, item["path"])
        if _hash(a) != item["local"] or _hash(b) != item["shared"]:
            raise ValueError("Files changed during synchronization; preview again")
        source, dest = (a, b) if item["direction"] == "push" else (b, a)
        expected = item["local"] if item["direction"] == "push" else item["shared"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        _file(local if item["direction"] == "pull" else shared, item["path"])
        fd, temporary = tempfile.mkstemp(prefix=".echo-sync-", dir=dest.parent)
        try:
            digest = hashlib.sha256()
            with os.fdopen(fd, "wb") as output, source.open("rb") as incoming:
                for chunk in iter(lambda: incoming.read(1024 * 1024), b""):
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if (
                digest.hexdigest() != expected
                or _hash(a) != item["local"]
                or _hash(b) != item["shared"]
            ):
                raise ValueError("Files changed during synchronization; preview again")
            os.chmod(temporary, stat.S_IMODE(source.stat().st_mode))
            _file(local, item["path"])
            _file(shared, item["path"])
            os.replace(temporary, dest)
            baseline[item["path"]] = expected
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return baseline
