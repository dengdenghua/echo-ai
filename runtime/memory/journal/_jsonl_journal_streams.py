"""Trajectory, mirroring, and read paths for the JSONL journal.

Extracted from ``journal`` to keep the module under the god-file threshold.
``JSONLJournal`` mixes this in; the core write/lock/rotation methods stay on
the journal class and are reached through ``self``.
"""

from __future__ import annotations

import json
from typing import Any, cast

from runtime.memory.journal._chunk_rows import (
    MIN_RUN,
    classify_chunk,
    continues_chunk_run,
    expand_chunk_row,
    is_chunk_row,
    pack_chunk_row,
)
from runtime.memory.journal._journal_models import (
    JournalEvent,
    ReactCheckpointEvent,
    TaskCheckpointEvent,
    TokenUsageEvent,
    TrajectoryEvent,
)
from runtime.memory.journal._journal_parse import _parse_event, _parse_event_data
from runtime.memory.journal._journal_support import (
    JournalTransactionError,
    TrajectoryConflictError,
    _fsync_parent_directory,
    _refresh_session_index,
    _trajectory_dedupe_digest,
    _trajectory_dedupe_key,
    _trajectory_payload_digest,
    _TrajectoryDedupeState,
)
from runtime.safety.auth.scope import TenantScope
from runtime.safety.invariants.enforce import enforces


