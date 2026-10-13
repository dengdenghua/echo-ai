"""Local file inventory; presence does not imply runtime execution permission."""

from __future__ import annotations

import hashlib
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import yaml

from runtime.platform.process.paths import app_paths, resources_root

SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", "dist", "build", "release"}


def skill_roots() -> list[tuple[Path, str]]:
    repo = resources_root()
    return [
        (app_paths().data_dir / "skills", "local"),
        (repo / "runtime", "builtin"),
        (repo / "skills", "local"),
        (repo / "extensions", "builtin"),
        (repo / "agents", "local"),
        (repo / ".echo", "imported"),
        (Path.home() / ".echo" / "skills", "local"),
        (Path.home() / ".echo" / "imported", "imported"),
        (Path.home() / ".echo" / "plugins", "imported"),
    ]


# SKILL.md parses keyed by resolved path and validated by (mtime_ns, size). The inventory backs
# every HUB / automation page load and walks hundreds of skills; re-reading and YAML-parsing every
# file each time took seconds. An edited file changes its stat and is parsed again.
_PARSED: dict[str, tuple[int, int, dict[str, Any], str]] = {}


def _skill_files(root: Path) -> Iterator[os.DirEntry[str]]:
    """Yield SKILL.md entries depth-first in sorted order, the order ``os.walk`` gave before.

    Symlinked files and directories are skipped, as are ``SKIP_DIRS``. ``DirEntry`` carries the
    type and stat from the directory listing, so no extra syscall per directory.
    """
    stack = [str(root)]
    while stack:
        directory = stack.pop()
        try:
            with os.scandir(directory) as listing:
                entries = list(listing)
        except OSError:
            continue
        subdirs: list[str] = []
        skill: os.DirEntry[str] | None = None
        for entry in entries:
            if entry.name == "SKILL.md":
                if entry.is_file(follow_symlinks=False):
                    skill = entry
            elif entry.name not in SKIP_DIRS and entry.is_dir(follow_symlinks=False):
                subdirs.append(entry.path)
        if skill is not None:
            yield skill
        stack.extend(sorted(subdirs, reverse=True))


def _parse_skill(entry: os.DirEntry[str], resolved: str) -> tuple[dict[str, Any], str] | None:
    """Front matter and sha256 of one SKILL.md, from the cache while its stat is unchanged."""
    try:
        stat = entry.stat(follow_symlinks=False)
    except OSError:
        return None
    cached = _PARSED.get(resolved)
    if cached is not None and cached[0] == stat.st_mtime_ns and cached[1] == stat.st_size:
        return cached[2], cached[3]
    try:
        content = Path(resolved).read_bytes()
    except OSError:
        return None
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("gb18030", errors="replace")
    fm: dict[str, Any] = {}
    if text.startswith("---\n") or text.startswith("---\r\n"):
        try:
            parsed = yaml.safe_load(text.split("---", 2)[1])
            if isinstance(parsed, dict):
                fm = parsed
        except (
            yaml.YAMLError
        ):  # intentional: Keep filename-derived inventory metadata for malformed YAML.
            pass
    sha = hashlib.sha256(content).hexdigest()
    _PARSED[resolved] = (stat.st_mtime_ns, stat.st_size, fm, sha)
    return fm, sha


def scan_local_skills(roots: list[tuple[Path, str]] | None = None) -> list[dict[str, Any]]:
    by_name: dict[str, dict[str, Any]] = {}
    visited: set[str] = set()
    for root, source in roots if roots is not None else skill_roots():
        if not root.is_dir():
            continue
        for entry in _skill_files(root):
            resolved = os.path.realpath(entry.path)
            if resolved in visited:
                continue
            visited.add(resolved)
            parsed = _parse_skill(entry, resolved)
            if parsed is None:
                continue
            fm, sha = parsed
            md = Path(resolved)
            name = str(fm.get("name") or Path(entry.path).parent.name).strip()
            metadata = fm.get("metadata") if isinstance(fm.get("metadata"), dict) else {}
            author = fm.get("author") or metadata.get("author")
            if isinstance(author, dict):
                author = author.get("name")
            author = author.strip() if isinstance(author, str) else ""
            key = name.casefold()
            variant = {"path": str(md.parent), "sha256": sha}
            if key in by_name:
                by_name[key]["variants"].append(variant)
                continue
            by_name[key] = {
                "id": name,
                "name": name,
                "kind": "skill",
                "source": source,
                "description": str(fm.get("description") or ""),
                "author": author,
                "version": str(fm.get("version") or "0.1.0"),
                "variants": [variant],
            }
    return [by_name[key] for key in sorted(by_name)]


def public_skill_inventory(rows: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """The inventory without file variants; pass ``rows`` to reuse a scan already made."""
    return [
        {key: value for key, value in item.items() if key != "variants"}
        for item in (scan_local_skills() if rows is None else rows)
        if not item["name"].startswith(("android.", "ios."))
    ]
