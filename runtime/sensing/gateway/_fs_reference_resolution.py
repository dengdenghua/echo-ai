"""Resolve shortened conversation references within the owning thread only."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path

from fastapi import HTTPException

from ._fs_router_helpers import _assert_in_scope, _FsContext, _scope_roots

_SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__", ".cache"}
_MAX_ENTRIES = 30_000
_MAX_SECONDS = 2.0


def resolve_conversation_file(
    ctx: _FsContext,
    path: Path,
    *,
    thread_id: str | None,
    reference: str | None = None,
    workspace_path: str | None = None,
) -> Path:
    """Prefer the exact path; resolve a missing relative citation by unique suffix.

    Never search the host's general allowed roots or pick the first of several
    matches. Every candidate is checked again after symlink resolution.
    """
    exact = _assert_in_scope(ctx, path, thread_id=thread_id, workspace_path=workspace_path)
    if exact.is_file():
        return exact
    if not reference or not thread_id:
        raise HTTPException(404, "file not found")
    relative = reference.replace("\\", "/")
    if (
        relative.startswith("/")
        or re.match(r"^[a-z][a-z0-9+.-]*:", relative, re.I)
        or any(part == ".." for part in relative.split("/"))
    ):
        raise HTTPException(404, "file not found")
    parts = tuple(part for part in relative.split("/") if part and part != ".")
    if not parts or "\0" in relative:
        raise HTTPException(400, "invalid file reference")
    if tuple(part.casefold() for part in exact.parts[-len(parts) :]) != tuple(
        part.casefold() for part in parts
    ):
        raise HTTPException(400, "reference does not match requested path")
    roots = _scope_roots(ctx, thread_id=thread_id)
    matches: set[Path] = set()
    visited: set[Path] = set()
    entries = 0
    deadline = time.monotonic() + _MAX_SECONDS
    complete = True

    def on_walk_error(_error: OSError) -> None:
        nonlocal complete
        complete = False

    wanted = tuple(part.casefold() for part in parts) if os.name == "nt" else parts
    for root in roots:
        for directory, dirs, files in os.walk(root, followlinks=False, onerror=on_walk_error):
            current = Path(directory)
            dirs[:] = sorted(
                d for d in dirs if d not in _SKIP_DIRS and not (current / d).is_symlink()
            )
            entries += len(dirs) + len(files)
            if entries > _MAX_ENTRIES or time.monotonic() > deadline:
                complete = False
                break
            for filename in files:
                candidate = current / filename
                suffix = candidate.parts[-len(parts) :]
                if os.name == "nt":
                    suffix = tuple(part.casefold() for part in suffix)
                if suffix != wanted or candidate in visited:
                    continue
                visited.add(candidate)
                try:
                    resolved = _assert_in_scope(ctx, candidate, thread_id=thread_id)
                except HTTPException:
                    continue
                if resolved.is_file():
                    matches.add(resolved)
        if not complete:
            break
    candidates = sorted(str(match) for match in matches)
    if complete and len(candidates) == 1:
        return Path(candidates[0])
    if candidates or not complete:
        raise HTTPException(
            409,
            {
                "error": "ambiguous_file_reference" if complete else "file_search_incomplete",
                "candidates": candidates[:20],
            },
        )
    raise HTTPException(404, "file not found")