class JournalStreamsMixin:
    """Trajectory dedupe/canonicalisation, trace mirroring, and reads."""

    _lock: Any
    _path: Any
    _cache: Any
    _session_index: Any
    _session_index_upto: Any
    _redactor: Any
    _audit_chain: Any
    _apply_context: Any
    _visible: Any
    _storage_scoped_event: Any
    _append_event_locked: Any
    _trace_store: Any
    _interprocess_lock: Any
    _append_raw_locked: Any
    _append_raw_with_interprocess_lock_locked: Any
    _canonicalize_event_locked: Any
    _fsync_journal_data_locked: Any
    _rotate_locked: Any
    write: Any
    write_canonical: Any
    _pending_chunk_run: Any

    def _trajectory_payload_on_disk_locked(
        self,
        key: tuple[str, str, str, str],
    ) -> str | None:
        """Strictly inspect durable rows while the transaction lock is held.

        A truncated or malformed row means absence cannot be proven.  Atomic
        trajectory persistence therefore raises instead of skipping the bad
        row like the best-effort projection reader does; this is the crucial
        crash-safe, fail-closed boundary preventing a quiet duplicate append.
        """

        if not self._path.exists():
            return None
        try:
            payload = self._path.read_bytes()
        except OSError as exc:
            raise JournalTransactionError("cannot inspect journal transaction state") from exc
        if not payload:
            return None
        if not payload.endswith(b"\n"):
            raise JournalTransactionError("journal has an incomplete trailing row")
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise JournalTransactionError("journal contains invalid UTF-8") from exc
        matching_payload: str | None = None
        for raw in text.splitlines():
            line = raw.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                event_payloads = expand_chunk_row(data) if is_chunk_row(data) else (data,)
                for event_payload in event_payloads:
                    candidate = _parse_event_data(event_payload)
                    if (
                        isinstance(candidate, TrajectoryEvent)
                        and _trajectory_dedupe_key(candidate) == key
                    ):
                        candidate_payload = _trajectory_payload_digest(candidate)
                        if matching_payload is not None and matching_payload != candidate_payload:
                            raise TrajectoryConflictError(
                                "journal contains conflicting trajectories for one key"
                            )
                        matching_payload = candidate_payload
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                raise JournalTransactionError(
                    "journal contains an invalid transaction row"
                ) from exc
        return matching_payload

    def _trajectory_dedupe_state_locked(
        self,
        digest: str,
    ) -> _TrajectoryDedupeState | None:
        """Read one strict reservation state from the non-rotating ledger."""

        ledger_path = self._path.with_suffix(self._path.suffix + ".trajectory-dedupe.jsonl")
        if not ledger_path.exists():
            return None
        try:
            payload = ledger_path.read_bytes()
        except OSError as exc:
            raise JournalTransactionError("cannot inspect trajectory dedupe ledger") from exc
        if not payload:
            return None
        if not payload.endswith(b"\n"):
            raise JournalTransactionError("trajectory dedupe ledger has a truncated row")
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise JournalTransactionError("trajectory dedupe ledger is not UTF-8") from exc

        state: str | None = None
        payload_digest: str | None = None
        for raw in text.splitlines():
            try:
                record = json.loads(raw)
            except (json.JSONDecodeError, TypeError) as exc:
                raise JournalTransactionError("trajectory dedupe ledger is invalid") from exc
            if not isinstance(record, dict):
                raise JournalTransactionError("trajectory dedupe ledger row is not an object")
            record_digest = record.get("key")
            record_state = record.get("state")
            record_payload = record.get("payload")
            if not isinstance(record_digest, str) or record_state not in {
                "reserved",
                "committed",
            }:
                raise JournalTransactionError("trajectory dedupe ledger row is invalid")
            if record_payload is not None and not isinstance(record_payload, str):
                raise JournalTransactionError("trajectory dedupe payload digest is invalid")
            if record_digest != digest:
                continue
            if (
                payload_digest is not None
                and record_payload is not None
                and payload_digest != record_payload
            ):
                raise TrajectoryConflictError(
                    "trajectory dedupe ledger contains conflicting payloads"
                )
            if state == "committed" and record_state == "reserved":
                raise JournalTransactionError("trajectory dedupe ledger regressed state")
            state = str(record_state)
            if record_payload is not None:
                payload_digest = record_payload
        if state is None:
            return None
        return _TrajectoryDedupeState(state=state, payload_digest=payload_digest)

    def _append_trajectory_dedupe_record_locked(
        self,
        digest: str,
        state: str,
        payload_digest: str | None = None,
    ) -> None:
        """Durably append a reservation state while the sidecar lock is held."""

        ledger_path = self._path.with_suffix(self._path.suffix + ".trajectory-dedupe.jsonl")
        row = json.dumps(
            {
                "version": 2,
                "key": digest,
                "payload": payload_digest,
                "state": state,
            },
            ensure_ascii=True,
            separators=(",", ":"),
        )
        try:
            import os as _os

            with ledger_path.open("a", encoding="utf-8") as ledger:
                ledger.seek(0, 2)
                ledger.write(row + "\n")
                ledger.flush()
                _os.fsync(ledger.fileno())
            _fsync_parent_directory(
                ledger_path,
                require_durability=True,
                transaction_label="trajectory dedupe ledger",
            )
        except OSError as exc:
            raise JournalTransactionError("cannot persist trajectory dedupe state") from exc

    def _canonicalize_trajectory_event_locked(
        self,
        event: TrajectoryEvent,
    ) -> tuple[TrajectoryEvent, str]:
        """Apply server context + redaction and parse the exact durable row."""

        scoped_event = cast(TrajectoryEvent, self._apply_context(event))
        storage_event = cast(TrajectoryEvent, self._storage_scoped_event(scoped_event))
        key = _trajectory_dedupe_key(storage_event)
        durable_event, line = self._canonicalize_event_locked(storage_event)
        if not isinstance(durable_event, TrajectoryEvent):
            raise JournalTransactionError("serialized trajectory changed event identity")
        if _trajectory_dedupe_key(durable_event) != key:
            raise JournalTransactionError("redaction changed trajectory transaction identity")
        return durable_event, line

    def canonicalize_trajectory_event(self, event: TrajectoryEvent) -> TrajectoryEvent:
        with self._lock:
            durable_event, _line = self._canonicalize_trajectory_event_locked(event)
            return durable_event

    @enforces("CC-5")
    def write_trajectory_once(self, event: TrajectoryEvent) -> bool:
        """Durably append one ownership-scoped trajectory at most once."""

        inserted, _durable_event = self.write_trajectory_once_canonical(event)
        return inserted

    def write_trajectory_once_canonical(
        self,
        event: TrajectoryEvent,
    ) -> tuple[bool, TrajectoryEvent]:
        with self._lock:
            # A buffered token run must become part of the durable prefix
            # before the strict transaction scan. This happens before taking
            # the required sidecar lock, avoiding recursive flock acquisition.
            self._flush_pending_chunks_locked()
            durable_event, line = self._canonicalize_trajectory_event_locked(event)
            key = _trajectory_dedupe_key(durable_event)
            key_digest = _trajectory_dedupe_digest(key)
            payload_digest = _trajectory_payload_digest(durable_event)
            with self._interprocess_lock(required=True):
                dedupe = self._trajectory_dedupe_state_locked(key_digest)
                on_disk_payload = self._trajectory_payload_on_disk_locked(key)

                if dedupe is not None and dedupe.payload_digest is not None:
                    if dedupe.payload_digest != payload_digest:
                        raise TrajectoryConflictError(
                            "trajectory key is reserved or committed with a conflicting payload"
                        )
                elif dedupe is not None:
                    # Version-1 ledger rows did not bind a payload. They are
                    # safe to upgrade only while the corresponding journal row
                    # is still available for an exact canonical comparison.
                    if on_disk_payload is None:
                        raise JournalTransactionError(
                            "legacy trajectory reservation payload cannot be verified"
                        )
                    if on_disk_payload != payload_digest:
                        raise TrajectoryConflictError(
                            "legacy trajectory key has a conflicting payload"
                        )
                    if dedupe.state == "committed":
                        # Bind the verified legacy commit to its canonical
                        # payload before returning. Otherwise a later rotation
                        # can remove the only evidence needed to interpret the
                        # version-1 row and permanently poison idempotent retry.
                        self._fsync_journal_data_locked()
                        self._append_trajectory_dedupe_record_locked(
                            key_digest,
                            "committed",
                            payload_digest,
                        )
                        dedupe = _TrajectoryDedupeState(
                            state="committed",
                            payload_digest=payload_digest,
                        )

                if on_disk_payload is not None and on_disk_payload != payload_digest:
                    raise TrajectoryConflictError(
                        "journal already contains a conflicting trajectory payload"
                    )

                if dedupe is not None and dedupe.state == "committed":
                    return False, durable_event

                if dedupe is not None and dedupe.state == "reserved":
                    if on_disk_payload is None:
                        # Reservation-before-append crash: the same canonical
                        # payload owns the reservation and may safely resume.
                        self._append_raw_with_interprocess_lock_locked(
                            line + "\n",
                            require_durability=True,
                        )
                        on_disk_payload = self._trajectory_payload_on_disk_locked(key)
                        if on_disk_payload != payload_digest:
                            raise JournalTransactionError(
                                "trajectory retry append could not be verified"
                            )
                        self._append_trajectory_dedupe_record_locked(
                            key_digest,
                            "committed",
                            payload_digest,
                        )
                        self._mirror_event_effects(durable_event)
                        return True, durable_event

                    # Crash after journal fsync but before ledger commit. A
                    # fresh fsync makes recovery safe even when the original
                    # worker observed an fsync error after its append.
                    self._fsync_journal_data_locked()
                    self._append_trajectory_dedupe_record_locked(
                        key_digest,
                        "committed",
                        payload_digest,
                    )
                    return False, durable_event

                if on_disk_payload is not None:
                    # Backfill trajectories written before the durable ledger
                    # was introduced so rotation cannot erase their dedupe
                    # evidence later.
                    self._fsync_journal_data_locked()
                    self._append_trajectory_dedupe_record_locked(
                        key_digest,
                        "committed",
                        payload_digest,
                    )
                    return False, durable_event

                # Reserve first. If the process dies during the following
                # journal append, a later worker resumes only this exact
                # canonical payload.
                self._append_trajectory_dedupe_record_locked(
                    key_digest,
                    "reserved",
                    payload_digest,
                )
                self._append_raw_with_interprocess_lock_locked(
                    line + "\n",
                    require_durability=True,
                )
                if self._trajectory_payload_on_disk_locked(key) != payload_digest:
                    raise JournalTransactionError("trajectory append could not be verified")
                self._append_trajectory_dedupe_record_locked(
                    key_digest,
                    "committed",
                    payload_digest,
                )
                self._mirror_event_effects(durable_event)
                return True, durable_event

    def _mirror_event_effects(self, event: JournalEvent) -> None:
        """Best-effort side mirrors (audit chain + trace store) for one event.

        Runs at flush time so the chain's order matches the file's line
        order. A mirror failure must NOT take down the journal write
        path (which is on every step).
        """
        if self._audit_chain is not None:
            try:
                self._audit_chain.append(
                    kind=type(event).__name__,
                    payload={
                        "event_type": getattr(event, "event_type", None),
                        "ts": (
                            event.ts.isoformat()
                            if hasattr(event, "ts") and event.ts is not None
                            else None
                        ),
                    },
                )
            except Exception:  # noqa: BLE001 — audit mirror is best-effort; never break the hot write path
                import logging

                logging.getLogger(__name__).warning(
                    "journal %s: audit chain append failed",
                    self._path,
                )
        self._mirror_trace_event(event)

    def _flush_pending_chunks_locked(self) -> None:
        """Flush the buffered chunk run: one packed row, or verbatim lines.

        Caller must hold ``self._lock``. A run of ``>= MIN_RUN``
        consecutive chunks writes a single packed row (lossless on
        read); shorter runs fall back to per-event lines. Every member
        still gets its audit/trace mirror at flush time.
        """
        run = self._pending_chunk_run
        if not run:
            return
        self._pending_chunk_run = None
        if len(run) >= MIN_RUN:
            # Packed rows are storage envelopes rather than JournalEvent
            # models. Canonicalize every member first, then repack the exact
            # validated events. This gives chunk deltas the same structured
            # string redaction as ordinary rows without ever running regexes
            # across the packed JSON schema or its numeric timestamp arrays.
            durable_events: list[JournalEvent] = []
            durable_entries: list[dict[str, Any]] = []
            for _entry, event in run:
                durable_event, _line = self._canonicalize_event_locked(event)
                durable_entry = classify_chunk(durable_event)
                if durable_entry is None or (
                    durable_entries and not continues_chunk_run(durable_entries[-1], durable_entry)
                ):
                    # A redactor changed a packability discriminator. Persist
                    # the members independently rather than weakening the
                    # lossless codec's run invariant.
                    for _fallback_entry, fallback_event in run:
                        self._append_event_locked(fallback_event)
                    return
                durable_events.append(durable_event)
                durable_entries.append(durable_entry)

            row = pack_chunk_row(durable_entries)
            line = json.dumps(row, ensure_ascii=False)
            self._append_raw_locked(line + "\n")
            for event in durable_events:
                self._mirror_event_effects(event)
        else:
            for _entry, event in run:
                self._append_event_locked(event)

    def _mirror_trace_event(self, event: JournalEvent) -> None:
        if self._trace_store is None:
            return
        try:
            payload = event.model_dump(mode="json")
            task_id = str(event.task_id) if event.task_id is not None else None
            thread_id = str(event.conversation_id or "") or None
            agent_id = str(event.agent_id or "") or None
            ts = event.ts.isoformat() if event.ts is not None else None
            self._trace_store.record_event(
                event_type=str(event.event_type),
                payload=payload,
                thread_id=thread_id,
                task_id=task_id,
                agent_id=agent_id,
                tenant_id=str(event.tenant_id or "") or None,
                owner_actor_id=str(event.owner_actor_id or event.actor or "") or None,
                ts=ts,
            )
            if isinstance(event, TokenUsageEvent):
                self._trace_store.record_token_usage(
                    task_id=task_id,
                    thread_id=thread_id,
                    agent_id=agent_id,
                    iteration=event.iteration,
                    model=event.model,
                    input_tokens=event.input_tokens,
                    output_tokens=event.output_tokens,
                    cost_usd=event.cost_usd,
                    tenant_id=str(event.tenant_id or "") or None,
                    owner_actor_id=str(event.owner_actor_id or event.actor or "") or None,
                    ts=ts,
                )
            elif isinstance(event, ReactCheckpointEvent):
                self._trace_store.record_checkpoint(
                    task_id=str(event.task_id or ""),
                    thread_id=thread_id,
                    agent_id=agent_id,
                    checkpoint_type="react",
                    iteration=event.iteration_completed,
                    summary=event.progress_summary,
                    state={
                        "iteration_completed": event.iteration_completed,
                        "max_iterations": event.max_iterations,
                        "messages_snapshot": event.messages_snapshot,
                        "steps_snapshot": event.steps_snapshot,
                        "has_final_answer": event.has_final_answer,
                        "final_answer": event.final_answer,
                        "working_set_snapshot": event.working_set_snapshot,
                        "progress_summary": event.progress_summary,
                        "current_phase": event.current_phase,
                    },
                    tenant_id=str(event.tenant_id or "") or None,
                    owner_actor_id=str(event.owner_actor_id or event.actor or "") or None,
                    ts=ts,
                )
            elif isinstance(event, TaskCheckpointEvent):
                self._trace_store.record_checkpoint(
                    task_id=str(event.task_id or ""),
                    thread_id=thread_id,
                    agent_id=agent_id,
                    checkpoint_type="task",
                    iteration=event.nodes_completed,
                    summary=f"{event.nodes_completed}/{event.total_nodes} nodes",
                    state={
                        "nodes_completed": event.nodes_completed,
                        "total_nodes": event.total_nodes,
                        "tokens_spent": event.tokens_spent,
                        "usd_spent": event.usd_spent,
                    },
                    tenant_id=str(event.tenant_id or "") or None,
                    owner_actor_id=str(event.owner_actor_id or event.actor or "") or None,
                    ts=ts,
                )
        except Exception:  # noqa: BLE001
            import logging

            logging.getLogger(__name__).debug(
                "journal %s: trace mirror failed",
                self._path,
                exc_info=True,
            )

    def read_all(self, *, scope: TenantScope | None = None) -> list[JournalEvent]:
        with self._lock:
            # Make buffered chunk runs visible to readers: flush them to
            # disk first so the cache is always a complete prefix.
            self._flush_pending_chunks_locked()
            if not self._path.exists():
                # File gone entirely → reset cache (a fresh file may
                # appear later and we want to parse it from scratch).
                self._cache = []
                self._cache_byte_pos = 0
                return []

            file_size = self._path.stat().st_size
            if file_size == self._cache_byte_pos:
                # Nothing new — hand back cached list (shallow copy so
                # caller mutations don't poison the cache).
                events = list(self._cache)
                return [event for event in events if self._visible(event, scope)]
            if file_size < self._cache_byte_pos:
                # File shrank (manual truncate / rotation) → invalidate.
                self._cache = []
                self._cache_byte_pos = 0
                self._skipped_total = 0

            # Read only the tail that's new since last parse. Using
            # binary mode + seek avoids decoder issues when a multi-byte
            # char straddles a read boundary — we read to the current
            # end-of-file which always aligns to a line boundary in
            # append-only usage.
            with self._path.open("rb") as f:
                f.seek(self._cache_byte_pos)
                new_bytes = f.read()
                new_pos = self._cache_byte_pos + len(new_bytes)

            new_text = new_bytes.decode("utf-8", errors="replace")
            for _lineno_offset, raw in enumerate(new_text.splitlines(), 1):
                line = raw.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if is_chunk_row(data):
                        # Packed storage row (dsh chunk-rows): expand to the
                        # exact original events, same ids and timestamps.
                        for event_data in expand_chunk_row(data):
                            self._cache.append(_parse_event_data(event_data))
                    else:
                        self._cache.append(_parse_event(line))
                except (json.JSONDecodeError, TypeError, ValueError) as exc:
                    self._skipped_total += 1
                    if self._skipped_total == 1:
                        import logging

                        logging.getLogger(__name__).warning(
                            "journal %s: unparseable event %s at "
                            "byte ~%d · skipping (and any subsequent)",
                            self._path,
                            type(exc).__name__,
                            self._cache_byte_pos,
                        )
            self._cache_byte_pos = new_pos
            events = list(self._cache)
            return [event for event in events if self._visible(event, scope)]

    def read_by_session(self, session_id: str) -> list[JournalEvent]:
        # Ensure the parsed cache includes the latest file tail (read_all
        # flushes pending chunk runs and reads only the new delta).
        self.read_all()
        with self._lock:
            events = list(self._cache)
            if self._session_index_upto > len(events):
                # File rotated/truncated — the old offsets are stale; rebuild.
                self._session_index = {}
                self._session_index_upto = 0
            _refresh_session_index(self._session_index, events, self._session_index_upto)
            self._session_index_upto = len(events)
            return list(self._session_index.get(session_id, ()))

    def __len__(self) -> int:
        # Event count, not line count: a packed chunk row is one line but
        # N events. ``read_all`` flushes the pending run, so this is exact.
        return len(self.read_all())
