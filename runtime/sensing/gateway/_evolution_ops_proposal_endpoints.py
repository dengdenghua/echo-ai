"""Skill, model, and MCP proposal endpoints for the evolution ops router.

Pure structural split of ``evolution_ops_router.create_evolution_ops_router``
— no logic changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading the factory's closures from ``EvolutionOpsDeps``; the
factory still owns the registration order.
"""

from __future__ import annotations

from typing import Any

try:
    from fastapi import APIRouter, Query, Request

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment,misc]
    Query = None  # type: ignore[assignment,misc]
    Request = None  # type: ignore[assignment,misc]

from ._evolution_ops_deps import EvolutionOpsDeps
from .evolution_ops import (
    _mcp_proposal_rows,
    _model_benchmark_rows,
    _model_payload,
    _skill_forge_candidates,
    _write_mcp_proposal_decision,
    _write_skill_proposal_decision,
)


def _register_skill_approval_routes(router: APIRouter, d: EvolutionOpsDeps) -> None:
    """Approve a forged skill proposal: shadow-validate, then promote or govern."""
    journal = d.journal
    registry = d.registry
    _require_actor = d.require_actor
    _tenant_scope = d.tenant_scope
    _require_forge_dependencies = d.require_forge_dependencies
    _suppressed_names = d.suppressed_names

    @router.post("/api/intel-evolution/skills/proposals/approve")
    def approve_skill_proposal(
        request: Request,
        body: dict[str, Any] | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scope = _tenant_scope(request, cross_tenant=cross_tenant)
        proposal_name = str((body or {}).get("name") or "").strip()
        if not proposal_name:
            return {"ok": False, "status": "missing_name", "proposal": body or {}}
        persist_dir = _require_forge_dependencies()

        try:
            from runtime.execution.suckers import SkillTestsFailed
            from runtime.safety.recovery.skill_forge import SkillForge
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": False,
                "status": "unavailable",
                "name": proposal_name,
                "error": str(exc),
            }

        candidates = _skill_forge_candidates(
            journal,
            registry,
            suppressed_names=_suppressed_names(scope),
            scope=scope,
        )
        candidate = next((c for c in candidates if c.name == proposal_name), None)
        if candidate is None:
            return {"ok": False, "status": "not_found", "name": proposal_name}

        try:
            forge = SkillForge(
                journal=journal,
                registry=registry,
                auto_persist_dir=persist_dir,
                scope=scope,
            )
            if scope is not None and not scope.allow_cross_tenant:
                governed_result = forge._forge_candidates([candidate])
                if governed_result.governed:
                    _write_skill_proposal_decision(
                        journal,
                        proposal_name=candidate.name,
                        candidate_id=candidate.candidate_id,
                        decision="governed",
                        reason=str((body or {}).get("reason") or ""),
                        details={
                            "underlying_sequence": candidate.underlying_sequence,
                            "evolution_candidates": governed_result.evolution_candidates,
                        },
                        scope=scope,
                    )
                    return {
                        "ok": True,
                        "status": "governed",
                        "name": candidate.name,
                        "candidate_id": candidate.candidate_id,
                        "promoted": [],
                        "governed": list(governed_result.governed),
                        "evolution_candidates": list(governed_result.evolution_candidates),
                    }
                if governed_result.quarantined:
                    return {
                        "ok": False,
                        "status": "quarantined",
                        "name": candidate.name,
                        "candidate_id": candidate.candidate_id,
                        "promoted": [],
                        "quarantined": list(governed_result.quarantined),
                    }
                _write_skill_proposal_decision(
                    journal,
                    proposal_name=candidate.name,
                    candidate_id=candidate.candidate_id,
                    decision="shadow_failed",
                    reason=str((body or {}).get("reason") or ""),
                    details={
                        "report": _model_payload(governed_result.reports.get(candidate.name)),
                    },
                    scope=scope,
                )
                return {
                    "ok": False,
                    "status": "shadow_failed",
                    "name": candidate.name,
                    "candidate_id": candidate.candidate_id,
                    "promoted": [],
                }
            passed, shadow_report = forge.shadow_validate(candidate)
            if not passed:
                _suppressed_names(scope).add(candidate.name)
                _write_skill_proposal_decision(
                    journal,
                    proposal_name=candidate.name,
                    candidate_id=candidate.candidate_id,
                    decision="shadow_failed",
                    reason=str((body or {}).get("reason") or ""),
                    details={
                        "report": _model_payload(shadow_report),
                        "underlying_sequence": candidate.underlying_sequence,
                    },
                    scope=scope,
                )
                return {
                    "ok": False,
                    "status": "shadow_failed",
                    "name": candidate.name,
                    "candidate_id": candidate.candidate_id,
                    "report": _model_payload(shadow_report),
                }

            promote_report = forge.promote_to_public(candidate)
            forge._maybe_persist(candidate)
        except SkillTestsFailed as exc:
            _suppressed_names(scope).add(candidate.name)
            _write_skill_proposal_decision(
                journal,
                proposal_name=candidate.name,
                candidate_id=candidate.candidate_id,
                decision="promote_failed",
                reason=str((body or {}).get("reason") or ""),
                details={"error": str(exc)},
                scope=scope,
            )
            return {
                "ok": False,
                "status": "promote_failed",
                "name": candidate.name,
                "candidate_id": candidate.candidate_id,
                "error": str(exc),
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": False,
                "status": "error",
                "name": candidate.name,
                "candidate_id": candidate.candidate_id,
                "error": str(exc),
            }

        _write_skill_proposal_decision(
            journal,
            proposal_name=candidate.name,
            candidate_id=candidate.candidate_id,
            decision="promoted",
            reason=str((body or {}).get("reason") or ""),
            details={
                "report": _model_payload(promote_report),
                "underlying_sequence": candidate.underlying_sequence,
                "source_sample_count": candidate.source_sample_count,
                "source_success_rate": candidate.source_success_rate,
            },
            scope=scope,
        )
        return {
            "ok": True,
            "status": "promoted",
            "name": candidate.name,
            "candidate_id": candidate.candidate_id,
            "report": _model_payload(promote_report),
        }


