"""Inspect, apply, and reconcile isolated candidate patches under host control.

An engine may return a patch hash, but it never chooses the patch path, source
workspace, baseline, backup location, or file ownership.  Those coordinates
come from the authenticated turn's append-only handoff journal.  Application
is a write-ahead transaction: journal and lease the complete file set, apply
once, verify exact bytes, and either commit or restore byte-for-byte backups.
"""

from __future__ import annotations

import threading
from typing import Any
from uuid import uuid4

from runtime.execution.misc.file_write_leases import (
    transfer_file_write_leases,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _MAX_BACKUP_BYTES as _MAX_BACKUP_BYTES,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _MAX_CHANGED_FILES as _MAX_CHANGED_FILES,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _MAX_FILE_BYTES as _MAX_FILE_BYTES,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _MISSING_MODE as _MISSING_MODE,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _REGULAR_MODES as _REGULAR_MODES,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _SETTLED_PHASES as _SETTLED_PHASES,
)
from runtime.execution.subagents.candidate_patch_apply import (  # noqa: F401  re-export: import sites stay stable
    CandidateAnalysis as CandidateAnalysis,
)
from runtime.execution.subagents.candidate_patch_apply import (
    CandidateChange as CandidateChange,
)
from runtime.execution.subagents.candidate_patch_apply import (
    CandidatePatchError as CandidatePatchError,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _analyze_export as _analyze_export,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _artifact_root as _artifact_root,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _candidate_storage as _candidate_storage,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _capture_fingerprint as _capture_fingerprint,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _clean_fingerprint as _clean_fingerprint,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _create_backups as _create_backups,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _declared_write_allowed as _declared_write_allowed,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _find_export as _find_export,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _find_inspection as _find_inspection,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _find_start as _find_start,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _index_entries as _index_entries,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _inspection_candidate as _inspection_candidate,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _inspection_receipt as _inspection_receipt,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _latest_inspection_operation as _latest_inspection_operation,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _lock_target as _lock_target,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _mode_matches as _mode_matches,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _parse_tree_changes as _parse_tree_changes,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _records as _records,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _require_host as _require_host,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _restore_old as _restore_old,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _rollback as _rollback,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _safe_error as _safe_error,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _same_path as _same_path,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _settle as _settle,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _state as _state,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _trusted_source as _trusted_source,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _valid_git_oid as _valid_git_oid,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _valid_sha256 as _valid_sha256,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _validate_baseline as _validate_baseline,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _validate_fingerprint as _validate_fingerprint,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _validate_inspection_link as _validate_inspection_link,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _validate_operation_changes as _validate_operation_changes,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _validate_patch_reference as _validate_patch_reference,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _validate_relative_path as _validate_relative_path,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _validate_target as _validate_target,
)
from runtime.execution.subagents.candidate_patch_apply import (
    _write_reconciliation_required as _write_reconciliation_required,
)
from runtime.execution.subagents.isolated_worktree import _git
from runtime.execution.subagents.worktree_loop import _cap_diff
from runtime.platform.io.atomic import _cross_process_lock
from runtime.platform.process.session import Session
from runtime.safety.approval.cancellation import current_cancellation_token

_PROJECT_APPLY_LOCK = threading.RLock()


def inspect_candidate_patch(
    candidate_sha256: str,
    *,
    session: Session | None = None,
) -> dict[str, Any]:
    """Verify a host-exported patch and issue an opaque inspection id."""

    try:
        host, task, recorder = _require_host(session)
        digest = _valid_sha256(candidate_sha256, label="candidate hash")
        export = _find_export(_records(recorder), digest)
        analysis = _analyze_export(host, task, export, require_write=False)
        inspection_id = "inspection-" + uuid4().hex
        receipt = _inspection_receipt(analysis, inspection_id)
        recorder.write(receipt)
        return {
            "ok": True,
            "status": "inspected",
            "inspection_id": inspection_id,
            "candidate_sha256": digest,
            "contract_valid": analysis.contract_valid,
            "requires_invalid_contract_ack": not analysis.contract_valid,
            "files": [change.relative_path for change in analysis.changes],
            "changes": [
                {
                    "path": change.relative_path,
                    "status": change.status,
                    "before_sha256": (change.before or {}).get("sha256"),
                    "after_sha256": (change.expected_after or {}).get("sha256"),
                }
                for change in analysis.changes
            ],
            "diff": _cap_diff(analysis.patch_path.read_text(encoding="utf-8", errors="replace")),
        }
    except Exception as exc:  # noqa: BLE001 — tool returns a bounded rejection
        return {"ok": False, "status": "rejected", "error": _safe_error(exc)}


