from __future__ import annotations

import contextlib
from pathlib import Path
from threading import Lock
from typing import Any

from runtime.platform.models import (
    AntigenSignature,
    ArmId,
    CostEntry,
    ImmuneVerdict,
    Source,
    Step,
    TaskId,
    Trajectory,
    new_id,
    now_utc,
)
from runtime.safety.auth.scope import TenantScope
from runtime.safety.invariants import AppendOnlyList
from runtime.safety.invariants.enforce import enforces

from ._chunk_rows import (
    chunk_packing_enabled,
    classify_chunk,
    continues_chunk_run,
)
from ._journal_base import Journal
from ._journal_models import (
    CURRENT_SCHEMA_VERSION,
    AssistantChunkEvent,
    BrowserArtifactEvent,
    BudgetBreakerResetEvent,
    BudgetEvent,
    CurriculumGoalDecisionEvent,
    FileOpEvent,
    FileRollbackEvent,
    HookInvokedEvent,
    HookResultEvent,
    ImmuneEvent,
    JournalEvent,
    JournalEventType,
    McpProposalDecisionEvent,
    NodeStartedEvent,
    PreviewRefreshEvent,
    ProtocolDriftDecisionEvent,
    ReactCheckpointEvent,
    ReflexHitEvent,
    SkillProposalDecisionEvent,
    StepEvent,
    SubSessionSummaryEvent,
    SubTextDeltaEvent,
    SubToolEndEvent,
    SubToolStartEvent,
    TaskCheckpointEvent,
    TaskPausedEvent,
    TaskResumedEvent,
    TaskStartedEvent,
    TokenUsageEvent,
    ToolEffectIntentEvent,
    ToolEffectReconciliationEvent,
    TrajectoryEvent,
)
from ._journal_parse import _parse_event
from ._journal_support import (
    JournalTransactionError,
    TrajectoryConflictError,
    _fsync_parent_directory,
    _lock_windows_fd,
    _refresh_session_index,
    _trajectory_dedupe_key,
    _trajectory_payload_digest,
)
from ._jsonl_journal_redaction import JournalRedactionMixin
from ._jsonl_journal_streams import JournalStreamsMixin

__all__ = [
    "CURRENT_SCHEMA_VERSION",
    "AntigenSignature",
    "ArmId",
    "CostEntry",
    "ImmuneVerdict",
    "Source",
    "Step",
    "TaskId",
    "Trajectory",
    "new_id",
    "now_utc",
    "Journal",
    "JournalTransactionError",
    "TrajectoryConflictError",
    "JournalEvent",
    "JournalEventType",
    "AssistantChunkEvent",
    "StepEvent",
    "TrajectoryEvent",
    "ImmuneEvent",
    "BudgetEvent",
    "BudgetBreakerResetEvent",
    "TaskStartedEvent",
    "NodeStartedEvent",
    "TaskCheckpointEvent",
    "ReactCheckpointEvent",
    "ToolEffectIntentEvent",
    "ToolEffectReconciliationEvent",
    "TaskPausedEvent",
    "TaskResumedEvent",
    "TokenUsageEvent",
    "FileOpEvent",
    "FileRollbackEvent",
    "HookInvokedEvent",
    "HookResultEvent",
    "PreviewRefreshEvent",
    "ReflexHitEvent",
    "SkillProposalDecisionEvent",
    "CurriculumGoalDecisionEvent",
    "McpProposalDecisionEvent",
    "ProtocolDriftDecisionEvent",
    "SubSessionSummaryEvent",
    "SubTextDeltaEvent",
    "SubToolStartEvent",
    "SubToolEndEvent",
    "BrowserArtifactEvent",
    "InMemoryJournal",
    "JSONLJournal",
]


