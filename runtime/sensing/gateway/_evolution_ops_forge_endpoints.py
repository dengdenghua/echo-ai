"""RecipeForge alias endpoints for the evolution ops router.

Pure structural split of ``evolution_ops_router.create_evolution_ops_router``
— no logic changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading the factory's closures from ``EvolutionOpsDeps``; the
factory still owns the registration order.
"""

from __future__ import annotations

from typing import Any

try:
    from fastapi import APIRouter, Header, Query, Request

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment,misc]
    Header = None  # type: ignore[assignment,misc]
    Query = None  # type: ignore[assignment,misc]
    Request = None  # type: ignore[assignment,misc]

from ._evolution_ops_deps import EvolutionOpsDeps
from .evolution_ops import (
    _csv_response,
    _forge_addendums_csv_rows,
    _forge_addendums_snapshot,
    _forge_applied_snapshot,
    _forge_apply_candidate,
    _forge_auto_promote,
    _forge_auto_propose,
    _forge_auto_tick_disable,
    _forge_auto_tick_enable,
    _forge_auto_tick_run_now,
    _forge_auto_tick_status,
    _forge_delete_addendum,
    _forge_delete_variant,
    _forge_recipes_snapshot,
    _forge_run_optimizer,
    _forge_runs_csv_rows,
    _forge_runs_snapshot,
    _forge_variant_stats,
    _forge_variant_weights,
    _forge_variants_snapshot,
)


def _register_forge_routes(router: APIRouter, d: EvolutionOpsDeps) -> None:
    """Forge snapshots, auto-tick control, optimizer runs, and apply."""
    journal = d.journal
    get_planner = d.get_planner
    _require_actor = d.require_actor

    # RecipeForge aliases. The full Reflex admin router registers the same
    # paths when available; these handlers keep the operator console wired to
    # the same GEPA/RecipeForge modules when only this router is mounted.
    @router.get("/api/evolution/forge/applied")
    def forge_applied() -> dict[str, Any]:
        return _forge_applied_snapshot()

    @router.get("/api/evolution/forge/runs")
    def forge_runs(limit: int = Query(default=20, ge=1, le=200)) -> dict[str, Any]:
        return _forge_runs_snapshot(limit=limit)

    @router.get("/api/evolution/forge/addendums")
    def forge_addendums() -> dict[str, Any]:
        return _forge_addendums_snapshot()

    @router.get("/api/evolution/forge/recipes")
    def forge_recipes() -> dict[str, Any]:
        return _forge_recipes_snapshot()

    @router.get("/api/evolution/forge/auto-tick/status")
    def forge_auto_tick_status() -> dict[str, Any]:
        return _forge_auto_tick_status()

    @router.post("/api/evolution/forge/auto-tick/enable")
    def forge_auto_tick_enable(
        interval_hours: float = Query(default=24, ge=0.1, le=24 * 30),
        min_uses: int = Query(default=20, ge=1, le=1000),
        min_lead: float = Query(default=0.15, ge=0, le=1),
        x_human_approver: str | None = Header(default=None, alias="X-Human-Approver"),
    ) -> dict[str, Any]:
        return _forge_auto_tick_enable(
            journal=journal,
            interval_hours=interval_hours,
            min_uses=min_uses,
            min_lead=min_lead,
            approver=x_human_approver,
        )

    @router.post("/api/evolution/forge/auto-tick/disable")
    def forge_auto_tick_disable(request: Request) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        return _forge_auto_tick_disable()

    @router.post("/api/evolution/forge/auto-tick/run-now")
    def forge_auto_tick_run_now(
        apply: bool = False,
        min_uses: int = Query(default=20, ge=1, le=1000),
        min_lead: float = Query(default=0.15, ge=0, le=1),
    ) -> dict[str, Any]:
        return _forge_auto_tick_run_now(
            journal=journal,
            apply=apply,
            min_uses=min_uses,
            min_lead=min_lead,
        )

    @router.post("/api/evolution/forge/run")
    def forge_run(
        n_iter: int = Query(default=8, ge=1, le=30),
        eval_tasks: int = Query(default=4, ge=1, le=20),
        recipe_id: str | None = Query(default=None),
        judge_model: str = Query(default="claude-sonnet-4-6"),
        mutator_model: str = Query(default="claude-sonnet-4-6"),
        optimizer_backend: str | None = Query(default=None),
    ) -> dict[str, Any]:
        return _forge_run_optimizer(
            journal=journal,
            planner=get_planner(),
            n_iter=n_iter,
            eval_tasks=eval_tasks,
            recipe_id=recipe_id,
            judge_model=judge_model,
            mutator_model=mutator_model,
            optimizer_backend=optimizer_backend,
        )

    @router.post("/api/evolution/forge/auto-propose")
    def forge_auto_propose(
        n_iter: int = Query(default=8, ge=1, le=30),
        eval_tasks: int = Query(default=4, ge=1, le=20),
        max_recipes: int = Query(default=3, ge=1, le=20),
        judge_model: str = Query(default="claude-sonnet-4-6"),
        mutator_model: str = Query(default="claude-sonnet-4-6"),
    ) -> dict[str, Any]:
        return _forge_auto_propose(
            journal=journal,
            planner=get_planner(),
            n_iter=n_iter,
            eval_tasks=eval_tasks,
            max_recipes=max_recipes,
            judge_model=judge_model,
            mutator_model=mutator_model,
        )

    @router.post("/api/evolution/forge/apply")
    def forge_apply(
        body: dict[str, Any] | None = None,
        x_human_approver: str | None = Header(default=None, alias="X-Human-Approver"),
    ) -> dict[str, Any]:
        return _forge_apply_candidate(body or {}, approver=x_human_approver)