def apply_candidate_patch(
    inspection_id: str,
    *,
    allow_invalid_contract: bool = False,
    session: Session | None = None,
) -> dict[str, Any]:
    """Apply one inspected patch transactionally; never accepts a model path."""

    try:
        host, task, recorder = _require_host(session)
        if not isinstance(inspection_id, str) or not inspection_id.startswith("inspection-"):
            raise CandidatePatchError("inspection id is invalid")
        source = _trusted_source(host, task, write=True)
        remaining = task.resources.remaining_seconds()
        lock_timeout = min(10.0, remaining) if remaining is not None else 10.0
        with (
            _PROJECT_APPLY_LOCK,
            _cross_process_lock(_lock_target(source), required=True, timeout_s=lock_timeout),
        ):
            records = _records(recorder)
            inspection = _find_inspection(records, inspection_id)
            existing = _latest_inspection_operation(records, inspection_id)
            if existing is not None:
                start, outcome = existing
                if outcome is not None and outcome.get("phase") == "patch_applied":
                    return {
                        "ok": True,
                        "status": "already_applied",
                        "operation_id": start.get("operation_id"),
                        "inspection_id": inspection_id,
                    }
                if outcome is None:
                    return {
                        "ok": False,
                        "status": "reconciliation_required",
                        "operation_id": start.get("operation_id"),
                        "inspection_id": inspection_id,
                        "error": "a prior apply attempt must be reconciled first",
                    }

            digest = _inspection_candidate(inspection)
            export = _find_export(records, digest)
            analysis = _analyze_export(host, task, export, require_write=True)
            _validate_inspection_link(inspection, analysis)
            if not analysis.contract_valid and allow_invalid_contract is not True:
                raise CandidatePatchError(
                    "candidate failed its declared output contract; set "
                    "allow_invalid_contract=true only after reviewing the diff"
                )
            task.resources.remaining_seconds()
            current_cancellation_token().throw_if_cancelled()

            artifact_root = _artifact_root(host, task)
            storage = _candidate_storage(artifact_root)
            operation_id = "patch-" + uuid4().hex
            operation_root = _create_backups(storage, operation_id, analysis.changes)
            before = {change.path: dict(change.before or {}) for change in analysis.changes}
            start = {
                "phase": "patch_apply_started",
                "operation_id": operation_id,
                "inspection_id": inspection_id,
                "candidate_sha256": analysis.candidate_sha256,
                "parent_task_id": task.task_id,
                "source_workspace": str(analysis.source),
                "baseline_commit": analysis.baseline,
                "baseline_ref": analysis.baseline_ref,
                "patch": dict(analysis.patch_ref),
                "contract_valid": analysis.contract_valid,
                "allow_invalid_contract": allow_invalid_contract is True,
                "backup_root": str(operation_root),
                "changes": [change.to_receipt() for change in analysis.changes],
            }
            transfer_file_write_leases(
                host,
                before,
                from_owner=task.task_id,
                to_owner=operation_id,
                allow_unowned=True,
                before_transfer=lambda: recorder.write(start),
            )
            try:
                if analysis.changes:
                    _git(
                        analysis.source,
                        "apply",
                        "--binary",
                        "--whitespace=nowarn",
                        str(analysis.patch_path),
                        cleanup=True,
                    )
                states = {change.relative_path: _state(change) for change in analysis.changes}
                if any(state != "new" for state in states.values()):
                    raise CandidatePatchError(
                        f"candidate application verification failed: {states}"
                    )
                _settle(
                    host,
                    task,
                    recorder,
                    operation_id=operation_id,
                    inspection_id=inspection_id,
                    candidate_sha256=analysis.candidate_sha256,
                    changes=analysis.changes,
                    phase="patch_applied",
                    allow_unowned=False,
                )
                return {
                    "ok": True,
                    "status": "applied",
                    "operation_id": operation_id,
                    "inspection_id": inspection_id,
                    "candidate_sha256": analysis.candidate_sha256,
                    "files": [change.relative_path for change in analysis.changes],
                }
            except Exception as exc:  # noqa: BLE001 — effects require rollback/reconciliation
                return _rollback(
                    host,
                    task,
                    recorder,
                    operation_id=operation_id,
                    inspection_id=inspection_id,
                    candidate_sha256=analysis.candidate_sha256,
                    changes=analysis.changes,
                    reason=_safe_error(exc),
                    allow_unowned=False,
                )
    except Exception as exc:  # noqa: BLE001 — tool returns a bounded rejection
        return {"ok": False, "status": "rejected", "error": _safe_error(exc)}


