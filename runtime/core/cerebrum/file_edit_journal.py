"""Turn-scoped file-edit journal: per-file before/after for replay, undo and
"what did this turn change".

Ported from the Kimi-desktop teardown
(``docs/audits/kimi-desktop-unpack-2026-09-22.md`` §3 P1-15).  Kimi keeps a
``file-edit-journal.json`` that records, per turn and per file, the content
before and after the change; this is the Echo half of that idea, with the
Windows path defect found in Kimi's journal designed out (see
:func:`normalize_journal_path`).

Where this sits next to what already existed
--------------------------------------------
* ``FileChangeItem`` (``runtime.protocol.items``) is the *wire* record of a
  change; the thread event log already persists one per write tool call.
* ``FileOpEvent`` (``runtime.memory.journal``) is the *tool-engine* ledger: for
  writes that went through a skill handler it already carries the previous
  content plus before/after hashes, and ``apply_file_rollback_ledger`` /
  ``rewind_to_checkpoint`` consume it.
* This module is the *turn* view: one merged entry per file the turn touched,
  carrying content rather than a diff, so a client can render "what changed
  this turn" and offer an undo without re-parsing anything.

Honesty rules -- these are the whole point of the module
-------------------------------------------------------
1. ``before`` is never guessed.  It is set when it is *known* (a file the turn
   created had no content) or when it can be *derived* from a complete unified
   diff applied backwards to the recorded after-state.  Otherwise it is
   ``None`` and ``reason`` says why.
2. A truncated diff can never yield a before-state.  That is refused outright
   rather than silently producing half a file.
3. Degenerate path fragments (``D``, ``D:``, a bare backslash) are dropped
   instead of being journalled.  The teardown found exactly those rows in
   Kimi's journal, and a journal that can hold a non-path cannot be replayed.
"""

from __future__ import annotations

import hashlib
import posixpath
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from typing import Any, Literal

from runtime.protocol.diff_parser import (
    DiffApplyConflict,
    DiffFormatError,
    reverse_unified_diff,
)

FileEditOp = Literal["create", "update", "delete"]

_FILE_EDIT_OPS: frozenset[str] = frozenset({"create", "update", "delete"})

# Bounds, held in step with the tool engine's own caps
# (``_FILE_ROLLBACK_CONTENT_LIMIT`` / ``_FILE_DIFF_OUTPUT_LIMIT``).  A journal
# entry that cannot be bounded cannot be persisted per turn.
MAX_ENTRIES = 500
MAX_CONTENT_BYTES = 100_000

_DRIVE_RE = re.compile(r"^[A-Za-z]:")
# A whole path that is only a drive letter, with or without its colon or a
# trailing separator.  ``D:`` is what a path split on ``:`` leaves behind and
# ``D`` is the same fragment mid-path; neither names a file.
_BARE_DRIVE_RE = re.compile(r"^[A-Za-z]:?$")
_QUOTES = "\"'"


# ── Path normalisation ───────────────────────────────────────────────


def normalize_journal_path(path: Any, *, root: Any = None) -> str:
    """Canonical journal path, or ``""`` when ``path`` is not a path at all.

    Backslashes become forward slashes and ``.`` / ``..`` are resolved
    lexically, so one file always produces one journal key on Windows, macOS
    and Linux.  Nothing here ever splits on a colon: the teardown's journal
    corruption came from a path string being taken apart on ``:``, and the
    guard against it is that this function only ever treats ``:`` as part of a
    drive prefix -- and refuses a path that is *only* that prefix.

    ``root`` optionally absolutises a relative path, which is how a caller
    turns the two spellings of the same file into one entry.
    """

    raw = str(path or "").strip().strip(_QUOTES).strip()
    if not raw:
        return ""
    unified = raw.replace("\\", "/")
    if unified.startswith("//"):
        # POSIX ``normpath`` keeps exactly two leading slashes and would fold a
        # longer run (``///share/x``) down to one; pin the UNC prefix first so
        # every spelling of the same share lands on one journal key.
        unified = "//" + unified.lstrip("/")

    bare = unified.rstrip("/")
    if not bare or _BARE_DRIVE_RE.match(bare):
        return ""

    candidate = posixpath.normpath(unified)
    while candidate.startswith("./"):
        candidate = candidate[2:]
    # ``normpath`` keeps a leading ``//`` (UNC); collapse any deeper run so
    # ``///share/x`` cannot masquerade as a different file from ``//share/x``.
    if candidate.startswith("//"):
        candidate = "//" + candidate.lstrip("/")

    trimmed = candidate.rstrip("/")
    if not trimmed or trimmed in {".", ".."} or _BARE_DRIVE_RE.match(trimmed):
        return ""

    if root is not None:
        root_path = normalize_journal_path(root)
        if root_path and not trimmed.startswith(("/", "//")) and not _DRIVE_RE.match(trimmed):
            trimmed = f"{root_path.rstrip('/')}/{trimmed}"
    return trimmed


