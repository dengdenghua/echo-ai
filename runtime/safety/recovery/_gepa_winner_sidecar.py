"""Applied GEPA winner sidecar, proposal apply marking and canary outcomes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from runtime.safety.evolution.canary import CanaryManager
from runtime.safety.evolution.proposal_ledger import ProposalLedger
from runtime.safety.recovery._gepa_helpers import (
    _split_recipe_scope,
    _winner_sidecar_path,
)

if TYPE_CHECKING:
    from runtime.safety.evolution.canary import CanaryConfig


def write_applied_winner_sidecar(
    *,
    recipe_id: str | None,
    candidate_id: str,
    proposal_id: str | None = None,
    canary_key: str | None = None,
    avg_score: float | None = None,
    variant_id: str | None = None,
    metadata_root: Any = None,
) -> dict[str, Any]:
    base_recipe_id, parsed_variant_id = _split_recipe_scope(recipe_id)
    effective_recipe_id = base_recipe_id or recipe_id
    effective_variant_id = variant_id if variant_id is not None else parsed_variant_id
    sidecar = _winner_sidecar_path(
        recipe_id=effective_recipe_id,
        variant_id=effective_variant_id,
        metadata_root=metadata_root,
    )
    payload = {
        "recipe_id": effective_recipe_id,
        "variant_id": effective_variant_id,
        "candidate_id": candidate_id,
        "proposal_id": proposal_id,
        "canary_key": canary_key,
        "avg_score": avg_score,
    }
    try:
        sidecar.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return {"ok": True, "path": str(sidecar), **payload}
    except (OSError, TypeError, ValueError) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", **payload}


def resolve_applied_winner_sidecar(
    recipe_hash: str | None,
    *,
    metadata_root: Any = None,
) -> dict[str, Any] | None:
    base_recipe_id, variant_id = _split_recipe_scope(recipe_hash)
    candidates: list[Path] = []
    if variant_id and variant_id != "__default__":
        candidates.append(
            _winner_sidecar_path(
                recipe_id=base_recipe_id,
                variant_id=variant_id,
                metadata_root=metadata_root,
            ),
        )
    if base_recipe_id:
        candidates.append(
            _winner_sidecar_path(
                recipe_id=base_recipe_id,
                metadata_root=metadata_root,
            ),
        )
    candidates.append(
        _winner_sidecar_path(
            recipe_id=None,
            metadata_root=metadata_root,
        ),
    )
    for path in candidates:
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and data.get("canary_key"):
            return data
    return None


def mark_winner_proposal_applied(
    *,
    recipe_id: str | None,
    candidate_id: str | None = None,
    variant_id: str | None = None,
    proposal_id: str | None = None,
    canary_key: str | None = None,
    ledger_path: Any = "data/proposal_ledger.jsonl",
    metadata_root: Any = None,
    fitness_after: float | None = None,
) -> dict[str, Any]:
    ledger = ProposalLedger(ledger_path)
    winner: Any | None = None
    target_base, target_variant = _split_recipe_scope(recipe_id)
    if proposal_id:
        for record in ledger.query(kind="prompt_optimizer_winner", limit=500):
            if record.proposal_id == proposal_id:
                winner = record
                break
    if winner is None:
        for record in reversed(ledger.query(kind="prompt_optimizer_winner", limit=500)):
            metadata = record.metadata if isinstance(record.metadata, dict) else {}
            record_base, record_variant = _split_recipe_scope(
                str(metadata.get("recipe_id") or "") or None,
            )
            if target_base is not None and record_base is not None:
                if target_base != record_base:
                    continue
                if (
                    target_variant is not None
                    and record_variant is not None
                    and target_variant != record_variant
                ):
                    continue
            elif recipe_id is not None and metadata.get("recipe_id") != recipe_id:
                continue
            if candidate_id is not None and metadata.get("candidate_id") != candidate_id:
                continue
            winner = record
            break
    if winner is None:
        return {"ok": False, "skipped": True, "reason": "winner_proposal_not_found"}

    applied = ledger.mark_applied(winner.proposal_id, fitness_after=fitness_after)
    metadata = (
        applied.metadata if applied is not None and isinstance(applied.metadata, dict) else {}
    )
    resolved_canary_key = canary_key or str(metadata.get("canary_key") or "")
    resolved_candidate_id = str(candidate_id or metadata.get("candidate_id") or "")
    resolved_recipe_id = recipe_id if recipe_id is not None else metadata.get("recipe_id")
    resolved_variant_id = variant_id if variant_id is not None else metadata.get("variant_id")
    sidecar = write_applied_winner_sidecar(
        recipe_id=resolved_recipe_id if isinstance(resolved_recipe_id, str) else None,
        candidate_id=resolved_candidate_id,
        proposal_id=winner.proposal_id,
        canary_key=resolved_canary_key or None,
        avg_score=(
            float(metadata.get("avg_score"))
            if isinstance(metadata.get("avg_score"), (int, float))
            else None
        ),
        variant_id=resolved_variant_id if isinstance(resolved_variant_id, str) else None,
        metadata_root=metadata_root,
    )
    return {
        "ok": True,
        "proposal_id": winner.proposal_id,
        "proposal_status": applied.status.value if applied is not None else winner.status.value,
        "canary_key": resolved_canary_key or None,
        "sidecar": sidecar,
        "candidate_id": resolved_candidate_id,
    }


def record_winner_canary_outcome(
    recipe_hash: str | None,
    *,
    success: bool,
    metadata_root: Any = None,
    canary_config: CanaryConfig | None = None,
) -> dict[str, Any]:
    metadata = resolve_applied_winner_sidecar(recipe_hash, metadata_root=metadata_root)
    if not metadata:
        return {"ok": False, "skipped": True, "reason": "no_applied_winner_sidecar"}
    canary_key = str(metadata.get("canary_key") or "").strip()
    if not canary_key:
        return {"ok": False, "skipped": True, "reason": "missing_canary_key"}
    state = CanaryManager(canary_config).record_outcome(canary_key, success=success)
    if state is None:
        return {
            "ok": False,
            "skipped": True,
            "reason": "canary_not_registered",
            "canary_key": canary_key,
        }
    return {
        "ok": True,
        "canary_key": canary_key,
        "phase": state.phase.value,
        "sample_count": state.sample_count,
        "success_count": state.success_count,
        "failure_count": state.failure_count,
        "current_rate": state.current_rate,
        "success": success,
    }