def _register_forge_variant_routes(router: APIRouter, d: EvolutionOpsDeps) -> None:
    """Addendum / variant management and the CSV exports."""
    journal = d.journal

    @router.delete("/api/evolution/forge/addendums/{recipe_id:path}")
    def forge_delete_addendum(
        recipe_id: str,
        x_human_approver: str | None = Header(default=None, alias="X-Human-Approver"),
    ) -> dict[str, Any]:
        return _forge_delete_addendum(recipe_id, approver=x_human_approver)

    @router.get("/api/evolution/forge/variants/{recipe_id:path}/stats")
    def forge_variant_stats(recipe_id: str) -> dict[str, Any]:
        return _forge_variant_stats(journal=journal, recipe_id=recipe_id)

    @router.post("/api/evolution/forge/variants/{recipe_id:path}/auto-promote")
    def forge_auto_promote(
        recipe_id: str,
        min_uses: int = Query(default=10, ge=1, le=1000),
        min_lead: float = Query(default=0.10, ge=0, le=1),
        apply: bool = False,
    ) -> dict[str, Any]:
        return _forge_auto_promote(
            journal=journal,
            recipe_id=recipe_id,
            min_uses=min_uses,
            min_lead=min_lead,
            apply=apply,
        )

    @router.post("/api/evolution/forge/variants/{recipe_id:path}/weights")
    def forge_variant_weights(
        recipe_id: str,
        body: dict[str, Any] | None = None,
        x_human_approver: str | None = Header(default=None, alias="X-Human-Approver"),
    ) -> dict[str, Any]:
        return _forge_variant_weights(
            recipe_id,
            body or {},
            approver=x_human_approver,
        )

    @router.delete("/api/evolution/forge/variants/{recipe_id:path}/{variant_id}")
    def forge_delete_variant(
        recipe_id: str,
        variant_id: str,
        x_human_approver: str | None = Header(default=None, alias="X-Human-Approver"),
    ) -> dict[str, Any]:
        return _forge_delete_variant(
            recipe_id,
            variant_id,
            approver=x_human_approver,
        )

    @router.get("/api/evolution/forge/variants/{recipe_id:path}")
    def forge_variants(recipe_id: str) -> dict[str, Any]:
        return _forge_variants_snapshot(recipe_id)

    @router.get("/api/evolution/forge/runs.csv")
    def forge_runs_csv() -> Any:
        return _csv_response(
            [
                "ts",
                "iso_ts",
                "trigger",
                "recipe_id",
                "iterations_run",
                "elapsed_s",
                "front_size",
                "best_candidate_id",
                "best_avg_score",
                "applied",
                "applied_at",
                "winner_lifecycle_state",
                "winner_proposal_id",
                "winner_canary_phase",
                "winner_rollback_reason",
                "best_rationale",
            ],
            _forge_runs_csv_rows(),
        )

    @router.get("/api/evolution/forge/addendums.csv")
    def forge_addendums_csv() -> Any:
        return _csv_response(
            ["scope", "recipe_id", "path", "size_bytes", "mtime", "iso_mtime", "preview"],
            _forge_addendums_csv_rows(),
        )