def journal_path_key(path: str) -> str:
    """Dedupe key for a normalised journal path.

    Windows-shaped paths fold case, POSIX-shaped ones do not.  The decision is
    made from the *shape* rather than from ``os.name`` so that the same journal
    produces the same keys on every host: a journal written on Windows and read
    on Linux must not suddenly count one file twice.
    """

    if path.startswith("//") or _DRIVE_RE.match(path):
        return path.casefold()
    return path


def same_journal_path(left: Any, right: Any) -> bool:
    """True when two paths name the same journal entry."""

    left_norm = normalize_journal_path(left)
    right_norm = normalize_journal_path(right)
    if not left_norm or not right_norm:
        return False
    return journal_path_key(left_norm) == journal_path_key(right_norm)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _byte_len(text: str) -> int:
    return len(text.encode("utf-8"))


# ── Entries ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class FileEditEntry:
    """One file as this turn left it, plus what it looked like beforehand."""

    path: str
    op: FileEditOp
    before: str | None = None
    after: str | None = None
    # Where ``before`` came from: ``"recorded"`` (known without inference),
    # ``"derived"`` (reconstructed from a complete unified diff) or
    # ``"unknown"`` (not established -- ``reason`` says why).
    before_source: Literal["recorded", "derived", "unknown"] = "unknown"
    origin: str = "live"
    reason: str = ""
    touches: int = 1

    @property
    def before_sha256(self) -> str:
        return _sha256_text(self.before) if self.before is not None else ""

    @property
    def after_sha256(self) -> str:
        return _sha256_text(self.after) if self.after is not None else ""

    @property
    def reversible(self) -> bool:
        """True when the recorded content alone is enough to restore the file.

        A delete counts: the file is known to be gone, so restoring ``before``
        is the whole operation.  A create/update whose before-state is unknown
        is not reversible from this record, however complete its diff may be --
        that is the ``FileChangeItem`` revert path's job, not the journal's.
        """

        if self.before is None:
            return False
        return self.after is not None or self.op == "delete"

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "op": self.op,
            "before": self.before,
            "after": self.after,
            "beforeSha256": self.before_sha256,
            "afterSha256": self.after_sha256,
            "beforeSource": self.before_source,
            "origin": self.origin,
            "reason": self.reason,
            "touches": self.touches,
            "reversible": self.reversible,
        }

    def to_summary(self) -> dict[str, Any]:
        """Content-free projection for the turn frame (``FileEditSummary``).

        :meth:`to_dict` is the durable form and carries contents; this is the
        wire form.  The merged per-file shape plus the ``reversible`` verdict
        is what a client needs to render "what changed this turn" -- and a
        turn frame must not grow with the size of the files it touched.
        """

        return {
            "path": self.path,
            "op": self.op,
            "beforeSha256": self.before_sha256,
            "afterSha256": self.after_sha256,
            "beforeSource": self.before_source,
            "reversible": self.reversible,
            "reason": self.reason,
            "touches": self.touches,
        }

    @classmethod
    def from_dict(cls, payload: Any) -> FileEditEntry | None:
        if not isinstance(payload, Mapping):
            return None
        path = normalize_journal_path(payload.get("path"))
        op = str(payload.get("op") or "")
        if not path or op not in _FILE_EDIT_OPS:
            return None
        source = str(payload.get("beforeSource") or "unknown")
        if source not in {"recorded", "derived", "unknown"}:
            source = "unknown"
        before = payload.get("before")
        after = payload.get("after")
        try:
            touches = max(1, int(payload.get("touches") or 1))
        except (TypeError, ValueError):
            touches = 1
        return cls(
            path=path,
            op=op,  # type: ignore[arg-type]
            before=before if isinstance(before, str) else None,
            after=after if isinstance(after, str) else None,
            before_source=source,  # type: ignore[arg-type]
            origin=str(payload.get("origin") or "live"),
            reason=str(payload.get("reason") or ""),
            touches=touches,
        )


