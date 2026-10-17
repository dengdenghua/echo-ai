"""GEPA winner proposal recording: gates, typed candidate, ledger and canary."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from runtime.safety.auth.scope import TenantScope, tenant_scoped_path
from runtime.safety.evolution.canary import CanaryManager
from runtime.safety.evolution.candidate_registry import (
    CandidateRegistry,
    CandidateStatus,
    EvolutionCandidate,
)
from runtime.safety.evolution.proposal_ledger import ProposalLedger
from runtime.safety.recovery._gepa_helpers import (
    _candidate_llm_replay_summary,
    _candidate_replay_summary,
    _candidate_sandbox_replay_summary,
    _candidate_turn_replay_summary,
    _winner_canary_key,
)
from runtime.safety.recovery.evolution_constraints import (
    EvolutionConstraintValidator,
    serialize_constraint_results,
)
from runtime.safety.recovery.native_evolution_eval import score_candidate_native

if TYPE_CHECKING:
    from runtime.safety.evolution.canary import CanaryConfig
    from runtime.safety.recovery.gepa_optimizer import GepaResult
    from runtime.safety.recovery.native_llm_replay import LLMReplayReport
    from runtime.safety.recovery.native_replay import ReplayReport
    from runtime.safety.recovery.native_replay_sandbox import SandboxReplayReport
    from runtime.safety.recovery.native_turn_replay import TurnReplayReport


def _record_gepa_candidate(
    *,
    ledger_path: Any,
    recipe_id: str | None,
    prompt: str,
    optimizer_candidate_id: str,
    avg_score: float,
    native_score: dict[str, Any],
    replay_summary: dict[str, Any] | None,
    sandbox_replay_summary: dict[str, Any] | None,
    turn_replay_summary: dict[str, Any] | None,
    llm_replay_summary: dict[str, Any] | None,
    failures: list[dict[str, Any]] | None,
    metadata: dict[str, Any],
    tenant_scope: TenantScope | None = None,
) -> EvolutionCandidate:
    """Project a GEPA winner into the authoritative typed candidate registry."""

    registry_path = Path(ledger_path).expanduser().parent / "evolution_candidates.jsonl"
    if tenant_scope is not None:
        registry_path = tenant_scoped_path(registry_path, tenant_scope)
    registry = CandidateRegistry(registry_path, tenant_scope=tenant_scope)
    scope = recipe_id or "__global__"
    candidate = registry.propose(
        gene_type="prompt",
        scope=f"planner.prompt:{scope}",
        patch={"op": "replace", "target": scope, "value": prompt},
        proposer="gepa",
        lineage_id=f"gepa:{scope}",
        role_id="general",
        task_domain=f"planner:{scope}",
        risk_level="medium",
        source_failures=list(
            dict.fromkeys(
                str(row.get("failure_cluster") or row.get("failure_source") or "").strip()
                for row in failures or []
                if str(row.get("failure_cluster") or row.get("failure_source") or "").strip()
            )
        ),
        metadata={
            **metadata,
            "optimizer_candidate_id": optimizer_candidate_id,
            "legacy_proposal_ledger": str(ledger_path),
        },
        tenant_id=tenant_scope.tenant_id if tenant_scope is not None else None,
        owner_actor_id=tenant_scope.actor_id if tenant_scope is not None else None,
    )
    gates = {
        "constraints": True,
        "native_score": str(native_score.get("verdict") or "") != "reject",
        "native_replay": replay_summary is not None,
        "sandbox_replay": sandbox_replay_summary is not None,
        "turn_replay": turn_replay_summary is not None,
    }
    metrics = {"optimizer_avg_score": avg_score}
    for name, summary in (
        ("native_replay", replay_summary),
        ("sandbox_replay", sandbox_replay_summary),
        ("turn_replay", turn_replay_summary),
        ("llm_replay", llm_replay_summary),
    ):
        value = (summary or {}).get("total")
        if isinstance(value, (int, float)):
            metrics[name] = float(value)
    candidate = registry.record_evidence(
        candidate.candidate_id,
        hard_gate_results=gates,
        metric_vector=metrics,
        metadata={
            "awaiting_gates": [name for name, passed in gates.items() if not passed],
            "next_stage": "structured_shadow" if all(gates.values()) else "native_validation",
        },
    )
    if candidate.status == CandidateStatus.PROPOSED and all(gates.values()):
        candidate = registry.transition(
            candidate.candidate_id,
            CandidateStatus.VALIDATED,
            metadata={"next_stage": "structured_shadow"},
        )
    return candidate


def record_winner_proposal_and_canary(
    result: GepaResult,
    *,
    recipe_id: str | None = None,
    trigger: str = "manual",
    ledger_path: Any = "data/proposal_ledger.jsonl",
    canary_config: CanaryConfig | None = None,
    run_ts: float | None = None,
    require_improvement: bool = True,
    min_score_delta: float = 1e-6,
    baseline_prompt: str | None = None,
    failures: list[dict[str, Any]] | None = None,
    positive_dataset: Any | None = None,
    replay_report: ReplayReport | None = None,
    sandbox_replay_report: SandboxReplayReport | None = None,
    turn_replay_report: TurnReplayReport | None = None,
    llm_replay_report: LLMReplayReport | None = None,
    min_replay_score: float = 0.48,
    min_sandbox_replay_score: float = 0.50,
    min_turn_replay_score: float = 0.50,
    min_llm_replay_score: float = 0.50,
    tenant_scope: TenantScope | None = None,
) -> dict[str, Any]:
    """Materialize the optimizer winner as an auditable proposal."""
    effective_ledger_path = (
        tenant_scoped_path(ledger_path, tenant_scope) if tenant_scope is not None else ledger_path
    )
    best = result.best_avg
    if best is None:
        return {"ok": False, "skipped": True, "reason": "no winner"}

    candidate_id = str(best.candidate_id)
    avg_score = float(best.avg_score)
    baseline_candidate_id: str | None = None
    baseline_score: float | None = None
    history = list(result.history or [])
    if history and isinstance(history[0], dict):
        baseline_candidate_id = str(history[0].get("candidate_id") or "") or None
        try:
            baseline_score = float(history[0].get("best_avg"))
        except (TypeError, ValueError):
            baseline_score = None
    is_seed_candidate = int(best.born_at_iter or 0) == 0 and (
        baseline_candidate_id is None or candidate_id == baseline_candidate_id
    )
    if require_improvement and (
        is_seed_candidate
        or (
            baseline_score is not None
            and avg_score <= baseline_score + max(0.0, float(min_score_delta))
        )
    ):
        return {
            "ok": False,
            "skipped": True,
            "reason": "no_improving_winner",
            "candidate_id": candidate_id,
            "avg_score": avg_score,
            "baseline_candidate_id": baseline_candidate_id,
            "baseline_score": baseline_score,
        }
    canary_key = _winner_canary_key(
        recipe_id=recipe_id,
        candidate_id=candidate_id,
    )
    prompt = str(best.prompt or "")
    constraint_results = EvolutionConstraintValidator().validate_prompt(
        prompt,
        baseline_prompt=baseline_prompt,
    )
    if not all(r.passed for r in constraint_results):
        return {
            "ok": False,
            "skipped": True,
            "reason": "constraint_violation",
            "candidate_id": candidate_id,
            "avg_score": avg_score,
            "constraint_results": serialize_constraint_results(constraint_results),
        }
    native_score = score_candidate_native(
        best,
        baseline_prompt=baseline_prompt,
        failures=failures,
        positive_dataset=positive_dataset,
    )
    if native_score.verdict == "reject":
        return {
            "ok": False,
            "skipped": True,
            "reason": "native_score_rejected",
            "candidate_id": candidate_id,
            "avg_score": avg_score,
            "native_score": native_score.to_dict(),
        }
    replay_summary = _candidate_replay_summary(
        replay_report,
        candidate_id=candidate_id,
    )
    if replay_summary is not None and float(replay_summary.get("total") or 0.0) < max(
        0.0, min_replay_score
    ):
        return {
            "ok": False,
            "skipped": True,
            "reason": "native_replay_rejected",
            "candidate_id": candidate_id,
            "avg_score": avg_score,
            "native_score": native_score.to_dict(),
            "native_replay": replay_summary,
        }
    sandbox_replay_summary = _candidate_sandbox_replay_summary(
        sandbox_replay_report,
        candidate_id=candidate_id,
    )
    if sandbox_replay_summary is not None and float(
        sandbox_replay_summary.get("total") or 0.0
    ) < max(0.0, min_sandbox_replay_score):
        return {
            "ok": False,
            "skipped": True,
            "reason": "native_sandbox_replay_rejected",
            "candidate_id": candidate_id,
            "avg_score": avg_score,
            "native_score": native_score.to_dict(),
            "native_replay": replay_summary,
            "native_sandbox_replay": sandbox_replay_summary,
        }
    turn_replay_summary = _candidate_turn_replay_summary(
        turn_replay_report,
        candidate_id=candidate_id,
    )
    if turn_replay_summary is not None and float(turn_replay_summary.get("total") or 0.0) < max(
        0.0, min_turn_replay_score
    ):
        return {
            "ok": False,
            "skipped": True,
            "reason": "native_turn_replay_rejected",
            "candidate_id": candidate_id,
            "avg_score": avg_score,
            "native_score": native_score.to_dict(),
            "native_replay": replay_summary,
            "native_sandbox_replay": sandbox_replay_summary,
            "native_turn_replay": turn_replay_summary,
        }
    llm_replay_summary = _candidate_llm_replay_summary(
        llm_replay_report,
        candidate_id=candidate_id,
    )
    if llm_replay_summary is not None and float(llm_replay_summary.get("total") or 0.0) < max(
        0.0, min_llm_replay_score
    ):
        return {
            "ok": False,
            "skipped": True,
            "reason": "native_llm_replay_rejected",
            "candidate_id": candidate_id,
            "avg_score": avg_score,
            "native_score": native_score.to_dict(),
            "native_replay": replay_summary,
            "native_sandbox_replay": sandbox_replay_summary,
            "native_turn_replay": turn_replay_summary,
            "native_llm_replay": llm_replay_summary,
        }
    metadata = {
        "recipe_id": recipe_id,
        "trigger": trigger,
        "candidate_id": candidate_id,
        "avg_score": avg_score,
        "baseline_candidate_id": baseline_candidate_id,
        "baseline_score": baseline_score,
        "born_at_iter": int(best.born_at_iter or 0),
        "parent_id": best.parent_id,
        "rationale": str(best.rationale or "")[:500],
        "prompt_preview": prompt[:400],
        "prompt_length": len(prompt),
        "constraint_results": serialize_constraint_results(constraint_results),
        "native_score": native_score.to_dict(),
        "native_replay": replay_summary,
        "native_sandbox_replay": sandbox_replay_summary,
        "native_turn_replay": turn_replay_summary,
        "native_llm_replay": llm_replay_summary,
        "iterations_run": int(result.iterations_run or 0),
        "front_size": len(result.final_front or []),
        "run_ts": run_ts,
        "canary_key": canary_key,
    }
    evolution_candidate = _record_gepa_candidate(
        ledger_path=ledger_path,
        recipe_id=recipe_id,
        prompt=prompt,
        optimizer_candidate_id=candidate_id,
        avg_score=avg_score,
        native_score=native_score.to_dict(),
        replay_summary=replay_summary,
        sandbox_replay_summary=sandbox_replay_summary,
        turn_replay_summary=turn_replay_summary,
        llm_replay_summary=llm_replay_summary,
        failures=failures,
        metadata=metadata,
        tenant_scope=tenant_scope,
    )
    metadata["evolution_candidate_id"] = evolution_candidate.candidate_id
    metadata["evolution_candidate_status"] = evolution_candidate.status.value
    ledger = ProposalLedger(effective_ledger_path)
    for existing in reversed(
        ledger.query(
            kind="prompt_optimizer_winner",
            limit=200,
            scope=tenant_scope,
        )
    ):
        existing_metadata = existing.metadata if isinstance(existing.metadata, dict) else {}
        if (
            existing_metadata.get("recipe_id") == recipe_id
            and existing_metadata.get("candidate_id") == candidate_id
        ):
            state = CanaryManager(canary_config).register(
                canary_key,
                metadata={
                    "proposal_id": existing.proposal_id,
                    "proposal_kind": existing.kind,
                    "recipe_id": recipe_id,
                    "candidate_id": candidate_id,
                    "avg_score": avg_score,
                    "trigger": trigger,
                    "run_ts": run_ts,
                    "evolution_candidate_id": evolution_candidate.candidate_id,
                },
            )
            return {
                "ok": True,
                "skipped": True,
                "reason": "duplicate_winner",
                "proposal_id": existing.proposal_id,
                "proposal_kind": existing.kind,
                "proposal_status": existing.status.value,
                "canary_key": canary_key,
                "canary_phase": state.phase.value,
                "candidate_id": candidate_id,
                "avg_score": avg_score,
                "evolution_candidate_id": evolution_candidate.candidate_id,
                "evolution_candidate_status": evolution_candidate.status.value,
            }
    recipe_scope = recipe_id or "__global__"
    proposal = ledger.propose(
        kind="prompt_optimizer_winner",
        description=(
            f"Prompt optimizer winner {candidate_id} for {recipe_scope} avg_score={avg_score:.3f}"
        ),
        proposer="gepa_bridge",
        metadata=metadata,
        scope=tenant_scope,
    )
    canary_metadata = {
        "proposal_id": proposal.proposal_id,
        "proposal_kind": proposal.kind,
        "recipe_id": recipe_id,
        "candidate_id": candidate_id,
        "avg_score": avg_score,
        "trigger": trigger,
        "run_ts": run_ts,
        "evolution_candidate_id": evolution_candidate.candidate_id,
    }
    state = CanaryManager(canary_config).register(
        canary_key,
        metadata=canary_metadata,
    )
    return {
        "ok": True,
        "proposal_id": proposal.proposal_id,
        "proposal_kind": proposal.kind,
        "proposal_status": proposal.status.value,
        "canary_key": canary_key,
        "canary_phase": state.phase.value,
        "candidate_id": candidate_id,
        "avg_score": avg_score,
        "evolution_candidate_id": evolution_candidate.candidate_id,
        "evolution_candidate_status": evolution_candidate.status.value,
    }
