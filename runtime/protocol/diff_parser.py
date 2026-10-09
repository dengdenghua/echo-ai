"""Unified-diff → structured :class:`FileHunk` decomposition.

The ``runtime.tools`` / skills layer produces edits as unified diff
strings (``--- a/path\\n+++ b/path\\n@@ -a,b +c,d @@\\n ...``). The
realtime protocol wants per-hunk items so the UI can render inline
diff with per-hunk accept/reject. This module is the adapter.

Kept intentionally small — no diff-matching, no rename detection,
no renumbering on partial accepts. That belongs downstream in the
apply step, not in the parser.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from runtime.protocol.items import FileChange, FileHunk

_HUNK_RE = re.compile(
    r"^@@\s+-(?P<old_start>\d+)(?:,(?P<old_lines>\d+))?"
    r"\s+\+(?P<new_start>\d+)(?:,(?P<new_lines>\d+))?\s+@@",
)


@dataclass(frozen=True)
class _HunkDraft:
    old_start: int
    old_lines: int
    new_start: int
    new_lines: int
    body: str


def _infer_op(
    has_old: bool,
    has_new: bool,
    old_start: int,
) -> Literal["create", "update", "delete"]:
    if not has_old or old_start == 0:
        return "create"
    if not has_new:
        return "delete"
    return "update"


def parse_unified_diff(diff: str) -> list[FileChange]:
    """Decompose a unified-diff string into one ``FileChange`` per file.

    Accepts multi-file diffs (sequential ``--- / +++`` blocks). A single
    ``+++`` without ``---`` is tolerated for "new file" creation diffs
    that some tools emit in that shorthand.
    """
    if not diff.strip():
        return []

    lines = diff.splitlines(keepends=True)
    i = 0
    out: list[FileChange] = []
    current_path: str | None = None
    current_op: Literal["create", "update", "delete"] | None = None
    current_hunks: list[_HunkDraft] = []
    current_body: list[str] = []
    current_header: _HunkDraft | None = None

    def flush_file() -> None:
        nonlocal current_path, current_op, current_hunks, current_header, current_body
        if current_header is not None:
            current_hunks.append(
                _HunkDraft(
                    old_start=current_header.old_start,
                    old_lines=current_header.old_lines,
                    new_start=current_header.new_start,
                    new_lines=current_header.new_lines,
                    body="".join(current_body),
                )
            )
            current_header = None
            current_body = []
        if current_path is None or current_op is None:
            current_hunks = []
            return
        out.append(
            FileChange(
                path=current_path,
                op=current_op,
                diff="".join(_rebuild_diff(current_path, current_op, current_hunks)),
                hunks=[
                    FileHunk(
                        old_start=h.old_start,
                        old_lines=h.old_lines,
                        new_start=h.new_start,
                        new_lines=h.new_lines,
                        body=h.body,
                    )
                    for h in current_hunks
                ],
            )
        )
        current_path = None
        current_op = None
        current_hunks = []

    pending_old_path: str | None = None
    pending_new_path: str | None = None

    while i < len(lines):
        line = lines[i]
        if line.startswith("--- "):
            # New file entry — flush previous.
            flush_file()
            pending_old_path = _strip_diff_prefix(line[4:].strip())
            pending_new_path = None
            i += 1
            continue
        if line.startswith("+++ "):
            pending_new_path = _strip_diff_prefix(line[4:].strip())
            current_path = pending_new_path or pending_old_path
            current_op = _infer_op(
                has_old=bool(pending_old_path) and pending_old_path != "/dev/null",
                has_new=bool(pending_new_path) and pending_new_path != "/dev/null",
                old_start=1,
            )
            if pending_new_path == "/dev/null":
                current_path = pending_old_path
                current_op = "delete"
            i += 1
            continue
        m = _HUNK_RE.match(line)
        if m:
            if current_header is not None:
                current_hunks.append(
                    _HunkDraft(
                        old_start=current_header.old_start,
                        old_lines=current_header.old_lines,
                        new_start=current_header.new_start,
                        new_lines=current_header.new_lines,
                        body="".join(current_body),
                    )
                )
                current_body = []
            current_header = _HunkDraft(
                old_start=int(m.group("old_start")),
                old_lines=int(m.group("old_lines") or 1),
                new_start=int(m.group("new_start")),
                new_lines=int(m.group("new_lines") or 1),
                body="",
            )
            # Fix create op: ``--- /dev/null`` path is held in
            # pending_old_path; we already inferred the op above, but
            # an old_start == 0 hunk is a strong create signal.
            if current_header.old_start == 0 and current_op != "delete":
                current_op = "create"
            i += 1
            continue
        if current_header is not None:  # noqa: SIM102
            # Hunk body: lines starting with ' ', '+', '-', or '\\'
            # (the no-newline marker). Anything else aborts the body.
            if line and line[0] in (" ", "+", "-", "\\"):
                current_body.append(line)
                i += 1
                continue
            # Body ended implicitly; fall through without consuming.
        i += 1

    flush_file()
    return out


def _strip_diff_prefix(path: str) -> str:
    """Remove the conventional ``a/`` or ``b/`` prefix from a diff
    header path. Some tools emit bare paths; handle both."""
    if path.startswith(("a/", "b/")):
        return path[2:]
    return path


def _rebuild_diff(
    path: str,
    op: Literal["create", "update", "delete"],
    hunks: list[_HunkDraft],
) -> list[str]:
    """Reassemble a unified diff for round-trip ``revert-diff`` use.

    Uses the same ``a/`` / ``b/`` convention the apply step expects.
    ``delete`` → ``+++ /dev/null``; ``create`` → ``--- /dev/null``.
    """
    old_path = "/dev/null" if op == "create" else f"a/{path}"
    new_path = "/dev/null" if op == "delete" else f"b/{path}"
    lines: list[str] = [f"--- {old_path}\n", f"+++ {new_path}\n"]
    for h in hunks:
        lines.append(f"@@ -{h.old_start},{h.old_lines} +{h.new_start},{h.new_lines} @@\n")
        if h.body and not h.body.endswith("\n"):
            lines.append(h.body + "\n")
        else:
            lines.append(h.body)
    return lines


# ── Hunk-level parse + reverse apply ─────────────────────────────────
#
# Originally extracted from ``runtime/sensing/gateway/_fs_router_diff.py``. The
# file-edit journal (``runtime.core.cerebrum.file_edit_journal``) needs to turn
# a complete unified diff back into the file's *before* content, and that
# derivation must not drag a gateway module into core -- so the shared
# algorithm lives here, in the layer both sides already import.  The gateway
# keeps its historical private names as aliases, so its own callers and the
# ``fs_router`` re-export list are untouched.

_REVERSE_HUNK_RE = re.compile(
    r"^@@ -(?P<old_start>\d+)(?:,(?P<old_count>\d+))? "
    r"\+(?P<new_start>\d+)(?:,(?P<new_count>\d+))? @@",
)


class DiffFormatError(ValueError):
    """The text is not a complete, parseable unified diff."""


class DiffApplyConflict(RuntimeError):
    """The diff no longer matches the file it was recorded against."""


@dataclass
class ParsedDiffLine:
    marker: str
    content: str
    no_newline: bool = False


@dataclass
class ParsedDiffHunk:
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: list[ParsedDiffLine]


def _validate_reverse_hunk(hunk: ParsedDiffHunk) -> None:
    for marker, count in (("+", hunk.old_count), ("-", hunk.new_count)):
        side = [line for line in hunk.lines if line.marker != marker]
        if len(side) != count:
            raise DiffFormatError("hunk line counts do not match its header")
        if any(line.no_newline for line in side[:-1]):
            raise DiffFormatError("no-newline marker must end its side of the hunk")


def parse_unified_hunks(diff_text: str) -> list[ParsedDiffHunk]:
    """Hunk-level view of one file's unified diff.

    :func:`parse_unified_diff` decomposes a multi-file diff into per-file
    :class:`FileChange` records for the UI.  This one keeps the per-line
    markers instead, which is what an *un*apply needs.
    """
    if not diff_text.strip():
        raise DiffFormatError("diff is required")
    if "\n... (truncated " in diff_text:
        raise DiffFormatError("truncated diffs cannot be reverted safely")

    hunks: list[ParsedDiffHunk] = []
    current: ParsedDiffHunk | None = None
    lines = diff_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    for raw_line in lines:
        if raw_line.startswith("@@"):
            if current is not None:
                _validate_reverse_hunk(current)
                hunks.append(current)
            match = _REVERSE_HUNK_RE.match(raw_line)
            if not match:
                raise DiffFormatError(f"invalid hunk header: {raw_line}")
            current = ParsedDiffHunk(
                old_start=int(match.group("old_start")),
                old_count=int(match.group("old_count") or "1"),
                new_start=int(match.group("new_start")),
                new_count=int(match.group("new_count") or "1"),
                lines=[],
            )
            continue

        if current is None:
            continue
        if raw_line.startswith("\\ No newline at end of file"):
            if not current.lines or current.lines[-1].no_newline:
                raise DiffFormatError("misplaced no-newline marker")
            current.lines[-1].no_newline = True
            continue
        if raw_line == "":
            continue

        marker = raw_line[:1]
        if marker not in {" ", "+", "-"}:
            raise DiffFormatError(f"invalid diff line: {raw_line}")
        current.lines.append(ParsedDiffLine(marker=marker, content=raw_line[1:]))

    if current is not None:
        _validate_reverse_hunk(current)
        hunks.append(current)
    if not hunks:
        raise DiffFormatError("diff contains no hunks")
    return hunks


def _preferred_new_index(hunk: ParsedDiffHunk) -> int:
    if hunk.new_count == 0:
        return max(hunk.new_start, 0)
    return max(hunk.new_start - 1, 0)


def _find_line_segment(
    lines: list[str],
    segment: list[str],
    preferred_index: int,
) -> int:
    if not segment:
        if 0 <= preferred_index <= len(lines):
            return preferred_index
        raise DiffApplyConflict("empty hunk location is outside the current file")

    end = len(lines) - len(segment)
    if (
        0 <= preferred_index <= end
        and lines[preferred_index : preferred_index + len(segment)] == segment
    ):
        return preferred_index

    matches: list[int] = []
    for index in range(max(end + 1, 0)):
        if lines[index : index + len(segment)] == segment:
            matches.append(index)
            if len(matches) > 1:
                break
    if len(matches) == 1:
        return matches[0]
    if matches:
        raise DiffApplyConflict("hunk matches multiple locations in the current file")
    raise DiffApplyConflict("hunk no longer matches the current file")


def reverse_unified_diff(current_text: str, diff_text: str) -> str:
    """Undo ``diff_text`` against ``current_text`` and return the older text.

    Raises :class:`DiffFormatError` for an incomplete / unparseable diff and
    :class:`DiffApplyConflict` when the diff no longer matches the current
    contents.  Callers that want "best effort" must catch both: a half-applied
    reverse is worse than no answer.
    """
    hunks = parse_unified_hunks(diff_text)
    normalized = current_text.replace("\r\n", "\n").replace("\r", "\n")
    parts = normalized.split("\n")
    lines = [part + "\n" for part in parts[:-1]]
    if parts[-1]:
        lines.append(parts[-1])

    for hunk in reversed(hunks):
        new_segment = [
            line.content + ("" if line.no_newline else "\n")
            for line in hunk.lines
            if line.marker != "-"
        ]
        old_segment = [
            line.content + ("" if line.no_newline else "\n")
            for line in hunk.lines
            if line.marker != "+"
        ]
        index = _find_line_segment(
            lines,
            new_segment,
            _preferred_new_index(hunk),
        )
        lines[index : index + len(new_segment)] = old_segment

    if any(not line.endswith("\n") for line in lines[:-1]):
        raise DiffApplyConflict("no-newline marker does not match the end of the file")
    return "".join(lines)


__all__ = [
    "DiffApplyConflict",
    "DiffFormatError",
    "ParsedDiffHunk",
    "ParsedDiffLine",
    "parse_unified_diff",
    "parse_unified_hunks",
    "reverse_unified_diff",
]
