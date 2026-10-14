"""Evidence, candidate, dual-helix shadow, and fitness endpoints for evolution.

Pure structural split of ``evolution_router.create_evolution_router`` — no
logic changes. Registration order is still owned by the factory. These groups read per-router state (tenant-scoped candidate
services, the experiment store, the shadow service) that the factory builds
once and hands over as an ``EvolutionRouterDeps`` bundle.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

try:
    from fastapi import APIRouter, HTTPException, Query, Request

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - create_evolution_router returns early
    FASTAPI_AVAILABLE = False

from runtime.sensing.gateway._evolution_models import (
    CandidateCanaryOutcomeBody,
    CandidateRollbackBody,
    DualHelixShadowRunBody,
    DualHelixShadowSettingsBody,
)


@dataclass(frozen=True)
class EvolutionRouterDeps:
    """Per-router state the factory builds once for the endpoint groups."""

    paths: Any
    experiment_store: Any
    shadow_service: Any
    candidate_runtime_selector: Any
    candidate_scope: Callable[..., Any]
    services_for_scope: Callable[[Any], list[tuple[Any, Any]]]
    service_for_candidate: Callable[[Any, str], tuple[Any, Any]]


def _register_evidence_routes(router: APIRouter, d: EvolutionRouterDeps) -> None:
    """Codex gap report plus dual-helix and controlled-experiment evidence."""
    paths = d.paths
    experiment_store = d.experiment_store

    @router.get("/codex-gap")
    def get_codex_gap() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.codex_gap import compute_codex_gap_report

            return {"ok": True, **compute_codex_gap_report()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/dual-helix/evidence")
    def get_dual_helix_evidence(
        limit: int = Query(default=20, ge=1, le=100),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.dual_helix import build_dual_helix_evidence
            from runtime.safety.evolution.experiment_protocol import build_pair_evidence
            from runtime.safety.evolution.proposal_ledger import ProposalLedger

            controlled = build_pair_evidence(
                experiment_store.list_trials(limit=10_000),
                limit=limit,
            )
            records = ProposalLedger(paths.proposal_ledger_path).query(limit=10_000)
            observational = build_dual_helix_evidence(records, limit=limit)
            # Preserve the legacy projection consumed by the current UI while
            # making its evidence level explicit.  Controlled experiments are
            # exposed alongside it and become authoritative as soon as trials
            # exist; arbitrary completed turns are never relabelled as trials.
            return {
                **observational,
                "evidence_quality": (
                    "controlled_same_task" if controlled["trial_count"] else "observational"
                ),
                "controlled": controlled,
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/experiments/evidence")
    def get_controlled_experiment_evidence(
        limit: int = Query(default=100, ge=1, le=1_000),
        primary_metric: str = Query(default="quality", min_length=1, max_length=80),
    ) -> dict[str, Any]:
        from runtime.safety.evolution.experiment_protocol import build_pair_evidence

        return build_pair_evidence(
            experiment_store.list_trials(limit=100_000),
            primary_metric=primary_metric,
            limit=limit,
        )


def _register_candidate_routes(router: APIRouter, d: EvolutionRouterDeps) -> None:
    """Candidate list plus canary status / register / outcome and rollback."""
    CandidateRuntimeSelector = d.candidate_runtime_selector  # noqa: N806 - class alias
    _candidate_scope = d.candidate_scope
    _services_for_scope = d.services_for_scope
    _service_for_candidate = d.service_for_candidate

    @router.get("/candidates")
    def get_evolution_candidates(
        request: Request,
        limit: int = Query(default=100, ge=1, le=1_000),
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        scope = _candidate_scope(request, cross_tenant=cross_tenant)
        rows: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for registry, manager in _services_for_scope(scope):
            for candidate in reversed(registry.list(limit=limit)):
                if candidate.candidate_id in seen_ids:
                    raise HTTPException(
                        409,
                        f"candidate id conflicts across tenant partitions: "
                        f"{candidate.candidate_id}",
                    )
                seen_ids.add(candidate.candidate_id)
                row = candidate.to_wire()
                try:
                    CandidateRuntimeSelector.validate_materializable(candidate)
                except ValueError:
                    row["runtime_consumer_ready"] = False
                else:
                    row["runtime_consumer_ready"] = True
                row["runtime_materialized"] = bool(manager.materialize_runtime)
                try:
                    row["canary"] = manager.status(candidate.candidate_id).get("canary")
                except (KeyError, OSError, TypeError, ValueError):
                    row["canary"] = None
                rows.append(row)
        rows.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
        rows = rows[:limit]
        by_status: dict[str, int] = {}
        by_gene_type: dict[str, int] = {}
        for row in rows:
            status = str(row.get("status") or "unknown")
            gene_type = str(row.get("gene_type") or "unknown")
            by_status[status] = by_status.get(status, 0) + 1
            by_gene_type[gene_type] = by_gene_type.get(gene_type, 0) + 1
        return {
            "ok": True,
            "schema": "echo.evolution.candidate_list.v1",
            "total": len(rows),
            "by_status": by_status,
            "by_gene_type": by_gene_type,
            "candidates": rows,
        }

    @router.get("/candidates/{candidate_id}/canary")
    def get_candidate_canary(
        request: Request,
        candidate_id: str,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        try:
            scope = _candidate_scope(request, cross_tenant=cross_tenant)
            _registry, manager = _service_for_candidate(scope, candidate_id)
            return manager.status(candidate_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from None
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None

    @router.post("/candidates/{candidate_id}/canary/register")
    def register_candidate_canary(
        request: Request,
        candidate_id: str,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        try:
            scope = _candidate_scope(request, cross_tenant=cross_tenant)
            _registry, manager = _service_for_candidate(scope, candidate_id)
            return manager.register(candidate_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from None
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None

    @router.post("/candidates/{candidate_id}/canary/outcome")
    def record_candidate_canary_outcome(
        request: Request,
        candidate_id: str,
        body: CandidateCanaryOutcomeBody,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        try:
            scope = _candidate_scope(request, cross_tenant=cross_tenant)
            _registry, manager = _service_for_candidate(scope, candidate_id)
            return manager.record_outcome(candidate_id, body.success)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from None
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None

    @router.post("/candidates/{candidate_id}/rollback")
    def rollback_candidate(
        request: Request,
        candidate_id: str,
        body: CandidateRollbackBody,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        try:
            scope = _candidate_scope(request, cross_tenant=cross_tenant)
            _registry, manager = _service_for_candidate(scope, candidate_id)
            return manager.force_rollback(candidate_id, reason=body.reason)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from None
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None


def _register_shadow_routes(router: APIRouter, d: EvolutionRouterDeps) -> None:
    """Dual-helix shadow status, settings, and queued shadow runs."""
    shadow_service = d.shadow_service

    @router.get("/dual-helix/shadow/status")
    def get_dual_helix_shadow_status() -> dict[str, Any]:
        if shadow_service is None:
            return {
                "ok": False,
                "enabled": False,
                "error": "dual-helix shadow service is unavailable",
                "runs": [],
            }
        return shadow_service.status()

    @router.post("/dual-helix/shadow/settings")
    def set_dual_helix_shadow_settings(
        body: DualHelixShadowSettingsBody,
    ) -> dict[str, Any]:
        if shadow_service is None:
            raise HTTPException(503, "dual-helix shadow service is unavailable")
        return shadow_service.set_enabled(body.enabled)

    @router.post("/dual-helix/shadow/run")
    async def run_dual_helix_shadow(
        body: DualHelixShadowRunBody,
    ) -> dict[str, Any]:
        if shadow_service is None:
            raise HTTPException(503, "dual-helix shadow service is unavailable")
        try:
            return {
                "ok": True,
                **shadow_service.queue(
                    goal=body.goal,
                    primary_engine=body.primary_engine,
                    primary_output=body.primary_output,
                    workspace_path=body.workspace_path or None,
                    source_thread_id=body.source_thread_id or None,
                    source_message_id=body.source_message_id or None,
                    candidate_id=body.candidate_id or None,
                    experiment_id=body.experiment_id or None,
                    automatic=body.automatic,
                    risk_level=body.risk_level or None,
                    failure_count=body.failure_count,
                    confidence=body.confidence,
                ),
            }
        except PermissionError as exc:
            raise HTTPException(409, str(exc)) from None
        except (OSError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from None


def _register_fitness_routes(router: APIRouter, d: EvolutionRouterDeps) -> None:
    """Observational, tenant-scoped fitness and drift reports."""
    _candidate_scope = d.candidate_scope

    @router.get("/fitness/{agent_id}")
    def get_fitness(
        request: Request,
        agent_id: str,
        window: int = Query(default=20, ge=5, le=100),
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        # Authorization errors must escape as their real 401/403 response;
        # do not turn them into a successful ``{"ok": false}`` payload.
        scope = _candidate_scope(request, cross_tenant=cross_tenant)
        try:
            from runtime.safety.evolution.fitness import FitnessConfig, compute_fitness

            # A GET must remain observational: publishing this freshly
            # computed score would let a dashboard refresh trigger automatic
            # evolution through the process event bus.
            report = compute_fitness(
                agent_id,
                FitnessConfig(window=window),
                publish_event=False,
                scope=scope,
            )
            return {
                "ok": True,
                "agent_id": report.agent_id,
                "ts": report.ts,
                "l1": {
                    "score": report.l1.score,
                    "trend": report.l1.trend,
                    "success_rate": report.l1.success_rate,
                    "avg_rounds": report.l1.avg_rounds,
                },
                "l2": {
                    "score": report.l2.score,
                    "dominant_failure": report.l2.dominant_failure,
                    "action": report.l2.action,
                    "confidence": report.l2.confidence,
                }
                if report.l2
                else None,
                "governance": {
                    "score": report.governance.score,
                    "penalty": report.governance.penalty,
                    "audit_total": report.governance.audit_total,
                    "recent_total": report.governance.recent_total,
                    "override_count": report.governance.override_count,
                    "gate_failed_count": report.governance.gate_failed_count,
                    "gate_blocked_override_count": (report.governance.gate_blocked_override_count),
                    "failed_apply_count": report.governance.failed_apply_count,
                    "reasons": report.governance.reasons,
                }
                if report.governance
                else None,
                "combined": report.combined,
                "verdict": report.verdict,
                "scope_mode": report.scope_mode,
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/drift/{agent_id}")
    def get_drift(
        request: Request,
        agent_id: str,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        scope = _candidate_scope(request, cross_tenant=cross_tenant)
        try:
            from runtime.safety.evolution.drift_monitor import DriftMonitor

            report = DriftMonitor(agent_id, scope=scope).check(publish_events=False)
            return {
                "ok": True,
                "agent_id": report.agent_id,
                "ts": report.ts,
                "has_drift": report.has_drift,
                "max_severity": report.max_severity,
                "scope_mode": report.scope_mode,
                "events": [
                    {"kind": e.kind, "severity": e.severity, "detail": e.detail}
                    for e in report.events
                ],
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
