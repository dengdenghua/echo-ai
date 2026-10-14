"""Computer automation API.

The surface is intentionally split into observe -> preview -> execute.
Mouse and keyboard actions are high-risk, so the UI must first create a
short-lived preview token and then send that token back for execution.

Route registration and per-request orchestration live here; the actual
logic is split across focused siblings (each independently importable and
tested) that take the router's shared mutable state (pending previews,
the exclusive-operator lease, the bounded activity log, the screenshot
root, and the ControlSessionStore) as an explicit ``ComputerRouterState``
parameter instead of closure capture:

  computer_router_state.py        the shared ComputerRouterState + constants
  computer_diagnostics.py         diagnostic/capability payload builders (pure)
  computer_replay_evidence.py     replay-evidence summary (needs state)
  computer_runtime_readiness.py   /status capability aggregation (needs state)
  computer_lease.py               exclusive-operator lease claim/release
  computer_control_session.py     ControlSessionStore bookkeeping + activity log
  computer_actions.py             action normalize/execute/preview + UIA planning
  _computer_appshot_routes.py     screenshot-grounded target route registration
  computer_vision.py              vision-model config + OpenAI-compatible call
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from ._computer_observe_routes import _register_screenshot_routes, _register_status_routes
from ._computer_plan_routes import (
    _register_ground_routes,
    _register_preview_and_plan_routes,
    _register_vision_routes,
)
from .computer_actions import (
    _execute,
    _execution_proof,
    _preview_contract,
)
from .computer_control_session import (
    _cleanup_pending,
    _ensure_control_session,
    _queue_uia_replay_assertion,
    _record_activity,
    _record_control_evidence,
    _update_control_action,
)
from .computer_diagnostics import _computer_diagnostic, _execution_failure_diagnostic
from .computer_lease import (
    _claim_lease,
    _effective_owner,
    _release_lease,
)
from .computer_replay_evidence import _computer_replay_evidence
from .computer_router_state import ComputerRouterState


def create_computer_router(
    *,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
    escalation: Any = None,
) -> APIRouter:
    def _auth_dep(request: Request) -> str | None:
        # Desktop automation can click/type on the host machine. Keep
        # the current friction-free local-dev behavior, but in auth-on
        # deploys reject anonymous access at the router boundary. Returns the
        # resolved actor so lease-mutating routes can bind the exclusive lease
        # to the authenticated principal instead of a spoofable body field.
        from runtime.safety.auth.principal import require_operator, resolve_principal

        principal = resolve_principal(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
        if require_auth:
            require_operator(
                request,
                identity_store,
                require_auth,
                jwt_secret=jwt_secret,
                jwt_issuer=jwt_issuer,
                jwt_audience=jwt_audience,
            )
        from runtime.platform.plugins.automation import require_automation_plugin

        require_automation_plugin(request, "computer_control")
        return principal.actor_id if principal is not None else None

    router = APIRouter(
        prefix="/api/computer",
        tags=["computer"],
        dependencies=[Depends(_auth_dep)],
    )
    state = ComputerRouterState(escalation=escalation)

    # Registration order is FastAPI's path-matching priority — keep it.
    # ``execute_action`` stays inline: it is a single 210-line endpoint.
    _register_status_routes(router, state)
    screenshot = _register_screenshot_routes(router, state)
    _register_preview_and_plan_routes(router, state, _auth_dep, screenshot)
    _register_ground_routes(router, state, screenshot)
    _register_vision_routes(router, state, screenshot)

    @router.post("/actions/execute")
    def execute_action(
        body: dict[str, Any], actor: str | None = Depends(_auth_dep)
    ) -> dict[str, Any]:
        _cleanup_pending(state)
        token = str(body.get("token") or "")
        control_action_id = str(body.get("control_action_id") or f"computer-preview-{token}")
        _update_control_action(state, body, control_action_id, status="running")
        item = state.pending.pop(token, None)
        if not item:
            diagnostic = _computer_diagnostic(
                "preview_token_missing",
                severity="error",
                message="Preview token was not found or has expired.",
                recommended_action="create_new_preview",
                metadata={"token_present": bool(token)},
            )
            _record_activity(
                state,
                "execute_rejected",
                ok=False,
                token=token,
                error="preview token not found or expired",
                detail={"diagnostic": diagnostic},
            )
            _update_control_action(
                state,
                body,
                control_action_id,
                status="failed",
                result={"diagnostic": diagnostic},
                error="preview token not found or expired",
            )
            _record_control_evidence(
                state,
                body,
                action_id=control_action_id,
                kind="result",
                action="computer_execute",
                ok=False,
                summary="preview token not found or expired",
                detail={"diagnostic": diagnostic, "token_present": bool(token)},
            )
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "preview token not found or expired",
                    "diagnostic": diagnostic,
                    "recommended_actions": ["create_new_preview"],
                    "replay_evidence": _computer_replay_evidence(state),
                },
            )
        body_owner = _effective_owner(body, actor)
        item_owner = item.get("lease_owner")
        if isinstance(item_owner, dict):
            owner = {
                "owner_id": str(item_owner.get("owner_id") or body_owner["owner_id"]),
                "owner_label": str(item_owner.get("owner_label") or body_owner["owner_label"]),
            }
            if body.get("lease_owner_id") and body_owner["owner_id"] != owner["owner_id"]:
                diagnostic = _computer_diagnostic(
                    "preview_owner_mismatch",
                    severity="error",
                    message="Preview token belongs to another operator.",
                    recommended_action="create_new_preview",
                    metadata={
                        "preview_owner_id": owner.get("owner_id"),
                        "requested_owner_id": body_owner.get("owner_id"),
                    },
                )
                _record_activity(
                    state,
                    "execute_rejected",
                    ok=False,
                    action=item.get("action") if isinstance(item.get("action"), dict) else {},
                    token=token,
                    risk=item.get("risk") if isinstance(item.get("risk"), dict) else {},
                    error="preview token belongs to another operator",
                    detail={
                        "lease_owner": owner,
                        "requested_owner": body_owner,
                        "diagnostic": diagnostic,
                    },
                )
                _update_control_action(
                    state,
                    body,
                    control_action_id,
                    status="failed",
                    result={"diagnostic": diagnostic},
                    error="preview token belongs to another operator",
                )
                _record_control_evidence(
                    state,
                    body,
                    action_id=control_action_id,
                    kind="result",
                    action="computer_execute",
                    ok=False,
                    summary="preview owner mismatch",
                    detail={"diagnostic": diagnostic},
                    owner=body_owner,
                )
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "preview token belongs to another operator",
                        "lease_owner": owner,
                        "diagnostic": diagnostic,
                        "recommended_actions": ["create_new_preview"],
                        "replay_evidence": _computer_replay_evidence(state),
                    },
                )
        else:
            owner = body_owner
        lease_state = _claim_lease(state, owner)
        action = item["action"]
        result = _execute(action)
        ok = "error" not in result
        diagnostic = _execution_failure_diagnostic(action, result) if not ok else {}
        raw_preview_contract = item.get("preview_contract")
        preview_contract: dict[str, Any]
        if isinstance(raw_preview_contract, dict):
            preview_contract = raw_preview_contract
        else:
            raw_risk = item.get("risk")
            preview_contract = _preview_contract(
                action,
                owner,
                raw_risk if isinstance(raw_risk, dict) else {},
            )
        execution_proof = _execution_proof(
            contract=preview_contract,
            action=action,
            risk=item["risk"],
            lease_state=lease_state,
            result=result,
            ok=ok,
        )
        _record_activity(
            state,
            "action_executed",
            ok=ok,
            action=action,
            token=token,
            risk=item["risk"],
            lease_state=lease_state,
            error=str(result.get("error") or ""),
            detail={
                "result": result,
                "preview_contract_id": preview_contract.get("contract_id"),
                "execution_proof_id": execution_proof.get("proof_id"),
                **({"diagnostic": diagnostic} if diagnostic else {}),
            },
            proof={
                "preview_contract": preview_contract,
                "execution_proof": execution_proof,
            },
        )
        replay_assertion = (
            action.get("replay_assertion")
            if isinstance(action.get("replay_assertion"), dict)
            else {}
        )
        assertion_queue = None
        if replay_assertion.get("ok") is False:
            assertion_queue = _queue_uia_replay_assertion(action, replay_assertion)
        payload = {
            "ok": ok,
            "action": action,
            "risk": item["risk"],
            "result": result,
            "preview_contract": preview_contract,
            "execution_proof": execution_proof,
            "lease": lease_state,
            "executed_at": time.time(),
            **({"replay_assertion_queue": assertion_queue} if assertion_queue else {}),
            **({"diagnostic": diagnostic} if diagnostic else {}),
            **({"recommended_actions": [diagnostic["recommended_action"]]} if diagnostic else {}),
            **({"replay_evidence": _computer_replay_evidence(state)} if not ok else {}),
        }
        _update_control_action(
            state,
            body,
            control_action_id,
            status="done" if ok else "failed",
            result={
                "result": result,
                "execution_proof_id": execution_proof.get("proof_id"),
                **({"diagnostic": diagnostic} if diagnostic else {}),
            },
            error=str(result.get("error") or ""),
        )
        _record_control_evidence(
            state,
            body,
            action_id=control_action_id,
            kind="result",
            action="computer_execute",
            ok=ok,
            summary="executed" if ok else str(result.get("error") or "execute failed"),
            detail={
                "action": action,
                "risk": item["risk"],
                "result": result,
                "preview_contract": preview_contract,
                "execution_proof": execution_proof,
            },
            owner=owner,
        )
        return payload

    _register_lease_routes(router, state, _auth_dep)

    return router


def _register_lease_routes(
    router: APIRouter,
    state: ComputerRouterState,
    _auth_dep: Callable[[Request], str | None],
) -> None:
    """Release the exclusive-operator lease."""

    @router.post("/lease/release")
    def release_lease(
        body: dict[str, Any] | None = None, actor: str | None = Depends(_auth_dep)
    ) -> dict[str, Any]:
        owner = _effective_owner(body, actor)
        force = bool((body or {}).get("force", False))
        lease_state = _release_lease(state, owner, force=force)
        _ensure_control_session(state, body, owner)
        _record_control_evidence(
            state,
            body,
            kind="lease",
            action="computer_lease_release",
            ok=True,
            summary="lease released",
            detail={"lease": lease_state, "force": force},
            owner=owner,
        )
        _record_activity(
            state,
            "lease_released",
            lease_state=lease_state,
            detail={"owner": owner, "force": force},
        )
        return {
            "ok": True,
            "lease": lease_state,
        }
