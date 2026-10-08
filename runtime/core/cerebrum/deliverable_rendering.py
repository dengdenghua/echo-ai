"""Deterministic rendering for the ``## 交付文件`` section.

The sibling module :mod:`runtime.core.cerebrum.react_prompt_contracts` states
the contract (heading, label rules, citation split) and validates a section the
model wrote.  This module is the other half of the ownership split: the runtime
*produces* the section, so the format stops depending on the model remembering
it.  The model keeps writing prose; link syntax, label shape and ordering come
from here.

Ported from the Kimi-desktop teardown
(``docs/audits/kimi-desktop-unpack-2026-09-22.md`` §3 P1-9), whose general rule
is that formatting, citation and indexing belong to deterministic code.

Two entry points matter:

``render_deliverables_section`` -- build the canonical section from the files
this turn really wrote (typically the ``file_changes`` the write primitives
report).  Byte-stable for a given input, so two runs cannot disagree.

``finalize_deliverables`` -- normalise a finished answer: drop a hand-written
copy of the section and append the canonical one.  Idempotent by construction,
which is what makes it safe to run on every turn instead of "only when the
model forgot".
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from runtime.core.cerebrum.react_prompt_contracts import (
    DELIVERABLE_HEADING,
    deliverable_label_is_canonical,
)

# A turn that produced more than this is summarised rather than enumerated: the
# section is a pointer list, not a directory listing, and an unbounded one would
# swamp the answer it belongs to.
DEFAULT_LIMIT = 20

_OMITTED_TEMPLATE = "- …另有 {count} 个文件未列出"

# Only list items and blank lines may follow the heading for a block to count as
# the deliverable section.  Anything else means the model is *talking about* the
# section (quoting the contract, explaining a rule) and must not be rewritten.
_ALLOWED_TAIL_RE = re.compile(r"^[ \t]*(?:[-*][ \t].*)?$")


def deliverable_label(path: str | Path) -> str:
    """Label for ``path``: bare file name, no directory, no extension."""

    name = Path(str(path)).name
    if not name:
        return ""
    # ``.gitignore``-style names keep the dot: stripping it would produce a
    # label that is not the file's name at all.
    if name.startswith(".") and name.count(".") == 1:
        return name
    # Strip every suffix, not just the last one, so ``a.tar.gz`` does not leave
    # a dotted label behind.
    return name.split(".", 1)[0] or name


def deliverable_target(path: str | Path) -> str:
    """Absolute, forward-slash target path for a markdown link."""

    candidate = Path(str(path)).expanduser()
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    return candidate.as_posix()


def deliverable_line(path: str | Path) -> str:
    """One canonical entry: ``- [label](absolute/path)``."""

    target = deliverable_target(path)
    label = deliverable_label(target)
    if not label or not deliverable_label_is_canonical(label):
        # A dotfile has no extension to strip, so keep its real name rather
        # than emitting a label the user cannot match to the file.
        label = Path(target).name or target
    return f"- [{label}]({target})"


def _dedupe_key(path: str) -> str:
    key = path.replace("\\", "/")
    # Windows paths are case-insensitive; POSIX ones are not.
    return key.lower() if len(key) > 1 and key[1] == ":" else key


def unique_paths(paths: Iterable[str | Path]) -> list[str]:
    """Deduplicate paths, keeping first-touch order and dropping blanks."""

    seen: set[str] = set()
    ordered: list[str] = []
    for raw in paths:
        text = str(raw or "").strip()
        if not text:
            continue
        key = _dedupe_key(text)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(text)
    return ordered


def render_deliverables_section(
    paths: Iterable[str | Path],
    *,
    limit: int = DEFAULT_LIMIT,
) -> str:
    """Canonical ``## 交付文件`` section, or ``""`` when nothing was produced."""

    ordered = unique_paths(paths)
    if not ordered:
        return ""
    shown = ordered[: max(0, int(limit))]
    lines = [DELIVERABLE_HEADING, ""]
    lines.extend(deliverable_line(path) for path in shown)
    rest = len(ordered) - len(shown)
    if rest > 0:
        lines.append(_OMITTED_TEMPLATE.format(count=rest))
    return "\n".join(lines)


def strip_deliverables_section(text: str) -> str:
    """Remove a trailing, hand-written deliverable section.

    Conservative on purpose: the heading is only cut when everything after it is
    list items and blank lines.  A model that merely quotes the heading
    mid-answer keeps its text untouched.
    """

    source = str(text or "")
    start = source.rfind(DELIVERABLE_HEADING)
    if start < 0:
        return source
    tail = source[start + len(DELIVERABLE_HEADING) :]
    if any(not _ALLOWED_TAIL_RE.match(line) for line in tail.splitlines()):
        return source
    return source[:start].rstrip()


def finalize_deliverables(
    text: str,
    paths: Iterable[str | Path],
    *,
    limit: int = DEFAULT_LIMIT,
) -> str:
    """Answer text carrying exactly one canonical deliverable section.

    Idempotent: ``finalize_deliverables(finalize_deliverables(t, p), p)`` equals
    ``finalize_deliverables(t, p)`` for the same ``p``.
    """

    body = strip_deliverables_section(text).rstrip()
    section = render_deliverables_section(paths, limit=limit)
    if not section:
        return body
    if not body:
        return section
    return f"{body}\n\n{section}"


__all__ = [
    "DEFAULT_LIMIT",
    "deliverable_label",
    "deliverable_line",
    "deliverable_target",
    "finalize_deliverables",
    "render_deliverables_section",
    "strip_deliverables_section",
    "unique_paths",
]
