"""ThreadStateStore · lightweight thread/state persistence for frontend compat."""

from __future__ import annotations

import contextlib
import json
import logging
import threading
from pathlib import Path
from typing import Any
from uuid import uuid4

from ._permanent_deletion import ThreadPermanentDeleteLease
from ._permanent_deletion import ThreadPermanentlyDeletedError as ThreadPermanentlyDeletedError
from ._state_mutation_lock import (
    iter_jsonl_records_reverse,
    latest_persisted_thread,
    remove_stale_thread_copies,
    thread_mutation_lock,
)
from ._store_deletion import ThreadDeletionMixin
from ._store_journal import ThreadJournalMixin
from ._store_load import ThreadLoadMixin
from ._store_records import (
    _PROJECT_BINDING_METADATA_KEYS,
    _PROJECT_BINDING_VALUE_KEYS,
    _decoded_state_record,
    _deepcopy,
    _default_values,
    _utc_now_iso,
    _without_project_binding_fields,
)
from ._store_records import _project_fields as _project_fields
from ._store_search import ThreadSearchFeedbackMixin
from ._store_updates import ThreadStateUpdateMixin
from .feedback import FeedbackStore
from .session_index import SessionIndex, entry_from_thread
from .session_search import SessionSearchIndex

logger = logging.getLogger(__name__)


class ForkUnavailableError(RuntimeError):
    """The anchor's turn is still open; dsh ``fork-unavailable``.

    Raised instead of silently clipping to an earlier turn so the caller
    can surface a distinct error to the user.
    """


