"""Repair-recipe, verifier, and subagent endpoints for the evolution router.

Pure structural split of ``evolution_router.create_evolution_router`` — no
logic changes. Registration order is still owned by the factory.
"""

from __future__ import annotations

from typing import Any

try:
    from fastapi import APIRouter, Query, Request

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - create_evolution_router returns early
    FASTAPI_AVAILABLE = False

from runtime.sensing.gateway._evolution_helpers import _resolve_api_base_url
from runtime.sensing.gateway._evolution_models import (
    BrowserDesktopRepairRecipeEvidenceBody,
    BrowserDesktopRepairRecipeQueueBody,
    BrowserDesktopRepairRecipeRerunBatchBody,
    BrowserDesktopRepairRecipeRerunBody,
    BrowserDesktopStaleArtifactRejectionBody,
    RepairRoutePromotionQueueBody,
    SubagentPolicyDecisionBody,
    VerifierDriftQueueBody,
)


def _register_repair_recipe_routes(router: APIRouter) -> None:
    """Browser/desktop repair recipes: list, queue, stale rejection, verifications."""

    @router.get("/browser-desktop-repair-recipes")
    def get_browser_desktop_repair_recipes(
        limit: int = Query(default=1000, ge=1, le=5000),
        min_occurrences: int = Query(default=1, ge=1, le=20),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.browser_desktop_repair_recipes import (
                compute_browser_desktop_repair_recipes,
            )

            return {
                "ok": True,
                **compute_browser_desktop_repair_recipes(
                    limit=limit,
                    min_occurrences=min_occurrences,
                ),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/browser-desktop-repair-recipes/queue")
    def queue_browser_desktop_repair_recipes(
        body: BrowserDesktopRepairRecipeQueueBody | None = None,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.browser_desktop_repair_recipes import (
                queue_browser_desktop_repair_recipes,
            )

            body = body or BrowserDesktopRepairRecipeQueueBody()
            return {
                "ok": True,
                **queue_browser_desktop_repair_recipes(
                    limit=body.limit,
                    min_occurrences=body.min_occurrences,
                ),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/browser-desktop-repair-recipes/stale-artifacts/reject")
    def reject_stale_browser_desktop_replay_artifacts(
        body: BrowserDesktopStaleArtifactRejectionBody | None = None,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.browser_desktop_repair_recipes import (
                reject_stale_browser_desktop_replay_artifacts,
            )

            body = body or BrowserDesktopStaleArtifactRejectionBody()
            return {
                "ok": True,
                **reject_stale_browser_desktop_replay_artifacts(limit=body.limit),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/browser-desktop-repair-recipes/verifications")
    def get_browser_desktop_repair_recipe_verifications(
        limit: int = Query(default=1000, ge=1, le=5000),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.browser_desktop_repair_recipes import (
                compute_browser_desktop_repair_recipe_verifications,
            )

            return {
                "ok": True,
                **compute_browser_desktop_repair_recipe_verifications(limit=limit),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/browser-desktop-repair-recipes/verifications/evidence")
    def attach_browser_desktop_repair_recipe_evidence(
        body: BrowserDesktopRepairRecipeEvidenceBody,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.browser_desktop_repair_recipes import (
                attach_browser_desktop_repair_recipe_evidence,
            )

            return {
                "ok": True,
                **attach_browser_desktop_repair_recipe_evidence(
                    item_id=body.item_id,
                    passed=body.passed,
                    provided=body.provided,
                    artifacts=body.artifacts,
                    notes=body.notes,
                    actor=body.actor,
                ),
            }
        except KeyError as exc:
            return {"ok": False, "error": f"recipe item not found: {exc}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/browser-desktop-repair-recipes/verifications/rerun")
    def rerun_browser_desktop_repair_recipe_evidence(
        body: BrowserDesktopRepairRecipeRerunBody,
        request: Request,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.browser_desktop_repair_recipes import (
                rerun_browser_desktop_repair_recipe_evidence,
            )

            api_base_url = _resolve_api_base_url(
                body.api_base_url,
                request=request,
            )
            return {
                "ok": True,
                **rerun_browser_desktop_repair_recipe_evidence(
                    item_id=body.item_id,
                    api_base_url=api_base_url,
                    promote_source_cases=body.promote_source_cases,
                    actor=body.actor,
                ),
            }
        except KeyError as exc:
            return {"ok": False, "error": f"recipe item not found: {exc}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/browser-desktop-repair-recipes/verifications/rerun-batch")
    def rerun_browser_desktop_repair_recipe_batch(
        request: Request,
        body: BrowserDesktopRepairRecipeRerunBatchBody | None = None,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.browser_desktop_repair_recipes import (
                rerun_browser_desktop_repair_recipe_batch,
            )

            body = body or BrowserDesktopRepairRecipeRerunBatchBody()
            api_base_url = _resolve_api_base_url(
                body.api_base_url,
                request=request,
            )
            return {
                "ok": True,
                **rerun_browser_desktop_repair_recipe_batch(
                    api_base_url=api_base_url,
                    promote_source_cases=body.promote_source_cases,
                    actor=body.actor,
                    limit=body.limit,
                ),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


def _register_verifier_routes(router: APIRouter) -> None:
    """Repair-route quality, auto-verifier metrics, subagent fitness and policy."""

    @router.get("/repair-route-quality")
    def get_repair_route_quality(
        limit: int = Query(default=1000, ge=1, le=5000),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.repair_route_quality import (
                compute_repair_route_quality,
            )

            return {"ok": True, **compute_repair_route_quality(limit=limit)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/repair-route-quality/promotions/queue")
    def queue_repair_route_promotions(
        body: RepairRoutePromotionQueueBody | None = None,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.repair_route_quality import (
                queue_repair_route_promotion_candidates,
            )

            body = body or RepairRoutePromotionQueueBody()
            return {
                "ok": True,
                **queue_repair_route_promotion_candidates(limit=body.limit),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/auto-verifier-metrics")
    def get_auto_verifier_metrics(
        limit: int = Query(default=1000, ge=1, le=5000),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.auto_verifier_metrics import (
                summarize_auto_verifier_metrics,
            )

            return {"ok": True, **summarize_auto_verifier_metrics(limit=limit)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/auto-verifier-metrics/drift/queue")
    def queue_auto_verifier_drift(
        body: VerifierDriftQueueBody | None = None,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.auto_verifier_metrics import (
                queue_verifier_drift_backlog,
            )

            body = body or VerifierDriftQueueBody()
            return {
                "ok": True,
                **queue_verifier_drift_backlog(limit=body.limit),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/subagent-fitness")
    def get_subagent_fitness(
        role: str | None = Query(default=None),
        limit: int = Query(default=2000, ge=1, le=5000),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.subagent_fitness import (
                compute_subagent_fitness,
            )

            return {"ok": True, **compute_subagent_fitness(role=role, limit=limit)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/subagent-policy")
    def get_subagent_policy() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.subagent_policy import SubagentPolicyStore

            return {"ok": True, **SubagentPolicyStore().summary()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/subagent-policy/{role}/decision")
    def decide_subagent_policy(
        role: str,
        body: SubagentPolicyDecisionBody,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.subagent_policy import SubagentPolicyStore

            result = SubagentPolicyStore().decide(
                role,
                action=body.action,
                reason=body.reason,
                evidence_item_ids=body.evidence_item_ids,
                actor=body.actor,
            )
            return {"ok": True, **result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