class InMemoryJournal(Journal):
    def __init__(self, max_events: int = 0) -> None:
        """In-memory journal with an optional oldest-event eviction cap."""

        self._events = AppendOnlyList[JournalEvent](rule_id="CC-5")
        self._max_events = max(0, int(max_events))
        self._lock = Lock()
        self._session_index: dict[str, list[JournalEvent]] = {}
        self._session_index_upto = 0

    @enforces("CC-5")
    def _append(self, event: JournalEvent) -> None:
        self._events.append(event)

    def write(self, event: JournalEvent) -> None:
        event = self._apply_context(event)
        with self._lock:
            self._append(event)
            if self._max_events > 0:
                overflow = len(self._events) - self._max_events
                if overflow > 0:
                    self._events.drop_oldest(overflow)

    @enforces("CC-5")
    def write_trajectory_once(self, event: TrajectoryEvent) -> bool:
        inserted, _canonical = self.write_trajectory_once_canonical(event)
        return inserted

    def write_trajectory_once_canonical(
        self,
        event: TrajectoryEvent,
    ) -> tuple[bool, TrajectoryEvent]:
        canonical = self.canonicalize_trajectory_event(event)
        key = _trajectory_dedupe_key(canonical)
        payload_digest = _trajectory_payload_digest(canonical)
        with self._lock:
            existing = next(
                (
                    item
                    for item in self._events.snapshot()
                    if isinstance(item, TrajectoryEvent) and _trajectory_dedupe_key(item) == key
                ),
                None,
            )
            if existing is not None:
                if _trajectory_payload_digest(existing) != payload_digest:
                    raise TrajectoryConflictError(
                        "trajectory key is already committed with a conflicting payload"
                    )
                return False, canonical
            self._append(canonical)
            if self._max_events > 0:
                overflow = len(self._events) - self._max_events
                if overflow > 0:
                    self._events.drop_oldest(overflow)
            return True, canonical

    def read_all(self, *, scope: TenantScope | None = None) -> list[JournalEvent]:
        with self._lock:
            events = self._events.snapshot()
        return [event for event in events if self._visible(event, scope)]

    def read_by_session(self, session_id: str) -> list[JournalEvent]:
        with self._lock:
            events = self._events.snapshot()
            _refresh_session_index(self._session_index, events, self._session_index_upto)
            self._session_index_upto = len(events)
            return list(self._session_index.get(session_id, ()))

    def __len__(self) -> int:
        return len(self._events)


# ═══════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════


