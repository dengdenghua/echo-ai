from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

try:
    from fastapi import APIRouter, Depends, HTTPException, Query, Request

    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False

from runtime.safety.auth.principal import require_operator
from runtime.sensing.gateway._evolution_candidate_endpoints import (
    EvolutionRouterDeps,
    _register_candidate_routes,
    _register_evidence_routes,
    _register_fitness_routes,
    _register_shadow_routes,
)
from runtime.sensing.gateway._evolution_certification_endpoints import (
    _register_scorecard_routes,
    _register_swarm_plan_routes,
)
from runtime.sensing.gateway._evolution_helpers import _actor_from_request
from runtime.sensing.gateway._evolution_ledger_endpoints import (
    _register_canary_routes,
    _register_ledger_routes,
)
from runtime.sensing.gateway._evolution_models import (
    AutomationPolicyRuleInstallBody,
    BrowserDesktopRepairRecipeEvidenceBody,
    BrowserDesktopRepairRecipeQueueBody,
    BrowserDesktopRepairRecipeRerunBatchBody,
    BrowserDesktopRepairRecipeRerunBody,
    BrowserDesktopStaleArtifactRejectionBody,
    CandidateCanaryOutcomeBody,
    CandidateRollbackBody,
    DualHelixShadowRunBody,
    DualHelixShadowSettingsBody,
    KimiSwarmLoadTestBody,
    KimiSwarmQuotaProbeBody,
    RepairRoutePromotionQueueBody,
    ScorecardGapQueueBody,
    SubagentPolicyDecisionBody,
    VerifierDriftQueueBody,
)
from runtime.sensing.gateway._evolution_repair_endpoints import (
    _register_repair_recipe_routes,
    _register_verifier_routes,
)

__all__ = [
    "AutomationPolicyRuleInstallBody",
    "BrowserDesktopRepairRecipeEvidenceBody",
    "BrowserDesktopRepairRecipeQueueBody",
    "BrowserDesktopRepairRecipeRerunBatchBody",
    "BrowserDesktopRepairRecipeRerunBody",
    "BrowserDesktopStaleArtifactRejectionBody",
    "CandidateCanaryOutcomeBody",
    "CandidateRollbackBody",
    "DualHelixShadowRunBody",
    "DualHelixShadowSettingsBody",
    "FASTAPI_AVAILABLE",
    "KimiSwarmLoadTestBody",
    "KimiSwarmQuotaProbeBody",
    "RepairRoutePromotionQueueBody",
    "ScorecardGapQueueBody",
    "SubagentPolicyDecisionBody",
    "VerifierDriftQueueBody",
    "create_evolution_router",
]


_LOG = logging.getLogger("echo.siphon.evolution_router")


