"""Learning-insight and skill-forge endpoints for the evolution ops router.

Pure structural split of ``evolution_ops_router.create_evolution_ops_router``
— no logic changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading the factory's closures from ``EvolutionOpsDeps``; the
factory still owns the registration order.
"""

from __future__ import annotations

from typing import Any

try:
    from fastapi import APIRouter, HTTPException, Query, Request

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment,misc]
    HTTPException = None  # type: ignore[assignment,misc]
    Query = None  # type: ignore[assignment,misc]
    Request = None  # type: ignore[assignment,misc]

from ._evolution_ops_deps import EvolutionOpsDeps
from ._evolution_ops_insights import (
    evolution_learning_curve_payload,
    evolution_memory_growth_payload,
    evolution_overview_payload,
    evolution_recommendations_payload,
    evolution_story_payload,
)
from .evolution_ops import (
    _budget_snapshot,
    _iso,
    _learn_from_intel_result,
    _registry_skill_is_auto,
    _skill_candidate_to_proposal,
    _skill_forge_candidates,
    _skill_performance_rows,
    _skill_step_rows,
    _write_budget_breaker_reset,
)


def _register_learning_routes(router: APIRouter, d: EvolutionOpsDeps) -> None:
    """Overview, learning story, skill history / performance, forge-from-task."""
    journal = d.journal
    registry = d.registry
    _require_actor = d.require_actor
    _tenant_scope = d.tenant_scope
    _request_journal = d.request_journal
    _projection_dependencies = d.projection_dependencies
    _require_forge_dependencies = d.require_forge_dependencies

    @router.get("/api/evolution/overview")
    def evolution_overview(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        projection_registry, projection_planner, _ = _projection_dependencies(scope)
        return evolution_overview_payload(
            scoped,
            projection_registry,
            projection_planner,
            include_global_intelligence=scope is None or scope.allow_cross_tenant,
        )

    @router.get("/api/evolution/story")
    def evolution_story(
        request: Request,
        limit: int = Query(default=8, ge=1, le=30),
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        """Plain-language evidence for what the system actually learned.

        Trajectories are observations, not evolution outcomes. This endpoint
        keeps them separate from durable planner rules, memories, and forged
        skills so the UI cannot imply that merely running a task changed the
        agent's future behaviour.
        """
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        projection_registry, projection_planner, projection_threads = _projection_dependencies(
            scope
        )
        return evolution_story_payload(
            scoped,
            projection_registry,
            projection_planner,
            projection_threads,
            limit=limit,
        )

    @router.get("/api/evolution/skills/history")
    def evolution_skill_history(
        request: Request,
        limit: int = Query(default=100, ge=1, le=500),
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        projection_registry, _, _ = _projection_dependencies(scope)
        rows: list[dict[str, Any]] = []
        for item in _skill_step_rows(scoped):
            rows.append(
                {
                    "timestamp": _iso(item["ts"]),
                    "skill_name": item["skill_name"],
                    "source_task": item["task_id"],
                    "trigger": (
                        "auto"
                        if _registry_skill_is_auto(projection_registry, item["skill_name"])
                        else "manual"
                    ),
                    "success_rate": 1.0 if item["success"] else 0.0,
                }
            )
        rows.sort(key=lambda r: r["timestamp"], reverse=True)
        return rows[:limit]

    @router.get("/api/evolution/skills/performance")
    def evolution_skill_performance(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        projection_registry, _, _ = _projection_dependencies(scope)
        return _skill_performance_rows(scoped, projection_registry)

    @router.post("/api/evolution/skills/forge-from-task")
    def forge_skill_from_task(
        request: Request,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        _require_actor(request)
        scope = _tenant_scope(request)
        task_id = str((body or {}).get("task_id") or "").strip()
        if not task_id:
            return {
                "ok": False,
                "status": "missing_task_id",
                "promoted": [],
                "quarantined": [],
            }
        persist_dir = _require_forge_dependencies()

        try:
            from runtime.memory.journal.journal import TrajectoryEvent
            from runtime.safety.recovery.skill_forge import SkillForge
            from runtime.safety.recovery.tenant_scope import read_learning_events
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(503, f"forge unavailable: {exc}") from exc

        trajectories = [
            event.trajectory
            for event in read_learning_events(
                journal,
                "trajectory",
                scope=scope,
            )
            if isinstance(event, TrajectoryEvent)
            and str(getattr(event.trajectory, "task_id", "")) == task_id
            and getattr(event.trajectory.outcome, "success", False)
            and not getattr(event.trajectory.outcome, "degraded", False)
        ]
        if not trajectories:
            return {
                "ok": False,
                "status": "no_successful_trajectory",
                "task_id": task_id,
                "promoted": [],
                "quarantined": [],
                "step_count": 0,
            }

        result = SkillForge(
            journal=journal,
            registry=registry,
            auto_persist_dir=persist_dir,
            scope=scope,
        ).forge_selected(trajectories)
        status = (
            "promoted"
            if result.promoted
            else "governed"
            if result.governed
            else "quarantined"
            if result.quarantined
            else "shadow_failed"
            if result.shadow_failed
            else "no_candidate"
        )
        return {
            "ok": bool(result.promoted or result.governed),
            "status": status,
            "task_id": task_id,
            "promoted": list(result.promoted),
            "quarantined": list(result.quarantined),
            "governed": list(result.governed),
            "evolution_candidates": list(result.evolution_candidates),
            "candidates_total": result.candidates_total,
            "step_count": sum(trajectory.step_count for trajectory in trajectories),
        }


def _register_learning_projection_routes(router: APIRouter, d: EvolutionOpsDeps) -> None:
    """Memory growth, learning curve, recommendations, learn-from-intel, budget."""
    journal = d.journal
    registry = d.registry
    planner = d.planner
    planner_provider = d.planner_provider
    get_planner = d.get_planner
    _require_actor = d.require_actor
    _tenant_scope = d.tenant_scope
    _request_journal = d.request_journal
    _projection_dependencies = d.projection_dependencies
    _journal_write_context = d.journal_write_context
    _suppressed_names = d.suppressed_names

    @router.get("/api/evolution/memory/growth")
    def evolution_memory_growth(
        request: Request,
        days: int = Query(default=30, ge=1, le=365),
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        projection_registry, projection_planner, _ = _projection_dependencies(scope)
        return evolution_memory_growth_payload(
            scoped,
            projection_registry,
            projection_planner,
            days=days,
        )

    @router.get("/api/evolution/learning-curve")
    def evolution_learning_curve(
        request: Request,
        weeks: int = Query(default=12, ge=1, le=104),
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        return evolution_learning_curve_payload(scoped, weeks=weeks)

    @router.get("/api/evolution/recommendations")
    def evolution_recommendations(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        projection_registry, projection_planner, _ = _projection_dependencies(scope)
        return evolution_recommendations_payload(
            scoped,
            projection_registry,
            projection_planner,
        )

    @router.post("/api/evolution/learn-from-intel")
    def evolution_learn_from_intel(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        if (
            scope is not None
            and not scope.allow_cross_tenant
            and (planner is not None or planner_provider is not None)
        ):
            raise HTTPException(
                409,
                "tenant-scoped planner persistence is unavailable; global learning requires "
                "explicit cross-tenant admin permission",
            )
        return _learn_from_intel_result(
            scoped,
            get_planner(),
            registry,
            suppressed_names=_suppressed_names(scope),
            scope=scope,
        )

    @router.get("/api/evolution/budget/snapshot")
    def budget_snapshot(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        return _budget_snapshot(scoped)

    @router.post("/api/evolution/budget/breaker/reset")
    def reset_budget_breaker(
        request: Request,
        body: dict[str, Any] | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        _scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        component = str((body or {}).get("component") or "").strip()
        if not component:
            return {"ok": False, "component": None, "source": "journal"}
        with _journal_write_context(scope):
            _write_budget_breaker_reset(
                journal,
                component=component,
                reason=str((body or {}).get("reason") or "operator_reset"),
            )
        return {"ok": True, "component": component, "source": "journal"}

    @router.get("/api/intel-evolution/skills/proposals")
    def skill_proposals(
        request: Request,
        status: str | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        _require_actor(request)
        scope = _tenant_scope(request, cross_tenant=cross_tenant)
        if status and status != "pending":
            return []
        return [
            _skill_candidate_to_proposal(candidate)
            for candidate in _skill_forge_candidates(
                journal,
                registry,
                suppressed_names=_suppressed_names(scope),
                scope=scope,
            )
        ]