class JSONLJournal(JournalRedactionMixin, JournalStreamsMixin, Journal):
    def __init__(
        self,
        path: Path | str,
        *,
        max_size_bytes: int | None = None,
        keep_ratio: float = 0.5,
        audit_chain: Any = None,
        redactor: Any = None,
        trace_store: Any = None,
    ) -> None:
        """
        Parameters
        ----------
        path :
            On-disk location for the JSONL file.
        max_size_bytes :
            Optional cap. When the file grows past this, the oldest
            lines are dropped so roughly ``keep_ratio`` of the cap
            worth of most-recent events survive. ``None`` (default)
            disables rotation — the journal grows forever, matching
            older behavior. Recommended ~10-50 MB for a demo setup.
        keep_ratio :
            Fraction of ``max_size_bytes`` retained after a rotation.
            Default 0.5 keeps the last half. Higher = less frequent
            rotation but less headroom before the next one.
        audit_chain :
            Optional ``runtime.safety.audit.audit_chain.AuditChain`` instance.
            When provided, every ``write(event)`` also appends a
            signed record to the chain so tampering with the JSONL
            file (or dropping/reordering lines) is detectable via
            ``audit_chain.verify()``. ``None`` disables audit signing —
            matches the prior default behaviour.
        redactor :
            Optional ``runtime.platform.observability.redactor.Redactor`` instance.
            When provided, the JSON payload is run through
            ``redactor.redact()`` before persistence so accidental
            secrets in tool outputs / args don't land on disk.
            ``None`` (default) disables redaction.
        trace_store :
            Optional ``runtime.memory.diagnostics.trace_store.AgentTraceStore`` sidecar.
            When provided, selected journal events are mirrored into
            SQLite tables for fast audit and recovery queries.
        """
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._cache: list[JournalEvent] = []
        self._cache_byte_pos: int = 0
        self._skipped_total: int = 0
        self._max_size_bytes = max_size_bytes
        self._keep_ratio = max(0.1, min(0.9, keep_ratio))
        self._audit_chain = audit_chain
        self._redactor = redactor
        self._trace_store = trace_store
        # Buffered chunk run awaiting packing (list of (entry, event) pairs).
        self._pending_chunk_run: list[tuple[dict, JournalEvent]] | None = None
        # Audit P-04: incremental per-session index (built from the parsed
        # cache; reset automatically when the file rotates/truncates).
        self._session_index: dict[str, list[JournalEvent]] = {}
        self._session_index_upto = 0

    def attach_trace_store(self, trace_store: Any) -> None:
        """Attach or replace the optional SQLite trace sidecar."""
        self._trace_store = trace_store

    @contextlib.contextmanager
    def _interprocess_lock(self, *, required: bool = False) -> Any:
        """Exclusive cross-process lock on a STABLE sidecar (``<path>.lock``),
        held across BOTH the append and the rotation below.

        Rotation does a ``tmp.replace`` rename, which swaps the journal inode —
        so a per-fd ``flock`` on the journal file itself cannot serialise a
        concurrent worker's append against a rename (the appender ends up
        writing the orphaned inode and its events are lost under
        ``uvicorn --workers N``). Locking a sidecar that is never renamed gives
        every writer a single, stable mutex. Ordinary journal writes retain
        their historic best-effort fallback when the platform has no file
        locking. Atomic check-and-append callers pass ``required=True`` and
        fail closed instead: silently proceeding unlocked would permit two
        workers to persist the same trajectory."""
        import os as _os

        lock_path = self._path.with_suffix(self._path.suffix + ".lock")
        try:
            lock_file = lock_path.open("a")
        except OSError as exc:
            if required:
                raise JournalTransactionError(
                    f"cannot open journal transaction lock: {lock_path}"
                ) from exc
            yield False
            return
        fd = lock_file.fileno()
        locked = False
        try:
            try:
                if _os.name == "nt":
                    # ``msvcrt.locking`` locks one existing byte from the
                    # current cursor. Seed the stable sidecar once and always
                    # lock byte zero so independent Windows workers contend
                    # on the same region.
                    lock_file.seek(0, 2)
                    if lock_file.tell() == 0:
                        lock_file.write("\0")
                        lock_file.flush()
                    lock_file.seek(0)
                    _lock_windows_fd(fd, "LK_LOCK")
                    locked = True
                else:
                    import fcntl as _fcntl

                    _fcntl.flock(fd, _fcntl.LOCK_EX)
                    locked = True
            except (OSError, ImportError) as exc:
                if required:
                    raise JournalTransactionError(
                        f"cannot acquire journal transaction lock: {lock_path}"
                    ) from exc
                locked = False
            yield locked
        finally:
            if locked:
                try:
                    if _os.name == "nt":
                        with contextlib.suppress(OSError):
                            lock_file.seek(0)
                        _lock_windows_fd(fd, "LK_UNLCK")
                    else:
                        import fcntl as _fcntl

                        _fcntl.flock(fd, _fcntl.LOCK_UN)
                except OSError:  # best-effort · lock_file.close() below releases it anyway
                    pass
            with contextlib.suppress(OSError):
                lock_file.close()

    @enforces("CC-5")
    def write(self, event: JournalEvent) -> None:
        # Canonicalize ownership before chunk classification as packed chunk
        # rows bypass ``_serialize_event_locked``.  This also keeps mirrors and
        # ordinary direct writers aligned with the durable representation.
        event = self._storage_scoped_event(self._apply_context(event))
        with self._lock:
            entry = classify_chunk(event)
            if entry is not None and chunk_packing_enabled():
                # Defer the file write: hold the chunk run in memory so a
                # run of token-sized deltas lands as ONE packed storage row
                # (dsh ``chunk-rows``). Any non-chunk event, an explicit
                # read, or a run break flushes it first — so at most the
                # trailing chunk run is buffered at any moment.
                run = self._pending_chunk_run
                if run is not None and continues_chunk_run(run[-1][0], entry):
                    run.append((entry, event))
                else:
                    self._flush_pending_chunks_locked()
                    self._pending_chunk_run = [(entry, event)]
                return
            self._flush_pending_chunks_locked()
            self._append_event_locked(event)

    def _append_event_locked(self, event: JournalEvent) -> None:
        """Serialize + redact + append + mirror one event.

        Caller must hold ``self._lock`` (the interprocess lock is taken
        inside ``_append_raw_locked``).
        """
        durable_event, line = self._canonicalize_event_locked(event)
        self._append_raw_locked(line + "\n")
        self._mirror_event_effects(durable_event)

    def _serialize_event_locked(self, event: JournalEvent) -> str:
        """Serialize and redact an event without touching journal storage."""

        event = self._storage_scoped_event(event)
        original_payload = event.model_dump(mode="json")
        original_line = self._dump_json_payload(original_payload)
        if self._redactor is None:
            return original_line

        redacted_payload = self._redact_json_string_values(original_payload)
        redacted_payload = self._restore_redaction_protected_model_fields(
            event,
            original_payload,
            redacted_payload,
        )
        if redacted_payload == original_payload:
            return original_line

        candidate_line = self._dump_json_payload(redacted_payload)
        if self._serialized_event_keeps_structure(event, candidate_line):
            return candidate_line

        # A custom or overly broad rule may still rewrite a schema-constrained
        # string (for example, a Literal nested in tool metadata).  Retain all
        # independently valid payload redactions and reject only the leaf that
        # would invalidate or re-identify the journal event.  This preserves
        # secret scrubbing without letting observability take down execution.
        accepted_payload = original_payload
        for path, replacement in self._string_redaction_changes(
            original_payload,
            redacted_payload,
        ):
            trial_payload = self._replace_json_path(
                accepted_payload,
                path,
                replacement,
            )
            trial_line = self._dump_json_payload(trial_payload)
            if self._serialized_event_keeps_structure(event, trial_line):
                accepted_payload = trial_payload
        return self._dump_json_payload(accepted_payload)

    def _append_raw_locked(
        self,
        line: str,
        *,
        require_durability: bool = False,
    ) -> None:
        """Append one storage line under the interprocess lock, then rotate.

        Caller must hold ``self._lock``. ``self._interprocess_lock()``
        serialises writers across processes — with ``uvicorn --workers N``
        two processes can interleave ``write`` + ``flush`` cycles.
        POSIX ``O_APPEND`` is atomic only for writes ≤ PIPE_BUF (~4 KB);
        trajectory dumps routinely blow past that. On Windows ``"a"``
        mode is never atomic across processes. Wrap the actual
        ``write/flush`` in an OS-level file lock keyed on the journal
        path so one writer at a time touches the JSONL. Falls back
        silently when ``fcntl``/``msvcrt`` aren't importable (e.g. WASM).
        """
        with self._interprocess_lock(required=require_durability):
            self._append_raw_with_interprocess_lock_locked(
                line,
                require_durability=require_durability,
            )

    def _append_raw_with_interprocess_lock_locked(
        self,
        line: str,
        *,
        require_durability: bool = False,
    ) -> None:
        """Append one line while the stable sidecar lock is already held.

        Splitting this from :meth:`_append_raw_locked` is important for
        atomic read-check-write transactions: reacquiring ``flock`` through a
        second file descriptor in the same process can self-deadlock on some
        platforms.  Callers must hold ``self._lock`` and the stable sidecar
        lock before entering this helper.
        """

        import os as _os

        journal_was_missing = not self._path.exists()
        with self._path.open("a", encoding="utf-8") as f:
            fd = f.fileno()
            _locked = False
            try:
                if _os.name == "nt":
                    try:
                        # LK_LOCK: block up to ~10s per attempt, retry
                        # a few times. LK_LOCK retries internally, so
                        # a single call is enough in practice.
                        _lock_windows_fd(fd, "LK_LOCK")
                        _locked = True
                    except OSError:
                        _locked = False
                else:
                    try:
                        import fcntl as _fcntl

                        _fcntl.flock(fd, _fcntl.LOCK_EX)
                        _locked = True
                    except (OSError, ImportError):
                        _locked = False
                # Seek to end: another process may have extended the
                # file since our ``open("a")`` computed the cursor.
                try:  # noqa: SIM105
                    f.seek(0, 2)
                except OSError:  # noqa: BLE001 — seek-to-end best-effort; writes still append
                    pass
                f.write(line)
                f.flush()
                try:
                    _os.fsync(fd)
                except OSError as exc:
                    if require_durability:
                        raise JournalTransactionError("cannot fsync durable journal data") from exc
                    # Ordinary high-volume telemetry retains its historical
                    # best-effort fsync behavior. Atomic terminal samples do
                    # not: their ledger must never advance after this branch.
            finally:
                if _locked:
                    try:
                        if _os.name == "nt":
                            # Seek back to the lock byte before unlocking.
                            try:  # noqa: SIM105
                                f.seek(0, 0)
                            except OSError:  # noqa: BLE001 — file lock/seek/fsync best-effort
                                pass
                            _lock_windows_fd(fd, "LK_UNLCK")
                        else:
                            import fcntl as _fcntl

                            _fcntl.flock(fd, _fcntl.LOCK_UN)
                    except OSError:  # noqa: BLE001 — file lock/seek/fsync best-effort
                        pass
        # A successful file fsync alone cannot make a newly-created path
        # survive power loss. Atomic writes always establish the directory
        # barrier; ordinary telemetry pays that cost only for first creation.
        if require_durability or journal_was_missing:
            _fsync_parent_directory(
                self._path,
                require_durability=require_durability,
                transaction_label="journal",
            )
        # Rotate if we've blown past the cap — still under the
        # interprocess lock so a rename can't race another process's
        # append to the old inode (data-loss window on rotation).
        if self._max_size_bytes is not None:
            try:
                size = self._path.stat().st_size
            except OSError:
                return
            if size > self._max_size_bytes:
                self._rotate_locked(require_durability=require_durability)

    def _fsync_journal_data_locked(self) -> None:
        """Re-establish durability before completing a recovered reservation."""
        if not self._path.exists():
            raise JournalTransactionError("trajectory journal data is absent")
        try:
            import os as _os

            # Windows fsync needs a writable handle (read-only -> EBADF); r+b never truncates.
            with self._path.open("rb" if _os.name == "posix" else "r+b") as journal_file:
                _os.fsync(journal_file.fileno())
            _fsync_parent_directory(
                self._path,
                require_durability=True,
                transaction_label="recovered journal",
            )
        except OSError as exc:
            raise JournalTransactionError(
                "cannot fsync recovered atomic trajectory journal data"
            ) from exc

    def _canonicalize_event_locked(
        self,
        event: JournalEvent,
    ) -> tuple[JournalEvent, str]:
        """Apply context + redaction and parse the exact storage event."""

        scoped_event = self._apply_context(event)
        storage_event = self._storage_scoped_event(scoped_event)
        line = self._serialize_event_locked(storage_event)
        try:
            durable_event = _parse_event(line)
        except (TypeError, ValueError) as exc:
            raise JournalTransactionError(
                "serialized payload is not a valid journal event"
            ) from exc
        if (
            durable_event.event_id != scoped_event.event_id
            or durable_event.event_type != scoped_event.event_type
        ):
            raise JournalTransactionError("serialized journal event changed identity")
        if (
            durable_event.tenant_id != storage_event.tenant_id
            or durable_event.owner_actor_id != storage_event.owner_actor_id
        ):
            raise JournalTransactionError("redaction changed journal ownership scope")
        return durable_event, line

    def canonicalize_event(self, event: JournalEvent) -> JournalEvent:
        with self._lock:
            durable_event, _line = self._canonicalize_event_locked(event)
            return durable_event

    def write_canonical(self, event: JournalEvent) -> JournalEvent:
        """Durably write and return the exact redacted/scoped event.

        Streaming callers need a single combined operation: canonicalizing
        before the append avoids a racy read-back, while returning only after
        strict fsync ensures no subscriber sees an event whose durable write
        failed. Canonical writes bypass deferred chunk packing because a
        buffered event is not yet durable.
        """

        with self._lock:
            self._flush_pending_chunks_locked()
            durable_event, line = self._canonicalize_event_locked(event)
            self._append_raw_locked(line + "\n", require_durability=True)
            self._mirror_event_effects(durable_event)
            return durable_event

    def _rotate_locked(self, *, require_durability: bool = False) -> None:
        """Trim the file to the last ``keep_ratio * max_size_bytes``
        from the tail (so the most-recent events survive). Caller must
        hold ``self._lock``. Invalidates the incremental read cache
        because byte offsets shift. The newest complete row is always kept,
        even when that one trajectory is larger than the configured cap.
        """
        if self._max_size_bytes is None:
            return
        keep_bytes = int(self._max_size_bytes * self._keep_ratio)
        try:
            size = self._path.stat().st_size
        except OSError:
            return
        if size <= keep_bytes:
            return
        try:
            payload = self._path.read_bytes()
        except OSError:
            if require_durability:
                raise
            return
        if payload and not payload.endswith(b"\n"):
            import logging

            logging.getLogger(__name__).warning(
                "journal %s: rotate skipped · incomplete trailing row",
                self._path,
            )
            return
        lines = payload.splitlines(keepends=True)
        if not lines:
            return
        kept_reversed: list[bytes] = []
        kept_size = 0
        for row in reversed(lines):
            if kept_reversed and kept_size + len(row) > keep_bytes:
                break
            kept_reversed.append(row)
            kept_size += len(row)
        tail = b"".join(reversed(kept_reversed))
        # Atomic replace: write to .tmp then rename.
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        try:
            import os as _os

            with tmp.open("wb") as f:
                f.write(tail)
                f.flush()
                try:
                    _os.fsync(f.fileno())
                except OSError as exc:
                    if require_durability:
                        raise JournalTransactionError(
                            "cannot fsync atomic trajectory rotation data"
                        ) from exc
            tmp.replace(self._path)
            _fsync_parent_directory(
                self._path,
                require_durability=require_durability,
                transaction_label="journal rotation",
            )
        except OSError:
            if require_durability:
                raise
            return
        # Invalidate cache · next read_all() reparses from scratch.
        self._cache = []
        self._cache_byte_pos = 0
        self._skipped_total = 0
        import logging

        logging.getLogger(__name__).info(
            "journal %s rotated · kept tail %d bytes (was %d)",
            self._path,
            len(tail),
            size,
        )