class ThreadStateStore(
    ThreadDeletionMixin,
    ThreadStateUpdateMixin,
    ThreadSearchFeedbackMixin,
    ThreadLoadMixin,
    ThreadJournalMixin,
):
    """Thread state store with append-only JSONL persistence.

    Two persistence modes:

    1. **Legacy single-file** — ``ThreadStateStore(path=...)`` · every
       thread's records append to one big jsonl. Matches the original
       ``data/threads.jsonl`` behavior.

    2. **Scoped routing** — ``ThreadStateStore(per_agent_base=<repo>)``
       · team threads write to
       ``<repo>/teams/<team_id>/sessions/<thread_id>.jsonl`` first.
       Solo agent threads write under
       ``<repo>/agents/<agent_id>/sessions/<thread_id>.jsonl``. Threads
       with neither team nor agent metadata fall back to
       ``<repo>/data/sessions/misc/<thread_id>.jsonl``.

    Modes are mutually exclusive (pass only one of ``path`` /
    ``per_agent_base``). ``None`` for both is pure in-memory.
    """

    def __init__(
        self,
        path: str | Path | None = None,
        *,
        per_agent_base: str | Path | None = None,
        dated_layout: bool = False,
        index_enabled: bool = True,
        search_enabled: bool = True,
        feedback_enabled: bool = True,
        repair_on_load: bool = True,
        session_origin: str = "echo",
    ) -> None:
        self._threads: dict[str, dict[str, Any]] = {}
        self._history: dict[str, list[dict[str, Any]]] = {}
        self._memory_thread_deletions: dict[str, ThreadPermanentDeleteLease] = {}
        self._lock = threading.RLock()

        # Mode selection
        if path is not None and per_agent_base is not None:
            raise ValueError(
                "ThreadStateStore: pass only one of path= / per_agent_base=",
            )
        self._path: Path | None = Path(path) if path is not None else None
        self._per_agent_base: Path | None = (
            Path(per_agent_base) if per_agent_base is not None else None
        )

        # ── Ergonomics ─────────────────────────────────────
        # ``dated_layout`` shards new threads under
        # ``sessions/<YYYY>/<MM>/<thread_id>.jsonl``. Reads still
        # cover the flat ``sessions/<thread_id>.jsonl`` so older
        # threads are not orphaned. Only honored in per-agent mode.
        self._dated_layout = dated_layout and self._per_agent_base is not None

        # ``session_origin`` is stamped into the per-thread
        # ``session_meta`` header (see ``_write_session_header``).
        # Default is ``echo`` so operators can tell at a glance
        # which runtime produced a given session file.
        self._session_origin = session_origin

        # Lightweight index for fast list/search. Lives next to the
        # session tree so it's portable. Disabled when neither path
        # nor per_agent_base is set (in-memory tests).
        self._index: SessionIndex | None = None
        if index_enabled:
            index_path = self._resolve_index_path()
            if index_path is not None:
                self._index = SessionIndex(index_path)

        # Echo Native full-text session search index
        self._search: SessionSearchIndex | None = None
        if search_enabled:
            search_path = self._resolve_search_path()
            if search_path is not None:
                self._search = SessionSearchIndex(search_path)

        # Echo Native message-feedback store
        self._feedback: FeedbackStore | None = None
        if feedback_enabled:
            feedback_base = self._resolve_feedback_base()
            if feedback_base is not None:
                self._feedback = FeedbackStore(feedback_base)

        # Load existing records
        from .list_visibility import ThreadListVisibility

        self.list_visibility = ThreadListVisibility(self._resolve_feedback_base())

        if self._path is not None and self._path.exists():
            self._load_from(self._path)
        if self._per_agent_base is not None:
            self._load_from_per_agent_tree()
        self._prune_permanently_deleted_threads_locked()
        if repair_on_load:
            self._repair_conflicting_agent_copies_locked()

        # Backfill the index from in-memory state on first boot. The
        # index is authoritative AFTER first write; before then we
        # need to seed it from whatever the file walk discovered.
        if self._index is not None and len(self._index) == 0 and self._threads:
            self._reindex_all_locked()

    def _latest_persisted_locked(self, thread_id: str):
        """Read durable state using the current canonical path when known."""

        source_hint: Path | None = self._path
        if source_hint is None and self._per_agent_base is not None:
            current = self._threads.get(thread_id)
            if current is not None:
                source_hint = self._per_thread_path(current)
        return latest_persisted_thread(
            journal_path=self._path,
            per_agent_base=self._per_agent_base,
            thread_id=thread_id,
            source_hint=source_hint,
        )

    def create(
        self,
        *,
        metadata: dict[str, Any] | None = None,
        values: dict[str, Any] | None = None,
        status: str = "idle",
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        thread: dict[str, Any] = {
            "thread_id": uuid4().hex,
            "status": status,
            "created_at": now,
            "updated_at": now,
            "metadata": _without_project_binding_fields(
                metadata,
                _PROJECT_BINDING_METADATA_KEYS,
            ),
            "values": _default_values(
                _without_project_binding_fields(values, _PROJECT_BINDING_VALUE_KEYS)
            ),
        }
        state = self._make_state(thread)
        with self._lock:
            self._threads[thread["thread_id"]] = thread
            self._history[thread["thread_id"]] = [state]
            self._append_upsert(thread, state)
            return _deepcopy(thread)

    def ensure_thread(
        self,
        thread_id: str,
        *,
        metadata: dict[str, Any] | None = None,
        values: dict[str, Any] | None = None,
        status: str = "idle",
    ) -> dict[str, Any]:
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            persisted = self._latest_persisted_locked(thread_id)
            if persisted.found and persisted.thread is not None:
                existing = _deepcopy(persisted.thread)
                self._threads[thread_id] = existing
                remove_stale_thread_copies(
                    journal_path=self._path,
                    per_agent_base=self._per_agent_base,
                    thread_id=thread_id,
                    keep_path=persisted.source_path,
                )
                return _deepcopy(existing)
            existing = self._threads.get(thread_id) if not persisted.found else None
            if existing is not None:
                return _deepcopy(existing)

            now = _utc_now_iso()
            thread: dict[str, Any] = {
                "thread_id": thread_id,
                "status": status,
                "created_at": now,
                "updated_at": now,
                "metadata": _without_project_binding_fields(
                    metadata,
                    _PROJECT_BINDING_METADATA_KEYS,
                ),
                "values": _default_values(
                    _without_project_binding_fields(values, _PROJECT_BINDING_VALUE_KEYS)
                ),
            }
            state = self._make_state(thread)
            self._threads[thread_id] = thread
            self._history[thread_id] = [state]
            target = self._append_upsert(thread, state, revision=persisted.revision + 1)
            remove_stale_thread_copies(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
                keep_path=target,
            )
            return _deepcopy(thread)

    def fork_thread(
        self,
        thread_id: str,
        *,
        at_message_index: int | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        """Fork a new thread from a completed-turn prefix (dsh ``sessions.fork``).

        The cut boundary is the first completed turn at or after
        ``at_message_index`` (a message's fork button passes its index, so
        the fork includes that whole turn); an omitted or out-of-range
        anchor falls back to the source's last completed turn. A turn is
        ``open`` when it is the last turn and has no assistant message yet
        (no snapshot has been written for it) — anchoring on an open turn
        raises :class:`ForkUnavailableError` instead of clipping to an
        earlier turn. When no completed turn exists the seed is empty and
        the child behaves like a fresh thread.

        The child inherits ordinary source metadata (agent / team / owner /
        tenant / workspace), but not Project OS binding fields, and records its lineage
        as ``metadata.parent_thread_id`` + ``metadata.parent_message_index``
        (the last included source message index, ``-1`` for an empty seed).
        Only conversation history is transferred — artifacts and live state
        are not copied (dsh: "the seed transfers conversation history only").
        """
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            persisted = self._latest_persisted_locked(thread_id)
            source = persisted.thread if persisted.found else self._threads.get(thread_id)
            if source is None:
                raise KeyError(thread_id)
            self._threads[thread_id] = _deepcopy(source)
            raw_source_values = source.get("values")
            source_values: dict[str, Any] = (
                raw_source_values if isinstance(raw_source_values, dict) else {}
            )
            messages = source_values.get("messages") or []
            if not isinstance(messages, list):
                messages = []
            humans = [
                idx
                for idx, msg in enumerate(messages)
                if isinstance(msg, dict) and msg.get("type") == "human"
            ]

            cut = self._resolve_fork_cut(messages, humans, at_message_index)
            seed = messages[: cut + 1] if cut >= 0 else []

            now = _utc_now_iso()
            child: dict[str, Any] = {
                "thread_id": uuid4().hex,
                "status": "idle",
                "created_at": now,
                "updated_at": now,
                "metadata": _without_project_binding_fields(
                    source.get("metadata") if isinstance(source.get("metadata"), dict) else None,
                    _PROJECT_BINDING_METADATA_KEYS,
                ),
                "values": _default_values({}),
            }
            lineage = child["metadata"]
            lineage["parent_thread_id"] = source["thread_id"]
            lineage["parent_message_index"] = cut
            src_title = source_values.get("title")
            child["values"]["messages"] = _deepcopy(seed)
            child["values"]["title"] = (
                title.strip()
                if isinstance(title, str) and title.strip()
                else src_title or "New chat"
            )
            state = self._make_state(child)
            self._threads[child["thread_id"]] = child
            self._history[child["thread_id"]] = [state]
            self._append_upsert(child, state)
            return _deepcopy(child)

    @staticmethod
    def _resolve_fork_cut(
        messages: list[dict[str, Any]],
        humans: list[int],
        at_message_index: int | None,
    ) -> int:
        """Return the last source message index to seed (``-1`` = empty)."""
        if not humans:
            return -1

        anchor: int | None = None
        if at_message_index is not None and 0 <= at_message_index < len(messages):
            anchor = at_message_index

        if anchor is not None:
            # Turn containing the anchor = the human message at/before it.
            turn_human = 0
            for idx in humans:
                if idx <= anchor:
                    turn_human = idx
                else:
                    break
            next_human = next((idx for idx in humans if idx > turn_human), None)
            if next_human is None:
                # The anchor is inside the last turn.
                if not any(
                    isinstance(msg, dict) and msg.get("type") == "ai"
                    for msg in messages[turn_human + 1 :]
                ):
                    raise ForkUnavailableError(
                        "anchor turn is still open; no completed turn to fork"
                    )
                return len(messages) - 1
            return next_human - 1

        # No anchor: cut at the end of the last completed turn.
        last_human = humans[-1]
        if any(
            isinstance(msg, dict) and msg.get("type") == "ai" for msg in messages[last_human + 1 :]
        ):
            return len(messages) - 1
        # Last turn is open (queued prompt without a snapshot): fall back to
        # the previous completed turn; empty seed when none exists.
        return last_human - 1 if len(humans) >= 2 else -1

    def get(self, thread_id: str) -> dict[str, Any] | None:
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            thread = self._threads.get(thread_id)
            return _deepcopy(thread) if thread is not None else None

    def delete(self, thread_id: str) -> bool:
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            persisted = self._latest_persisted_locked(thread_id)
            current = persisted.thread if persisted.found else self._threads.get(thread_id)
            if current is None:
                return False
            thread = _deepcopy(current)
            # Persist the tombstone before making the deletion visible in
            # memory.  If durable append fails, callers can retry against the
            # unchanged thread instead of receiving success for a state that
            # would resurrect on restart.
            target = self._append_delete(
                thread_id,
                thread,
                revision=persisted.revision + 1,
            )
            remove_stale_thread_copies(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
                keep_path=target,
            )
            self._threads.pop(thread_id, None)
            self._history.pop(thread_id, None)
            return True

    def delete_if_unchanged(self, thread_id: str, expected: dict[str, Any]) -> bool:
        """Atomically delete a thread only while it matches *expected*.

        Allocation rollback uses this compare-and-delete primitive so a
        failure cannot erase a thread that another request updated or claimed
        between the compensating read and delete.
        """
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            persisted = self._latest_persisted_locked(thread_id)
            current = persisted.thread if persisted.found else self._threads.get(thread_id)
            if current is None or current != expected:
                return False
            thread = _deepcopy(current)
            target = self._append_delete(
                thread_id,
                thread,
                revision=persisted.revision + 1,
            )
            remove_stale_thread_copies(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
                keep_path=target,
            )
            self._threads.pop(thread_id, None)
            self._history.pop(thread_id, None)
            return True

    def clear(self) -> None:
        """Drop all in-memory threads and rebuild persistent indices on disk."""
        with self._lock:
            self._threads.clear()
            self._history.clear()

    def search(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        metadata: dict[str, Any] | None = None,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
        select: tuple[str, ...] | list[str] | None = None,
    ) -> list[dict[str, Any]]:
        with self._lock:
            threads = [
                thread
                for thread_id, thread in self._threads.items()
                if self._thread_delete_record_locked(thread_id) is None
            ]
        if metadata:
            threads = [
                thread
                for thread in threads
                if all(thread["metadata"].get(key) == value for key, value in metadata.items())
            ]
        reverse = sort_order.lower() != "asc"
        threads.sort(key=lambda item: item.get(sort_by) or "", reverse=reverse)
        selected = threads[offset : offset + limit]
        if select:
            return [_project_fields(item, select) for item in selected]
        return [_deepcopy(item) for item in selected]

    def get_state(self, thread_id: str) -> dict[str, Any] | None:
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            history = self._history.get(thread_id)
            if not history:
                return None
            return _deepcopy(history[-1])

    def _remember_state_locked(self, thread_id: str, state: dict[str, Any]) -> None:
        """Retain only the latest state in RAM when a durable journal exists.

        Every checkpoint contains the complete message list. Keeping all of
        those copies made process memory grow with ``turns × conversation
        size`` even though history is already durable on disk. Pure in-memory
        stores still retain their full history for test and embedding use.
        """

        if self._path is not None or self._per_agent_base is not None:
            self._history[thread_id] = [state]
            return
        self._history.setdefault(thread_id, []).append(state)

    def _history_from_journal_locked(
        self,
        thread_id: str,
        *,
        limit: int,
    ) -> list[dict[str, Any]] | None:
        """Read newest history states lazily, stopping at the delete boundary."""

        if self._path is not None:
            target = self._path
        elif self._per_agent_base is not None:
            thread = self._threads.get(thread_id)
            target = self._per_thread_path(thread) if thread is not None else None
        else:
            return None
        if target is None or not target.exists():
            return None

        states: list[dict[str, Any]] = []
        for record in iter_jsonl_records_reverse(target):
            if record.get("thread_id") != thread_id:
                continue
            if record.get("op") == "delete":
                break
            thread = record.get("thread")
            if not isinstance(thread, dict):
                continue
            state = _decoded_state_record(record, thread)
            if state is None:
                continue
            states.append(state)
            if limit > 0 and len(states) >= limit:
                break
        return states

    def get_history(self, thread_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            persisted = self._history_from_journal_locked(thread_id, limit=limit)
            if persisted is not None:
                return [_deepcopy(item) for item in persisted]
            history = self._history.get(thread_id, [])
            sliced = history[-limit:] if limit > 0 else history[:]
            return [_deepcopy(item) for item in reversed(sliced)]

    def __len__(self) -> int:
        with self._lock:
            return sum(
                self._thread_delete_record_locked(thread_id) is None for thread_id in self._threads
            )

    def _make_state(self, thread: dict[str, Any]) -> dict[str, Any]:
        checkpoint_id = uuid4().hex
        return {
            "values": thread["values"],
            "next": [],
            "metadata": thread["metadata"],
            "checkpoint": {
                "id": checkpoint_id,
                "checkpoint_id": checkpoint_id,
                "ts": thread["updated_at"],
            },
            "checkpoint_id": checkpoint_id,
            "tasks": [],
        }

    def _repair_conflicting_agent_copies_locked(self) -> None:
        """Prefer the thread's original role when stale copies disagree.

        Older clients could send a different ``agent_name`` on a later turn,
        producing two files with the same thread id in different role folders.
        File traversal order then decided which conversation appeared after a
        restart.  The earliest ``created_at`` identifies the original role;
        move the fullest/latest conversation back there and remove the stale
        duplicate so future reads and sidebar filters are deterministic.
        """
        if self._per_agent_base is None:
            return
        agents_root = self._per_agent_base / "agents"
        if not agents_root.exists():
            return

        candidates: dict[str, list[tuple[str, Path, dict[str, Any]]]] = {}
        for agent_dir in agents_root.iterdir():
            if not agent_dir.is_dir():
                continue
            sessions = agent_dir / "sessions"
            if not sessions.exists():
                continue
            for path in self._canonical_session_files(sessions):
                thread = self._latest_thread_from_file(path)
                if thread is None:
                    continue
                candidates.setdefault(path.stem, []).append((agent_dir.name, path, thread))

        for thread_id, discovered_copies in candidates.items():
            if len(discovered_copies) < 2:
                continue
            with thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ):
                if self._thread_delete_record_locked(thread_id) is not None:
                    self._threads.pop(thread_id, None)
                    self._history.pop(thread_id, None)
                    continue
                # The constructor may have blocked behind a live writer after
                # its initial scan. Never repair from that stale snapshot:
                # re-enumerate every discovered role file while holding the
                # same logical lock used by normal mutations.
                copies: list[tuple[str, Path, dict[str, Any]]] = []
                for agent, path, _thread in discovered_copies:
                    current = self._latest_thread_from_file(path)
                    if current is not None:
                        copies.append((agent, path, current))

                persisted = latest_persisted_thread(
                    journal_path=self._path,
                    per_agent_base=self._per_agent_base,
                    thread_id=thread_id,
                )
                if not persisted.found or persisted.thread is None:
                    continue
                if len(copies) < 2:
                    # Another worker already completed the repair or a normal
                    # mutation removed the stale copy while this constructor
                    # waited. Refresh this instance from the durable winner.
                    refreshed = _deepcopy(persisted.thread)
                    refreshed_state = self._make_state(refreshed)
                    self._threads[thread_id] = refreshed
                    self._history[thread_id] = [refreshed_state]
                    continue

                owner_agent, owner_path, _owner_thread = min(
                    copies,
                    key=lambda item: (
                        str(item[2].get("created_at") or "9999"),
                        str(item[2].get("updated_at") or "9999"),
                    ),
                )
                repaired = _deepcopy(persisted.thread)
                repaired_meta = repaired.setdefault("metadata", {})
                repaired_meta["agent"] = owner_agent
                for key in ("agent_name", "agent_id", "assistant_id"):
                    if key in repaired_meta:
                        repaired_meta[key] = owner_agent
                state = self._make_state(repaired)
                state["metadata"] = _deepcopy(repaired_meta)

                # Rebuild one canonical file under the original owner. The
                # revision keeps the repair ordered after the durable snapshot
                # it folded, so a later constructor cannot prefer an old copy.
                owner_path.parent.mkdir(parents=True, exist_ok=True)
                tmp_path = owner_path.with_suffix(owner_path.suffix + ".repair")
                tmp_path.write_text(
                    json.dumps(self._session_meta(repaired), ensure_ascii=False)
                    + "\n"
                    + json.dumps(
                        {
                            "op": "upsert",
                            "thread_id": thread_id,
                            "thread": repaired,
                            "state": state,
                            "revision": persisted.revision + 1,
                            "operation_at": _utc_now_iso(),
                        },
                        ensure_ascii=False,
                    )
                    + "\n",
                    encoding="utf-8",
                )
                tmp_path.replace(owner_path)
                for _agent, path, _thread in copies:
                    if path == owner_path:
                        continue
                    with contextlib.suppress(OSError):
                        path.unlink()
                logger.warning(
                    "thread-store: repaired conflicting role copies for %s; owner=%s, removed=%d",
                    thread_id,
                    owner_agent,
                    len(copies) - 1,
                )
                self._threads[thread_id] = repaired
                self._history[thread_id] = [state]
                if self._index is not None:
                    entry = entry_from_thread(
                        repaired,
                        file_path=self._index_file_for(owner_path),
                    )
                    if entry is not None:
                        self._index.upsert(entry)

    def close(self) -> None:
        """Release OS resources held by the store (idempotent).

        The FTS5 search index keeps a long-lived SQLite connection to
        ``search.db``. On Windows an open handle prevents the file (and its
        directory) from being deleted or moved, so owners — app shutdown
        hooks, tests, CLI tools — must close the store when done. After
        ``close()`` the search index degrades to its closed-connection
        no-op behaviour; JSONL persistence needs no explicit release.
        """
        with self._lock:
            if self._search is not None:
                self._search.close()

    def __enter__(self) -> ThreadStateStore:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
