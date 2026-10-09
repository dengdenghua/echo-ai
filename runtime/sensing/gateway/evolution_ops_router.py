"""Evolution operator console control-plane routes.

The core self-evolution loop already exposes real learned rules via the
observability router. The frontend operator console, however, also expects a
broader set of control-plane endpoints for budgets, proposal queues, protocol
drift, and RecipeForge. These handlers derive as much state as possible from
the runtime Journal and return explicit disabled/no-op responses for subsystems
that are not configured.

When the full Reflex/RecipeForge admin router is mounted earlier in the app,
FastAPI will match those real routes first.
"""

from __future__ import annotations

from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any

try:
    from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment,misc]
    Depends = None  # type: ignore[assignment,misc]
    Header = None  # type: ignore[assignment,misc]
    HTTPException = None  # type: ignore[assignment,misc]
    Query = None  # type: ignore[assignment,misc]
    Request = None  # type: ignore[assignment,misc]

from runtime.sensing._fastapi_guard import require_fastapi

from ._evolution_ops_deps import EvolutionOpsDeps
from ._evolution_ops_forge_endpoints import _register_forge_routes, _register_forge_variant_routes
from ._evolution_ops_learning_endpoints import (
    _register_learning_projection_routes,
    _register_learning_routes,
)
from ._evolution_ops_proposal_endpoints import (
    _register_proposal_decision_routes,
    _register_skill_approval_routes,
)
from .evolution_ops import (
    _curriculum_goal_rows,
    _dispatch_snapshot,
    _framework_benchmark_rows,
    _protocol_drift_rows,
    _protocol_repair_rows,
    _scoped_journal,
    _write_curriculum_goal_decision,
    _write_protocol_drift_decision,
)


def create_evolution_ops_router(
    *,
    journal: Any = None,
    registry: Any = None,
    planner: Any = None,
    planner_provider: Any = None,
    thread_store: Any = None,
    forged_skill_dir: Path | str | None = None,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
    jwt_leeway_seconds: int = 0,
) -> Any:
    """Create evolution operator control-plane routes.

    The write endpoints in this router (skill proposal approve/reject,
    forge run/apply, forge auto-tick enable, MCP proposal install,
    breaker reset, etc.) materially mutate registry state and can
    install code from network-supplied recipes. In authenticated mode,
    these control-plane paths require an operator/admin identity. The
    explicit local ``require_auth=False`` mode remains available for
    isolated desktop and test runtimes.
    """
    require_fastapi(__name__)

    local_suppressed_skill_proposals: dict[str, set[str]] = {}

    def get_planner() -> Any:
        return planner_provider() if planner_provider is not None else planner

    forge_persist_dir = Path(forged_skill_dir) if forged_skill_dir is not None else None

    def _require_forge_dependencies() -> Path:
        missing = [
            name
            for name, value in (
                ("journal", journal),
                ("registry", registry),
                ("auto_persist_dir", forge_persist_dir),
            )
            if value is None
        ]
        if missing:
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "skill forge dependencies unavailable",
                    "missing": missing,
                },
            )
        assert forge_persist_dir is not None
        return forge_persist_dir

    def _principal(request: Any) -> Any:
        """Resolve the server-side operator principal for every route."""
        try:
            from runtime.safety.auth.principal import require_operator

            return require_operator(
                request,
                identity_store,
                require_auth,
                jwt_secret=jwt_secret,
                jwt_issuer=jwt_issuer,
                jwt_audience=jwt_audience,
                jwt_leeway_seconds=jwt_leeway_seconds,
            )
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            if require_auth:
                raise HTTPException(401, "auth required") from exc
            return None

    def _require_actor(request: Any) -> str | None:
        principal = _principal(request)
        return principal.actor_id if principal is not None else None

    def _operator_dep(request: Request) -> None:
        _principal(request)

    def _tenant_scope(request: Any, *, cross_tenant: bool = False) -> Any:
        from runtime.safety.auth.scope import TenantScope, scope_from_principal

        principal = getattr(getattr(request, "state", None), "principal", None)
        if principal is None:
            principal = _principal(request)
        if not cross_tenant:
            return scope_from_principal(principal)

        # Local single-user mode may still inspect legacy/global state, but
        # only after the caller explicitly opts in.  Authenticated deployments
        # require both an admin role and an explicit durable permission scope;
        # a plain tenant operator can never widen itself with a query flag.
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

    def _request_journal(request: Any, *, cross_tenant: bool = False) -> tuple[Any, Any]:
        scope = _tenant_scope(request, cross_tenant=cross_tenant)
        return _scoped_journal(journal, scope), scope

    def _projection_dependencies(scope: Any) -> tuple[Any, Any, Any]:
        if scope is not None and not scope.allow_cross_tenant:
            # Planner sections, the process-global skill registry, and the
            # legacy thread store are not tenant-partitioned.  Do not mix
            # their durable content into a tenant dashboard.
            return None, None, None
        return registry, get_planner(), thread_store

    def _journal_write_context(scope: Any) -> AbstractContextManager[Any]:
        from runtime.memory.journal import journal_context

        if scope is None:
            return journal_context()
        return journal_context(
            tenant_id=scope.tenant_id,
            owner_actor_id=scope.actor_id,
        )

    router = APIRouter(
        tags=["evolution-ops"],
        dependencies=[Depends(_operator_dep)],
    )

    def _suppressed_names(scope: Any) -> set[str]:
        key = (
            f"{scope.tenant_id}\x00{scope.actor_id}" if scope is not None else "__legacy_unscoped__"
        )
        return local_suppressed_skill_proposals.setdefault(key, set())

    d = EvolutionOpsDeps(
        journal=journal,
        registry=registry,
        planner=planner,
        planner_provider=planner_provider,
        get_planner=get_planner,
        require_forge_dependencies=_require_forge_dependencies,
        require_actor=_require_actor,
        tenant_scope=_tenant_scope,
        request_journal=_request_journal,
        projection_dependencies=_projection_dependencies,
        journal_write_context=_journal_write_context,
        suppressed_names=_suppressed_names,
    )

    # Registration order is FastAPI's path-matching priority — keep it.
    _register_learning_routes(router, d)
    _register_learning_projection_routes(router, d)
    _register_skill_approval_routes(router, d)
    _register_proposal_decision_routes(router, d)
    _register_curriculum_and_protocol_routes(router, d)
    _register_forge_routes(router, d)
    _register_forge_variant_routes(router, d)

    return router