def _register_proposal_decision_routes(router: APIRouter, d: EvolutionOpsDeps) -> None:
    """Reject skill proposals; model benchmark and MCP proposal queues."""
    journal = d.journal
    _require_actor = d.require_actor
    _tenant_scope = d.tenant_scope
    _request_journal = d.request_journal
    _journal_write_context = d.journal_write_context
    _suppressed_names = d.suppressed_names

    @router.post("/api/intel-evolution/skills/proposals/reject")
    def reject_skill_proposal(
        request: Request,
        body: dict[str, Any] | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scope = _tenant_scope(request, cross_tenant=cross_tenant)
        proposal_name = str((body or {}).get("name") or "").strip()
        if proposal_name:
            _suppressed_names(scope).add(proposal_name)
            _write_skill_proposal_decision(
                journal,
                proposal_name=proposal_name,
                decision="rejected",
                reason=str((body or {}).get("reason") or ""),
                scope=scope,
            )
        return {
            "ok": True,
            "status": "rejected",
            "name": proposal_name or None,
            "proposal": body or {},
        }

    @router.get("/api/intel-evolution/models/proposals")
    def model_proposals(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        return _model_benchmark_rows(scoped)

    @router.post("/api/intel-evolution/models/benchmarks/run")
    def run_model_benchmarks(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        rows = _model_benchmark_rows(scoped)
        return {
            "ok": True,
            "created": len(rows),
            "source": "journal",
            "proposals": rows,
            "message": (
                "Benchmarks are derived from recorded token_usage events "
                "joined with trajectory outcomes."
            ),
        }

    @router.get("/api/intel-evolution/mcp/proposals")
    def mcp_proposals(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        return _mcp_proposal_rows(scoped)

    @router.post("/api/intel-evolution/mcp/proposals/vet")
    def vet_mcp_proposals(
        request: Request,
        body: dict[str, Any] | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        payload = body or {}
        requested = str(payload.get("server_name") or "").strip()
        proposals = _mcp_proposal_rows(scoped)
        targets = [
            proposal
            for proposal in proposals
            if proposal["status"] == "pending_vet"
            and (not requested or proposal["server_name"] == requested)
        ]
        for proposal in targets:
            with _journal_write_context(scope):
                _write_mcp_proposal_decision(
                    journal,
                    server_name=proposal["server_name"],
                    status="vetted",
                    reason=str(payload.get("reason") or "operator_vet"),
                    details={
                        "risk_level": proposal.get("risk_level"),
                        "suggested_cmd": proposal.get("suggested_cmd"),
                        "failure_count": proposal.get("failure_count"),
                    },
                )
        return {"ok": True, "vetted": len(targets), "source": "journal"}

    @router.post("/api/intel-evolution/mcp/proposals/install")
    def install_mcp_proposal(
        request: Request,
        body: dict[str, Any] | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        server_name = str((body or {}).get("server_name") or "").strip()
        proposal = next(
            (row for row in _mcp_proposal_rows(scoped) if row["server_name"] == server_name),
            None,
        )
        if proposal is not None and proposal.get("status") == "vetted":
            with _journal_write_context(scope):
                _write_mcp_proposal_decision(
                    journal,
                    server_name=server_name,
                    status="install_requested",
                    reason="manual_install_required",
                    details={
                        "suggested_cmd": proposal.get("suggested_cmd"),
                        "risk_level": proposal.get("risk_level"),
                    },
                )
            return {
                "ok": True,
                "installed": False,
                "status": "install_requested",
                "server_name": server_name,
                "reason": (
                    "External MCP installation requires manual confirmation in Settings > MCP."
                ),
                "source": "journal",
            }
        return {
            "ok": False,
            "server_name": server_name or None,
            "reason": "No vetted MCP proposal is available.",
            "source": "journal",
        }