def reconcile_candidate_patch(
    operation_id: str,
    *,
    session: Session | None = None,
) -> dict[str, Any]:
    """Settle a started apply from durable coordinates after interruption."""

    try:
        host, task, recorder = _require_host(session)
        if not isinstance(operation_id, str) or not operation_id.startswith("patch-"):
            raise CandidatePatchError("operation id is invalid")
        source = _trusted_source(host, task, write=True)
        remaining = task.resources.remaining_seconds()
        lock_timeout = min(10.0, remaining) if remaining is not None else 10.0
        with (
            _PROJECT_APPLY_LOCK,
            _cross_process_lock(_lock_target(source), required=True, timeout_s=lock_timeout),
        ):
            records = _records(recorder)
            start = _find_start(records, operation_id)
            for row in reversed(records):
                if row.get("operation_id") != operation_id:
                    continue
                if row.get("phase") == "patch_applied":
                    return {
                        "ok": True,
                        "status": "already_applied",
                        "operation_id": operation_id,
                    }
                if row.get("phase") == "patch_apply_rolled_back":
                    return {
                        "ok": True,
                        "status": "already_rolled_back",
                        "operation_id": operation_id,
                    }

            if start.get("source_workspace") != str(source):
                raise CandidatePatchError("candidate operation belongs to a different project")
            digest = _valid_sha256(start.get("candidate_sha256"), label="operation candidate hash")
            _validate_baseline(source, start)
            artifact_root = _artifact_root(host, task)
            storage = _candidate_storage(artifact_root)
            _validate_patch_reference(start.get("patch"), task=task, artifact_root=artifact_root)
            changes = _validate_operation_changes(
                host,
                task,
                start,
                source,
                artifact_root,
                storage,
            )
            inspection_id = str(start.get("inspection_id") or "")
            states = {change.relative_path: _state(change) for change in changes}
            if all(state == "new" for state in states.values()):
                _settle(
                    host,
                    task,
                    recorder,
                    operation_id=operation_id,
                    inspection_id=inspection_id,
                    candidate_sha256=digest,
                    changes=changes,
                    phase="patch_applied",
                    allow_unowned=True,
                    reason="reconciled from durable transaction coordinates",
                )
                return {"ok": True, "status": "applied", "operation_id": operation_id}
            return _rollback(
                host,
                task,
                recorder,
                operation_id=operation_id,
                inspection_id=inspection_id,
                candidate_sha256=digest,
                changes=changes,
                reason="reconciled an interrupted candidate application",
                allow_unowned=True,
            )
    except Exception as exc:  # noqa: BLE001 — tool returns a bounded rejection
        return {"ok": False, "status": "rejected", "error": _safe_error(exc)}


__all__ = [
    "CandidatePatchError",
    "apply_candidate_patch",
    "inspect_candidate_patch",
    "reconcile_candidate_patch",
]