def _register_curriculum_and_protocol_routes(router: APIRouter, d: EvolutionOpsDeps) -> None:
    """Curriculum goals, framework benchmarks, protocol drift / repair, dispatch."""
    journal = d.journal
    _require_actor = d.require_actor
    _request_journal = d.request_journal
    _journal_write_context = d.journal_write_context

    @router.get("/api/evolution/curriculum/goals")
    def curriculum_goals(
        request: Request,
        status: str | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        return _curriculum_goal_rows(scoped, status=status)

    @router.post("/api/evolution/curriculum/cycle/run")
    def run_curriculum_cycle(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        goals = _curriculum_goal_rows(scoped, status="pending")
        return {"ok": True, "created": len(goals), "source": "journal"}

    @router.post("/api/evolution/curriculum/goals/decide")
    def decide_curriculum_goal(
        request: Request,
        body: dict[str, Any] | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        payload = body or {}
        try:
            goal_id = int(payload.get("goal_id") or 0)
        except (TypeError, ValueError):
            goal_id = 0
        next_status = str(payload.get("status") or "").strip()
        if goal_id <= 0 or not next_status:
            return {
                "ok": False,
                "status": "invalid_request",
                "decision": payload,
                "source": "journal",
            }

        goals = _curriculum_goal_rows(scoped, status=None)
        goal = next((row for row in goals if int(row["id"]) == goal_id), None)
        if goal is None:
            return {
                "ok": False,
                "status": "not_found",
                "goal_id": goal_id,
                "decision": payload,
                "source": "journal",
            }

        with _journal_write_context(scope):
            _write_curriculum_goal_decision(
                journal,
                goal_id=goal_id,
                cluster_key=str(goal["cluster_key"]),
                status=next_status,
                covered_by=payload.get("covered_by"),
                reason=str(payload.get("reason") or ""),
                details={"title": goal["title"], "category": goal["category"]},
            )
        return {
            "ok": True,
            "status": next_status,
            "goal_id": goal_id,
            "cluster_key": goal["cluster_key"],
            "decision": payload,
            "source": "journal",
        }

    @router.get("/api/intel-evolution/frameworks/benchmarks")
    def framework_benchmarks(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        return _framework_benchmark_rows(scoped)

    @router.get("/api/intel-evolution/protocols/drift")
    def protocol_drift(
        request: Request,
        acknowledged: bool | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        return _protocol_drift_rows(scoped, acknowledged=acknowledged)

    @router.get("/api/intel-evolution/protocols/repair/proposals")
    def protocol_repair_proposals(
        request: Request,
        status: str | None = None,
        cross_tenant: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        return _protocol_repair_rows(scoped, status=status)

    @router.post("/api/intel-evolution/protocols/drift/scan")
    def scan_protocol_drift(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        rows = _protocol_drift_rows(scoped, acknowledged=None)
        return {"ok": True, "events": len(rows), "source": "journal"}

    @router.post("/api/intel-evolution/protocols/repair/sweep")
    def sweep_protocol_repairs(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        rows = _protocol_repair_rows(scoped, status="pending")
        return {"ok": True, "proposals": len(rows), "source": "journal"}

    @router.post("/api/intel-evolution/protocols/drift/{drift_id}/acknowledge")
    def acknowledge_protocol_drift(
        request: Request,
        drift_id: int,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        _actor = _require_actor(request)  # noqa: F841 — auth gate only
        scoped, scope = _request_journal(request, cross_tenant=cross_tenant)
        row = next(
            (
                item
                for item in _protocol_drift_rows(scoped, acknowledged=None)
                if int(item["id"]) == drift_id
            ),
            None,
        )
        if row is None:
            return {"ok": False, "id": drift_id, "acknowledged": False}
        with _journal_write_context(scope):
            _write_protocol_drift_decision(
                journal,
                drift_id=drift_id,
                protocol_id=str(row["protocol_id"]),
                status="acknowledged",
                reason="operator_acknowledged",
                details={"summary": row["summary"]},
            )
        return {"ok": True, "id": drift_id, "acknowledged": True}

    @router.get("/api/evolution/dispatch/snapshot")
    def dispatch_snapshot(
        request: Request,
        cross_tenant: bool = Query(default=False),
    ) -> dict[str, Any]:
        scoped, _scope = _request_journal(request, cross_tenant=cross_tenant)
        return _dispatch_snapshot(scoped)


__all__ = ["create_evolution_ops_router"]