def make_entry(
    *,
    path: Any,
    op: str,
    after: str | None = None,
    diff: str | None = None,
    origin: str = "live",
    root: Any = None,
) -> FileEditEntry | None:
    """Build one entry, or ``None`` when the input cannot be journalled.

    ``diff`` (when supplied) is only ever used to *derive* ``before``; it is
    never stored here, because the persisted ``FileChangeItem`` for the same
    call already carries it.
    """

    if op not in _FILE_EDIT_OPS:
        return None
    normalized = normalize_journal_path(path, root=root)
    if not normalized:
        return None

    reason = ""
    if after is not None and _byte_len(after) > MAX_CONTENT_BYTES:
        after = None
        reason = "after_too_large"

    before: str | None = None
    before_source: Literal["recorded", "derived", "unknown"] = "unknown"

    if op == "create":
        # Known, not inferred: the file did not exist a moment ago.
        before = ""
        before_source = "recorded"
    elif op == "delete":
        if not reason:
            reason = "deleted_content_not_captured"
    elif after is None:
        if not reason:
            reason = "after_not_captured"
    elif not diff or not diff.strip():
        reason = "diff_not_captured"
    else:
        try:
            before = reverse_unified_diff(after, diff)
            before_source = "derived"
        except (DiffFormatError, DiffApplyConflict) as exc:
            before = None
            before_source = "unknown"
            reason = f"before_not_recoverable: {exc}"

    return FileEditEntry(
        path=normalized,
        op=op,  # type: ignore[arg-type]
        before=before,
        after=after,
        before_source=before_source,
        origin=origin,
        reason=reason,
    )


def _change_field(change: Any, name: str, default: Any = None) -> Any:
    value = getattr(change, name, None)
    if value is None and isinstance(change, Mapping):
        value = change.get(name, default)
    return default if value is None else value


def entries_from_file_change_item(
    item: Any,
    *,
    contents: Mapping[str, str | None] | None = None,
    origin: str = "live",
    root: Any = None,
) -> list[FileEditEntry]:
    """Build journal entries from a ``FileChangeItem`` (or its dict shape).

    ``contents`` maps a path to the file's current text so the entry can carry
    the after-state; callers read it from disk (see
    :func:`read_text_bounded`) and pass it in, which keeps this function free of
    I/O.  A missing key simply means "after not captured".
    """

    changes = getattr(item, "changes", None)
    if changes is None and isinstance(item, Mapping):
        changes = item.get("changes")
    if not isinstance(changes, list):
        return []

    out: list[FileEditEntry] = []
    for change in changes:
        path = _change_field(change, "path")
        op = str(_change_field(change, "op", "update") or "update")
        diff = _change_field(change, "diff")
        after: str | None = None
        if op != "delete" and contents is not None:
            normalized = normalize_journal_path(path, root=root)
            key = journal_path_key(normalized) if normalized else ""
            if key and key in contents:
                after = contents[key]
            elif normalized and normalized in contents:
                after = contents[normalized]
        entry = make_entry(
            path=path,
            op=op,
            after=after,
            diff=diff if isinstance(diff, str) else None,
            origin=origin,
            root=root,
        )
        if entry is not None:
            out.append(entry)
    return out


def read_text_bounded(path: Any, *, limit: int = MAX_CONTENT_BYTES) -> str | None:
    """Read a file's text for the journal, or ``None`` when that is not possible.

    Bounded and forgiving by design: a binary, oversized, missing or unreadable
    file is "after not captured", never an exception that would fail a turn.
    """

    import os

    raw = str(path or "")
    if not raw:
        return None
    try:
        if not os.path.isfile(raw):
            return None
        if os.path.getsize(raw) > limit:
            return None
        with open(raw, "rb") as handle:
            blob = handle.read(limit + 1)
        if len(blob) > limit:
            return None
        return blob.decode("utf-8")
    except (OSError, ValueError, UnicodeDecodeError):
        return None


# ── The per-turn journal ─────────────────────────────────────────────