def create_evolution_router(
    *,
    stack: Any = None,
    agent_registry: Any = None,
    project_root: Any = None,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> Any:
    if not FASTAPI_AVAILABLE:
        return APIRouter() if FASTAPI_AVAILABLE else None

    def _operator_dep(request: Request) -> None:
        require_operator(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )

    def _candidate_scope(request: Request, *, cross_tenant: bool = False) -> Any:
        from runtime.safety.auth.scope import TenantScope, scope_from_principal

        principal = getattr(getattr(request, "state", None), "principal", None)
        if not cross_tenant:
            return scope_from_principal(principal)
        if principal is None:
            if require_auth:
                raise HTTPException(401, "auth required")
            return TenantScope(
                tenant_id="legacy:local-operator",
                actor_id="local-operator",
                allow_cross_tenant=True,
            )
        allowed_scopes = {
            "evolution:cross_tenant",
            "tenant:cross_tenant",
            "global:admin",
            "*",
        }
        if "admin" not in principal.roles or not principal.scopes.intersection(allowed_scopes):
            raise HTTPException(403, "explicit cross-tenant evolution admin permission required")
        return scope_from_principal(principal, allow_cross_tenant=True)

    # Evolution is a control plane: it can inspect and mutate proposals,
    # canaries, policy rules, forge state, and runtime behavior. In shared
    # deployments every endpoint therefore requires an authenticated operator
    # or admin. ``require_auth=False`` preserves the explicit local single-user
    # development mode used by the standalone unit-router tests.
    router = APIRouter(
        prefix="/api/evolution",
        tags=["evolution"],
        dependencies=[Depends(_operator_dep)],
    )
    from runtime.platform.process.paths import app_paths
    from runtime.safety.evolution.candidate_canary import CandidateCanaryManager
    from runtime.safety.evolution.candidate_registry import CandidateRegistry
    from runtime.safety.evolution.experiment_protocol import ExperimentStore
    from runtime.safety.evolution.runtime_deployment import CandidateRuntimeSelector

    paths = app_paths()
    experiment_store = ExperimentStore(paths.evolution_experiments_path)
    # Legacy/global objects remain available to the older shadow service.
    # Candidate HTTP operations below resolve their registry and canary state
    # per request instead of closing over this global store.
    candidate_registry = CandidateRegistry(paths.evolution_candidates_path)

    def _registry_paths(scope: Any) -> list[Path]:
        from runtime.safety.auth.scope import tenant_scoped_path

        base = paths.evolution_candidates_path
        if scope is None:
            return [base]
        if not scope.allow_cross_tenant:
            return [tenant_scoped_path(base, scope)]
        tenant_rows = sorted((base.parent / "tenants").glob(f"*/{base.name}"))
        return [base, *tenant_rows]

    def _services_for_scope(scope: Any) -> list[tuple[Any, Any]]:
        from runtime.safety.auth.scope import tenant_scoped_path

        services: list[tuple[Any, Any]] = []
        for registry_path in _registry_paths(scope):
            is_tenant_partition = registry_path != paths.evolution_candidates_path
            expected_scope = scope if scope is not None and not scope.allow_cross_tenant else None
            registry = CandidateRegistry(registry_path, tenant_scope=expected_scope)
            if is_tenant_partition:
                state_dir = registry_path.parent / paths.candidate_canary_state_dir.name
            elif scope is not None and not scope.allow_cross_tenant:
                state_dir = tenant_scoped_path(paths.candidate_canary_state_dir, scope)
            else:
                state_dir = paths.candidate_canary_state_dir
            manager = CandidateCanaryManager(
                registry,
                state_dir,
                runtime_registry=getattr(stack, "registry", None),
                # Tenant skill registries are not yet process-partitioned.
                # Keep their canary as an auditable control-plane rollout and
                # never inject tenant code into the process-global registry.
                materialize_runtime=not is_tenant_partition,
            )
            services.append((registry, manager))
        return services

    def _service_for_candidate(scope: Any, candidate_id: str) -> tuple[Any, Any]:
        matches: list[tuple[Any, Any]] = []
        for registry, manager in _services_for_scope(scope):
            if registry.get(candidate_id) is not None:
                matches.append((registry, manager))
        if not matches:
            raise KeyError(f"unknown evolution candidate: {candidate_id}")
        if len(matches) > 1:
            # Old records did not include ownership in their candidate ID.
            # Never guess which tenant owns a duplicated legacy identifier.
            raise ValueError(f"candidate id conflicts across tenant partitions: {candidate_id}")
        return matches[0]

    shadow_service = None
    if stack is not None and project_root is not None:
        try:
            from runtime.platform.process.paths import app_paths
            from runtime.safety.evolution.dual_helix_shadow import (
                DualHelixShadowService,
                build_codex_shadow_runner,
                build_native_shadow_runner,
            )

            shadow_service = DualHelixShadowService(
                app_paths().data_dir / "dual_helix_shadow.json",
                app_paths().data_dir / "dual_helix_shadows",
                allowed_workspace_root=project_root,
                codex_runner=build_codex_shadow_runner(stack, agent_registry),
                native_runner=build_native_shadow_runner(stack),
                candidate_registry=candidate_registry,
            )
        except Exception:  # noqa: BLE001 - status endpoint reports unavailable
            _LOG.exception("dual-helix shadow service failed to initialize")

    deps = EvolutionRouterDeps(
        paths=paths,
        experiment_store=experiment_store,
        shadow_service=shadow_service,
        candidate_runtime_selector=CandidateRuntimeSelector,
        candidate_scope=_candidate_scope,
        services_for_scope=_services_for_scope,
        service_for_candidate=_service_for_candidate,
    )

    # Registration order is FastAPI's path-matching priority — keep it.
    _register_evidence_routes(router, deps)
    _register_candidate_routes(router, deps)
    _register_shadow_routes(router, deps)
    _register_scorecard_routes(router)
    _register_swarm_plan_routes(router)
    _register_quality_routes(router)
    _register_policy_rule_routes(router)
    _register_repair_recipe_routes(router)
    _register_verifier_routes(router)
    _register_fitness_routes(router, deps)
    _register_ledger_routes(router)
    _register_canary_routes(router)

    return router


# The two groups below stay in this file on purpose: the capability
# evidence scanners in runtime/safety/evolution/ (parity_certification,
# permission_sandbox_quality) look for their route / audit terms in
# ``runtime/sensing/gateway/evolution_router.py`` itself.
def _register_quality_routes(router: APIRouter) -> None:
    """Quality reports: browser/desktop, repo context, sandbox, product, loop."""

    @router.get("/browser-desktop-quality")
    def get_browser_desktop_quality() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.browser_desktop_quality import (
                compute_browser_desktop_quality,
            )

            return {"ok": True, **compute_browser_desktop_quality()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/repo-context-quality")
    def get_repo_context_quality() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.repo_context_quality import (
                compute_repo_context_quality,
            )

            return {"ok": True, **compute_repo_context_quality()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/permission-sandbox-quality")
    def get_permission_sandbox_quality() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.permission_sandbox_quality import (
                compute_permission_sandbox_quality,
            )

            return {"ok": True, **compute_permission_sandbox_quality()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/product-experience-quality")
    def get_product_experience_quality() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.product_experience_quality import (
                compute_product_experience_quality,
            )

            return {"ok": True, **compute_product_experience_quality()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/agent-loop-quality")
    def get_agent_loop_quality() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.agent_loop_quality import (
                compute_agent_loop_quality,
            )

            return {"ok": True, **compute_agent_loop_quality()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/digital-employee-quality")
    def get_digital_employee_quality() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.digital_employee_quality import (
                compute_digital_employee_quality,
            )

            return {"ok": True, **compute_digital_employee_quality()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/automation-radar")
    def get_automation_radar(
        target_score: int = Query(default=95, ge=1, le=100),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.automation_radar import (
                compute_automation_radar,
            )

            return {
                "ok": True,
                **compute_automation_radar(target_score=target_score),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


def _register_policy_rule_routes(router: APIRouter) -> None:
    """Signed automation policy-rule drafts and their confirmed install."""

    @router.get("/automation-policy-rule-drafts")
    def get_automation_policy_rule_drafts(
        limit: int = Query(default=100, ge=1, le=500),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.policy_review_rules import (
                build_automation_policy_rule_drafts,
                verify_policy_review_rule_draft,
            )

            report = build_automation_policy_rule_drafts(limit=limit)
            report["verified"] = sum(
                1
                for draft in report.get("drafts") or []
                if verify_policy_review_rule_draft(draft).get("ok") is True
            )
            return {"ok": True, **report}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/automation-policy-rule-drafts/install")
    def install_automation_policy_rule_draft(
        request: Request,
        body: AutomationPolicyRuleInstallBody,
    ) -> dict[str, Any]:
        try:
            from runtime.platform.process.paths import app_paths
            from runtime.safety.evolution.governance_audit import (
                append_governance_audit_event,
            )
            from runtime.safety.evolution.policy_review_rules import (
                build_automation_policy_rule_drafts,
                install_policy_review_rule_draft,
            )

            report = build_automation_policy_rule_drafts(limit=body.limit)
            draft = next(
                (
                    item
                    for item in report.get("drafts") or []
                    if isinstance(item, dict) and str(item.get("draft_id") or "") == body.draft_id
                ),
                None,
            )
            if draft is None:
                raise HTTPException(404, "automation policy rule draft not found")
            result = install_policy_review_rule_draft(
                draft,
                policy_path=app_paths().permissions_path,
                confirm_install=body.confirm_install,
            )
            append_governance_audit_event(
                event_type="automation_policy_rule_install",
                target="approval_policy",
                status="installed",
                artifact=result,
                decision_context={
                    "schema": "echo.automation_policy_rule_install_context.v1",
                    "actor": _actor_from_request(request),
                    "draft_id": body.draft_id,
                    "source": "evolution_router",
                },
                audit_path=app_paths().promotion_audit_path,
            )
            return {"ok": True, **result}
        except HTTPException:
            raise
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
