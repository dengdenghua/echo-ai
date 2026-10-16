"""Thread store journal: index paths, per-thread routing and durable JSONL appends."""

from __future__ import annotations

import contextlib
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ._store_records import (
    _STATE_FROM_THREAD_KEY,
    _encoded_state_record,
    _safe_path_segment,
    _utc_now_iso,
)
from .session_index import entry_from_thread

# Same logger name as before the split, so log routing is unchanged.
logger = logging.getLogger("runtime.memory.threads.store")


class ThreadJournalMixin:
    """Where a thread's JSONL lives and how records are appended to it."""

    # ─── index helpers ───────────────────────────────────────

    def _resolve_index_path(self) -> Path | None:
        if self._per_agent_base is not None:
            return self._per_agent_base / "data" / "sessions" / "session_index.jsonl"
        if self._path is not None:
            return self._path.with_name("session_index.jsonl")
        return None

    def _resolve_search_path(self) -> Path | None:
        """Resolve the path for the Echo FTS5 search database."""
        if self._per_agent_base is not None:
            return self._per_agent_base / "data" / "sessions" / "search.db"
        if self._path is not None:
            return self._path.with_suffix(".search.db")
        return None

    def _resolve_feedback_base(self) -> Path | None:
        """Resolve the base path for Echo feedback storage."""
        if self._per_agent_base is not None:
            return self._per_agent_base / "data" / "sessions"
        if self._path is not None:
            return self._path.parent
        return None

    def _index_file_for(self, target: Path) -> str:
        """Return the per-thread file path **as recorded in the
        index**, repo-relative when in per-agent mode so the index
        stays portable across moves of the project root.
        """
        if self._per_agent_base is None:
            return str(target)
        try:
            return str(target.resolve().relative_to(self._per_agent_base.resolve())).replace(
                "\\", "/"
            )
        except ValueError:
            return str(target)

    def _reindex_all_locked(self) -> None:
        assert self._index is not None
        for _thread_id, thread in self._threads.items():
            target = (
                self._per_thread_path(thread) if self._per_agent_base is not None else self._path
            )
            if target is None:
                continue
            entry = entry_from_thread(
                thread,
                file_path=self._index_file_for(target),
            )
            if entry is not None:
                self._index.upsert(entry)

    # ─── path routing ────────────────────────────────────────

    def _agent_id_for(self, thread: dict[str, Any]) -> str | None:
        """Extract a stable agent_id from a thread's metadata (if any).

        Metadata keys we try, in order: ``agent`` · ``agent_name`` ·
        ``agent_id`` · ``assistant_id``. We filter out the ``lead_agent`` placeholder
        (used by the OpenAI-compat gateway when no persona is bound).
        """
        meta = thread.get("metadata") or {}
        for key in ("agent", "agent_name", "agent_id", "assistant_id"):
            value = meta.get(key)
            if isinstance(value, str) and value and value != "lead_agent":
                return value
        return None

    def _team_id_for(self, thread: dict[str, Any]) -> str | None:
        meta = thread.get("metadata") or {}
        value = meta.get("team_id")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    def _team_path_for(self, thread: dict[str, Any]) -> Path | None:
        if self._per_agent_base is None:
            return None
        thread_id = thread.get("thread_id")
        team_id = self._team_id_for(thread)
        if not isinstance(thread_id, str) or not thread_id or team_id is None:
            return None
        sess_root = (
            self._per_agent_base / "teams" / _safe_path_segment(team_id, "team") / "sessions"
        )
        return self._resolve_thread_file(sess_root, thread_id)

    def _agent_path_for(self, thread: dict[str, Any]) -> Path | None:
        if self._per_agent_base is None:
            return None
        thread_id = thread.get("thread_id")
        if not isinstance(thread_id, str) or not thread_id:
            return None
        agent_id = self._agent_id_for(thread)
        if agent_id is None:
            return None
        sess_root = (
            self._per_agent_base / "agents" / _safe_path_segment(agent_id, "agent") / "sessions"
        )
        return self._resolve_thread_file(sess_root, thread_id)

    def _misc_path_for(self, thread_id: str) -> Path | None:
        if self._per_agent_base is None:
            return None
        sess_root = self._per_agent_base / "data" / "sessions" / "misc"
        return self._resolve_thread_file(sess_root, thread_id)

    def _resolve_thread_file(self, sess_root: Path, thread_id: str) -> Path:
        """Pick the on-disk path for a thread's jsonl.

        Read order: any existing file (flat OR dated) wins so an
        upgrade from flat → dated layout doesn't orphan history.
        Write order: dated when ``dated_layout`` is on, flat
        otherwise.
        """
        flat = sess_root / f"{thread_id}.jsonl"
        if flat.exists():
            return flat
        if self._dated_layout:
            # Look for any existing dated file (created in a prior
            # month) before defaulting to "now".
            if sess_root.exists():
                hits = list(sess_root.rglob(f"{thread_id}.jsonl"))
                if hits:
                    # A thread touched across months can have several dated
                    # files (/YYYY/MM/<id>.jsonl). Pick the LATEST: the path is
                    # zero-padded so max() is chronological. rglob() order is
                    # filesystem-arbitrary, so the old hits[0] could return a
                    # stale month for both reads and appends.
                    return max(hits)
            now = datetime.now(UTC)
            return sess_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{thread_id}.jsonl"
        return flat

    def _per_thread_path(self, thread: dict[str, Any]) -> Path | None:
        """Compute the on-disk jsonl for this thread in per-agent mode.

        Returns None when this store isn't running in per-agent mode
        (caller should fall back to self._path instead).
        """
        if self._per_agent_base is None:
            return None
        thread_id = thread.get("thread_id")
        if not isinstance(thread_id, str) or not thread_id:
            return None
        team_path = self._team_path_for(thread)
        if team_path is not None:
            return team_path
        agent_path = self._agent_path_for(thread)
        if agent_path is not None:
            return agent_path
        # No agent bound yet — stash in misc. Future writes keep landing
        # here unless we add rename-on-agent-bind (we don't, to keep
        # file-path stability).
        return self._misc_path_for(thread_id)

    def _append_upsert(
        self,
        thread: dict[str, Any],
        state: dict[str, Any],
        *,
        revision: int | None = None,
    ) -> Path | None:
        record = {
            "op": "upsert",
            "thread_id": thread["thread_id"],
            "thread": thread,
            "state": _encoded_state_record(state),
            _STATE_FROM_THREAD_KEY: True,
        }
        if revision is not None:
            record["revision"] = revision
            record["operation_at"] = _utc_now_iso()
        self._cleanup_stale_paths_if_promoted(thread)
        target = self._append_record(thread, record)
        if self._index is not None and target is not None:
            entry = entry_from_thread(
                thread,
                file_path=self._index_file_for(target),
            )
            if entry is not None:
                self._index.upsert(entry)

        # Update the Echo Native session-search index.
        if self._search is not None:
            self._update_search_index(thread)
        return target

    def _cleanup_stale_paths_if_promoted(self, thread: dict[str, Any]) -> None:
        """If a thread just gained an agent tag and is about to be
        written under ``agents/<agent_id>/sessions/...``, remove any
        earlier stub file that was written to ``data/sessions/misc/``.

        Rationale: the very first ``ensure_thread()`` runs before any
        turn knows which agent will handle the thread, so it routes
        to misc. After the first turn's ``update_state()`` assigns an
        ``agent`` in metadata, later writes land under the per-agent
        path — leaving a lingering misc file for the same thread id
        that never receives more writes. Delete it so each thread has
        exactly one on-disk home.
        """
        if self._per_agent_base is None:
            return
        thread_id = thread.get("thread_id")
        if not isinstance(thread_id, str) or not thread_id:
            return
        target = self._per_thread_path(thread)
        candidates = [
            self._misc_path_for(thread_id),
            self._agent_path_for(thread),
        ]
        for candidate in candidates:
            if candidate is None or candidate == target or not candidate.exists():
                continue
            with contextlib.suppress(OSError):
                candidate.unlink()

    def _append_delete(
        self,
        thread_id: str,
        thread: dict[str, Any] | None = None,
        *,
        revision: int | None = None,
    ) -> Path | None:
        stub = thread or {"thread_id": thread_id, "metadata": {}}
        record: dict[str, Any] = {"op": "delete", "thread_id": thread_id}
        if revision is not None:
            record["revision"] = revision
            record["operation_at"] = _utc_now_iso()
        target = self._append_record(stub, record)
        if self._index is not None:
            self._index.delete(thread_id)
        if self._search is not None:
            self._search.delete_thread(thread_id)
        return target

    def _append_record(self, thread: dict[str, Any], record: dict[str, Any]) -> Path | None:
        target: Path | None
        target = self._per_thread_path(thread) if self._per_agent_base is not None else self._path
        if target is None:
            return None
        target.parent.mkdir(parents=True, exist_ok=True)
        # The ``session_meta`` header goes on the first line of a
        # brand-new file. The "is it new?" decision is made *under the
        # lock* in ``_append_locked`` (by testing for an empty file), so
        # two workers racing to create the same per-thread JSONL can't
        # both emit a header.
        header_line = json.dumps(self._session_meta(thread), ensure_ascii=False) + "\n"
        record_line = json.dumps(record, ensure_ascii=False) + "\n"
        self._append_locked(target, record_line, header_line=header_line)
        return target

    def _append_locked(
        self,
        target: Path,
        line: str,
        *,
        header_line: str | None = None,
    ) -> None:
        """Append ``line`` to ``target`` durably under a cross-process
        file lock, writing ``header_line`` first iff the file is still
        empty when the lock is taken.

        ``self._lock`` only serialises writers inside *this* Python
        process. Under ``uvicorn --workers N`` two processes appending
        the same per-thread ``<thread_id>.jsonl`` can interleave their
        ``write``/``flush`` cycles and lose or corrupt records — POSIX
        ``O_APPEND`` is atomic only for writes ≤ PIPE_BUF (~4 KB), and
        thread records routinely exceed that. Wrap the write in an
        OS-level ``flock`` (``msvcrt`` on Windows) plus an ``fsync``,
        mirroring ``JSONLJournal.write``. Falls back to a plain append
        when ``fcntl``/``msvcrt`` aren't importable (e.g. WASM build).
        """
        import os as _os

        with self._lock, target.open("a", encoding="utf-8") as handle:
            fd = handle.fileno()
            locked = False
            try:
                try:
                    if _os.name == "nt":
                        import msvcrt as _msvcrt

                        # ``msvcrt.locking`` locks 1 byte at the CURRENT
                        # file position, and mode "a" positions the fd
                        # at EOF-at-open — a size that differs per
                        # writer. Two writers opening at different sizes
                        # would each lock a different byte and never
                        # actually contend. Seek to a fixed offset (0)
                        # first so every writer locks the *same* byte;
                        # the append-position seek below then restores
                        # the correct write cursor.
                        handle.seek(0, 0)
                        _msvcrt.locking(  # type: ignore[attr-defined]
                            fd,
                            _msvcrt.LK_LOCK,  # type: ignore[attr-defined]
                            1,
                        )
                        locked = True
                    else:
                        import fcntl as _fcntl

                        _fcntl.flock(fd, _fcntl.LOCK_EX)
                        locked = True
                except (OSError, ImportError) as lock_exc:
                    locked = False
                    # Degrading to an unlocked append re-opens the very
                    # interleaving window this helper exists to close —
                    # say so, or field corruption is undiagnosable.
                    logger.warning(
                        "thread-store: file lock unavailable for %s (%s); "
                        "appending without cross-process lock",
                        target.name,
                        lock_exc,
                    )
                # Seek to end: another process may have extended the file
                # since our ``open("a")`` computed the cursor. ``tell()``
                # then reports the current size — zero means we are the
                # writer that gets to lay down the ``session_meta`` header.
                try:  # noqa: SIM105
                    handle.seek(0, 2)
                except OSError:  # best-effort · handle already at append position on most platforms
                    pass
                if header_line is not None and handle.tell() == 0:
                    handle.write(header_line)
                handle.write(line)
                handle.flush()
                try:  # noqa: SIM105
                    _os.fsync(fd)
                except OSError:  # best-effort · data already flushed to the OS buffer above
                    pass
            finally:
                if locked:
                    try:
                        if _os.name == "nt":
                            import msvcrt as _msvcrt

                            try:  # noqa: SIM105
                                handle.seek(0, 0)
                            except (
                                OSError
                            ):  # best-effort · unlock below still targets the intended byte
                                pass
                            _msvcrt.locking(  # type: ignore[attr-defined]
                                fd,
                                _msvcrt.LK_UNLCK,  # type: ignore[attr-defined]
                                1,
                            )
                        else:
                            import fcntl as _fcntl

                            _fcntl.flock(fd, _fcntl.LOCK_UN)
                    except (
                        OSError
                    ):  # best-effort · closing the handle below releases the OS lock anyway
                        pass

    def _session_meta(self, thread: dict[str, Any]) -> dict[str, Any]:
        """Build a ``session_meta`` header. The first line of each
        session file carries the metadata the journal indexer
        needs (id, origin, timestamps) before any user content
        appears."""
        metadata = thread.get("metadata") or {}
        return {
            "type": "session_meta",
            "payload": {
                "id": thread.get("thread_id", ""),
                "timestamp": thread.get("created_at", _utc_now_iso()),
                "originator": self._session_origin,
                "agent": metadata.get("agent"),
                "team_id": metadata.get("team_id"),
            },
        }