class FileEditJournal:
    """Per-turn accumulator: one merged entry per file, in first-touch order.

    Re-touching a path does not add a second entry.  The first observation owns
    ``before`` (what the file *was* this turn); ``op`` and ``after`` describe
    where the turn left it, which is the other half of the pair an undo needs.
    The merge only ever reports a state that really held at the end of the
    turn:

    * create then delete collapses to ``delete`` with no before-state -- the
      turn left nothing behind to restore;
    * a delete after a rewrite stays a ``delete`` and drops the stale
      after-state, because the contents are gone;
    * a delete followed by a write is an ``update`` with an unknown
      before-state, never a ``create`` -- the file did exist before.
    """

    def __init__(self, *, cap: int = MAX_ENTRIES) -> None:
        self._entries: dict[str, FileEditEntry] = {}
        self._order: list[str] = []
        self._cap = max(1, int(cap))
        self.dropped = 0

    def record(self, entry: FileEditEntry | None) -> None:
        if entry is None:
            return
        key = journal_path_key(entry.path)
        existing = self._entries.get(key)
        if existing is None:
            if len(self._order) >= self._cap:
                self.dropped += 1
                return
            self._order.append(key)
            self._entries[key] = entry
            return

        op = existing.op
        before = existing.before
        before_source = existing.before_source
        reason = entry.reason or existing.reason
        after = entry.after if entry.after is not None else existing.after
        if existing.op == "create" and entry.op == "delete":
            # Created and removed inside one turn: net effect is "gone", and
            # there is nothing useful to restore.
            op = "delete"
            before = None
            before_source = "unknown"
            after = None
            reason = "created_then_deleted"
        elif entry.op == "delete":
            # The turn ended by removing a path it had rewritten.  Keeping the
            # previous touch's after-state would publish contents that are no
            # longer there; the net effect is the delete, and only the
            # before-state (when it is known) is still what an undo wants.
            op = "delete"
            after = None
        elif existing.op == "delete":
            # Deleted and written again inside one turn: the path exists now,
            # but it is the *previous* contents that were destroyed, so this is
            # an update with an unknown before-state -- never a create.
            op = "update"
        self._entries[key] = replace(
            existing,
            op=op,
            before=before,
            after=after,
            before_source=before_source,
            reason=reason,
            touches=existing.touches + 1,
        )

    def record_all(self, entries: Iterable[FileEditEntry]) -> None:
        for entry in entries:
            self.record(entry)

    @property
    def entries(self) -> tuple[FileEditEntry, ...]:
        return tuple(self._entries[key] for key in self._order)

    @property
    def paths(self) -> tuple[str, ...]:
        return tuple(entry.path for entry in self.entries)

    def __len__(self) -> int:
        return len(self._order)

    def __bool__(self) -> bool:
        return bool(self._order)

    def summary(self) -> dict[str, Any]:
        entries = self.entries
        return {
            "files": len(entries),
            "created": sum(1 for e in entries if e.op == "create"),
            "updated": sum(1 for e in entries if e.op == "update"),
            "deleted": sum(1 for e in entries if e.op == "delete"),
            "reversible": sum(1 for e in entries if e.reversible),
            "before_unknown": sum(1 for e in entries if e.before is None),
            "dropped": self.dropped,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": 1,
            "entries": [entry.to_dict() for entry in self.entries],
            "summary": self.summary(),
        }

    def to_summaries(self) -> list[dict[str, Any]]:
        """Wire projection of every entry, in first-touch order."""

        return [entry.to_summary() for entry in self.entries]

    @classmethod
    def from_dict(cls, payload: Any) -> FileEditJournal:
        journal = cls()
        if not isinstance(payload, Mapping):
            return journal
        raw_entries = payload.get("entries")
        if isinstance(raw_entries, list):
            journal.record_all(
                entry
                for entry in (FileEditEntry.from_dict(item) for item in raw_entries)
                if entry is not None
            )
        return journal

    @classmethod
    def from_turn(
        cls,
        turn: Any,
        *,
        contents: Mapping[str, str | None] | None = None,
        root: Any = None,
    ) -> FileEditJournal:
        """Rebuild the journal for a *persisted* turn.

        Reads the ``FileChangeItem`` entries the turn already stores, so replay
        and "what changed" work for a turn that has already been written back to
        the thread log -- no separate journal file to keep in step.
        """

        journal = cls()
        # A ``dict`` exposes ``.items`` as a bound method, so ``getattr`` alone
        # would hand back a method rather than the list; check the mapping shape
        # first.
        items = turn.get("items") if isinstance(turn, Mapping) else getattr(turn, "items", None)
        if not isinstance(items, (list, tuple)):
            return journal
        for item in items:
            item_type = _change_field(item, "type", "")
            if str(item_type) != "fileChange":
                continue
            journal.record_all(
                entries_from_file_change_item(item, contents=contents, origin="replay", root=root)
            )
        return journal


__all__ = [
    "MAX_CONTENT_BYTES",
    "MAX_ENTRIES",
    "FileEditEntry",
    "FileEditJournal",
    "entries_from_file_change_item",
    "journal_path_key",
    "make_entry",
    "normalize_journal_path",
    "read_text_bounded",
    "same_journal_path",
]
