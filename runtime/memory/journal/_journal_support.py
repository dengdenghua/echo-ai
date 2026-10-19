"""Shared low-level helpers for the JSONL journal (lock, fsync, dedupe).

Lives below ``journal`` and ``_jsonl_journal_streams`` so both can import it
without a cycle.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from runtime.memory.journal._journal_models import JournalEvent, TrajectoryEvent


def _lock_windows_fd(fd: int, mode_name: str) -> None:
    """Call the Windows-only ``msvcrt.locking`` API without making POSIX
    type-checking depend on attributes absent from its platform stubs."""

    import msvcrt

    namespace = vars(msvcrt)
    namespace["locking"](fd, namespace[mode_name], 1)


def _fsync_parent_directory(
    path: Path,
    *,
    require_durability: bool,
    transaction_label: str,
) -> None:
    """Persist a file creation or rename in its parent directory on POSIX.

    ``fsync(file)`` makes file contents durable but does not commit a newly
    created directory entry or a later ``replace``. Atomic trajectory writes
    therefore use this helper before advancing their durable dedupe ledger.

    Python does not expose a portable Windows directory-handle fsync. Windows
    retains the existing file-handle flush/atomic-replace guarantee here; a
    stronger power-loss guarantee would require a native ``CreateFileW`` /
    ``FlushFileBuffers`` directory-handle implementation. Ordinary telemetry
    remains best-effort on every platform, while POSIX atomic transactions
    fail closed if the directory barrier cannot be established.
    """

    import os as _os

    if _os.name != "posix":
        return
    flags = _os.O_RDONLY | getattr(_os, "O_DIRECTORY", 0)
    try:
        directory_fd = _os.open(path.parent, flags)
    except OSError as exc:
        if require_durability:
            raise JournalTransactionError(
                f"cannot open durable {transaction_label} directory"
            ) from exc
        return
    try:
        _os.fsync(directory_fd)
    except OSError as exc:
        if require_durability:
            raise JournalTransactionError(
                f"cannot fsync durable {transaction_label} directory"
            ) from exc
    finally:
        with contextlib.suppress(OSError):
            _os.close(directory_fd)


# ═══════════════════════════════════════════════════════════
# journal.py · concrete journal implementations.
#
#   §1  InMemoryJournal                                  ~L85
#   §2  JSONLJournal (file-backed, the production impl)  ~L108
#
# Shared building blocks live in sibling submodules:
#   - _journal_models.py — JournalEventType, CURRENT_SCHEMA_VERSION,
#     and every per-event-type Pydantic model (StepEvent, ...).
#   - _journal_base.py   — the abstract ``Journal`` base + all
#     ``write_*`` convenience methods.
#   - _journal_parse.py  — ``_EVENT_CLASSES``, ``_migrate_event``,
#     ``_parse_event`` (schema migration + JSONL parsing).
#
# All public names are re-exported here so ``from
# runtime.memory.journal.journal import ...`` keeps working.
# ═══════════════════════════════════════════════════════════


def _refresh_session_index(
    index: dict[str, list[JournalEvent]],
    events: list[JournalEvent],
    upto: int,
) -> None:
    """Extend a per-session index with events past ``upto`` (audit P-04)."""
    for event in events[upto:]:
        sid = str(getattr(event, "session_id", "") or "")
        if sid:
            index.setdefault(sid, []).append(event)


class JournalTransactionError(RuntimeError):
    """A durable journal transaction could not be established or verified."""


class TrajectoryConflictError(JournalTransactionError):
    """One idempotency key was reused for a different terminal payload."""


@dataclass(frozen=True)
class _TrajectoryDedupeState:
    state: str
    payload_digest: str | None


def _trajectory_dedupe_key(event: TrajectoryEvent) -> tuple[str, str, str, str]:
    """Return the exact ownership-scoped identity of one trajectory sample."""

    envelope_task_id = event.task_id
    trajectory_task_id = event.trajectory.task_id
    if envelope_task_id is not None and str(envelope_task_id) != str(trajectory_task_id):
        raise ValueError("trajectory event task_id does not match trajectory.task_id")
    task_id = str(envelope_task_id or trajectory_task_id)
    strategy_id = str(event.trajectory.strategy_id or "default")
    tenant_id = str(event.tenant_id or "")
    owner_actor_id = str(event.owner_actor_id or "")
    return task_id, strategy_id, tenant_id, owner_actor_id


def _trajectory_dedupe_digest(key: tuple[str, str, str, str]) -> str:
    """Hash an ownership key so the durable ledger does not expose identities."""

    canonical = json.dumps(key, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _trajectory_payload_digest(event: TrajectoryEvent) -> str:
    """Hash the canonical, durable terminal semantics for conflict checks.

    Envelope/trajectory UUIDs and wall-clock timestamps are deliberately
    excluded: independent workers finalizing the same task manufacture those
    locally. Terminal outcome, ordered steps, cost (except nondeterministic
    latency), ownership scope, agent and conversation remain bound to the
    reservation, so a success/failure or payload mismatch fails closed.
    """

    payload = event.model_dump(mode="json")
    payload.pop("event_id", None)
    payload.pop("ts", None)
    trajectory = payload.get("trajectory")
    if isinstance(trajectory, dict):
        trajectory.pop("trajectory_id", None)
        trajectory.pop("started_at", None)
        trajectory.pop("completed_at", None)
        steps = trajectory.get("steps")
        if isinstance(steps, list):
            for step in steps:
                if not isinstance(step, dict):
                    continue
                result = step.get("result")
                if not isinstance(result, dict) or result.get("execution_source") != (
                    "native_bridge_preflight"
                ):
                    continue
                # Bridge/preflight attempts never cross ToolExecutor, so their
                # receipt models manufacture local UUIDs and timestamps while
                # assembling the terminal aggregate.  Those values differ when
                # another worker reconstructs the same reserved attempt after a
                # crash; the provider ordinal/node, action args and typed result
                # below remain the durable semantic identity.
                step.pop("ts", None)
                action = step.get("action")
                if isinstance(action, dict):
                    action.pop("call_id", None)
                    action.pop("ts", None)
                result.pop("call_id", None)
                result.pop("ts", None)
        outcome = trajectory.get("outcome")
        if isinstance(outcome, dict):
            cost = outcome.get("cost")
            if isinstance(cost, dict):
                cost.pop("latency_ms", None)
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
