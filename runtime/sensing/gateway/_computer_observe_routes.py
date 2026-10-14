"""Status, activity, screenshot, and UIA observation routes for computer automation.

Pure structural split of ``computer_router.create_computer_router`` — no
logic changes. The register functions take the router's shared
``ComputerRouterState`` (and, where needed, the auth dependency and the
``screenshot`` endpoint other routes call) explicitly; the factory still owns
the registration order.
"""

from __future__ import annotations

import base64
import time
import uuid
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from runtime.execution.suckers import computer_skills, computer_uia_skills
from runtime.safety.replay.browser_desktop_replay import computer_activity_replay_identity

from .computer_control_session import (
    _cleanup_pending,
    _queue_activity_replay_case,
    _record_control_action,
    _record_control_evidence,
    _update_control_action,
)
from .computer_lease import (
    _lease_from_body,
    _public_lease,
)
from .computer_router_state import ComputerRouterState
from .computer_runtime_readiness import _runtime_readiness

_ScreenshotHandler = Callable[[dict[str, Any] | None], dict[str, Any]]
_AuthDependency = Callable[[Request], str | None]


def _register_status_routes(router: APIRouter, state: ComputerRouterState) -> None:
    """Runtime status, the activity log, and its replay-case export / queue."""

    @router.get("/status")
    def status() -> dict[str, Any]:
        _cleanup_pending(state)
        lease_state = _public_lease(state)
        info = computer_skills._screen_info()
        uia_status = computer_uia_skills._computer_uia_status()
        readiness = _runtime_readiness(
            state,
            screen_info=info,
            uia_status=uia_status,
            lease_state=lease_state,
        )
        return {
            "schema": "echo.computer_runtime_status.v1",
            "ok": "error" not in info,
            "ready": readiness["ready"],
            "health": readiness["health"],
            "pyautogui_available": bool(computer_skills.PYAUTOGUI_AVAILABLE),
            "uia_available": bool(uia_status.get("available")),
            "uia": uia_status,
            "lease": lease_state,
            "screen": info,
            "readiness": readiness,
            "capabilities": readiness["capabilities"],
            "degraded_capabilities": readiness["degraded_capabilities"],
            "critical_blockers": readiness["critical_blockers"],
            "recommended_actions": readiness["recommended_actions"],
            "replay_evidence": readiness["replay_evidence"],
            "activity_count": len(state.activity),
            "recent_activity": state.activity[-10:],
            "skills": [
                "screen_capture",
                "screen_info",
                "mouse_click",
                "mouse_move",
                "keyboard_type",
                "keyboard_press",
                "computer_observe",
                "computer_plan_next",
                "computer_preview_action",
                "computer_execute_token",
                "computer_use_loop",
                "computer_uia_status",
                "computer_uia_tree",
                "computer_uia_find",
            ],
            "mode": "preview-confirm-execute-with-lease",
        }

    @router.get("/activity")
    def computer_activity(
        limit: int = Query(default=50, ge=1, le=500),
    ) -> dict[str, Any]:
        _cleanup_pending(state)
        return {
            "schema": "echo.computer_activity.v1",
            "count": len(state.activity),
            "pending_count": len(state.pending),
            "lease": _public_lease(state),
            "items": state.activity[-limit:],
        }

    @router.get("/activity/replay-case")
    def computer_activity_replay_case(
        limit: int = Query(default=100, ge=1, le=500),
    ) -> dict[str, Any]:
        _cleanup_pending(state)
        items = state.activity[-limit:]
        identity = computer_activity_replay_identity(
            items=[item for item in items if isinstance(item, dict)],
            pending_count=len(state.pending),
        )
        return {
            "schema": "echo.computer_activity_replay_case.v1",
            "case_id": identity["case_id"],
            "fingerprint": identity["fingerprint"],
            "replay_ready": bool(items),
            "activity_count": len(items),
            "pending_count": len(state.pending),
            "lease": _public_lease(state),
            "items": items,
            "last_activity": items[-1] if items else None,
        }

    @router.post("/activity/replay-case/queue")
    def computer_activity_replay_case_queue(body: dict[str, Any] | None = None) -> dict[str, Any]:
        body = body or {}
        limit = int(body.get("limit") or 100)
        limit = max(1, min(500, limit))
        replay_case = computer_activity_replay_case(limit=limit)
        if not replay_case.get("replay_ready"):
            raise HTTPException(409, "computer activity replay case has no actions to review")
        queued = _queue_activity_replay_case(
            replay_case,
            reason=str(body.get("reason") or ""),
            priority=str(body.get("priority") or ""),
        )
        return {
            "ok": True,
            "schema": "echo.computer_activity_replay_case_queue.v1",
            "replay_case": replay_case,
            "queue": queued,
        }


def _register_screenshot_routes(
    router: APIRouter, state: ComputerRouterState
) -> _ScreenshotHandler:
    """Screenshot capture plus UIA status / tree / find.

    Returns the ``screenshot`` endpoint, which planning routes also call.
    """

    @router.post("/screenshot")
    def screenshot(body: dict[str, Any] | None = None) -> dict[str, Any]:
        body = body or {}
        owner = _lease_from_body(body)
        control_action_id = _record_control_action(
            state,
            body,
            action_type="computer_observe",
            descriptor={"type": "screenshot", "region": body.get("region")},
            status="running",
            owner=owner,
        )
        state.screenshot_root.mkdir(parents=True, exist_ok=True)
        shot_path = state.screenshot_root / f"{int(time.time())}_{uuid.uuid4().hex[:8]}.png"
        region = body.get("region")
        result = computer_skills._screen_capture(
            path=str(shot_path),
            sandbox_dir=str(state.screenshot_root),
            region=region if isinstance(region, list) else None,
        )
        if "error" in result:
            _update_control_action(
                state,
                body,
                control_action_id,
                status="failed",
                result=result,
                error=str(result.get("error") or ""),
            )
            _record_control_evidence(
                state,
                body,
                action_id=control_action_id,
                kind="screenshot",
                action="computer_observe",
                ok=False,
                summary=str(result.get("error") or "screenshot failed"),
                detail=result,
                owner=owner,
            )
            return {"ok": False, "error": result["error"]}
        data = shot_path.read_bytes()
        payload = {
            "ok": True,
            "path": str(shot_path),
            "size_bytes": len(data),
            "data_url": "data:image/png;base64," + base64.standard_b64encode(data).decode("ascii"),
            "created_at": time.time(),
        }
        _update_control_action(
            state,
            body,
            control_action_id,
            status="done",
            result={key: value for key, value in payload.items() if key != "data_url"},
        )
        _record_control_evidence(
            state,
            body,
            action_id=control_action_id,
            kind="screenshot",
            action="computer_observe",
            ok=True,
            summary=f"{len(data)} bytes",
            detail={
                "path": str(shot_path),
                "size_bytes": len(data),
                "created_at": payload["created_at"],
            },
            owner=owner,
        )
        return payload

    @router.get("/uia/status")
    def uia_status() -> dict[str, Any]:
        return computer_uia_skills._computer_uia_status()

    @router.get("/uia/tree")
    def uia_tree(
        root: str = Query(default="foreground"),
        max_depth: int = Query(default=2, ge=0, le=8),
        max_nodes: int = Query(default=80, ge=1, le=1000),
        max_children: int = Query(default=30, ge=1, le=200),
        include_offscreen: bool = Query(default=False),
    ) -> dict[str, Any]:
        return computer_uia_skills._computer_uia_tree(
            root=root,
            max_depth=max_depth,
            max_nodes=max_nodes,
            max_children=max_children,
            include_offscreen=include_offscreen,
        )

    @router.get("/uia/find")
    def uia_find(
        query: str = Query(default=""),
        exact: bool = Query(default=False),
        root: str = Query(default="foreground"),
        max_results: int = Query(default=20, ge=1, le=100),
        max_depth: int = Query(default=5, ge=0, le=8),
        max_nodes: int = Query(default=300, ge=1, le=1000),
        include_offscreen: bool = Query(default=False),
    ) -> dict[str, Any]:
        return computer_uia_skills._computer_uia_find(
            query=query,
            exact=exact,
            root=root,
            max_results=max_results,
            max_depth=max_depth,
            max_nodes=max_nodes,
            include_offscreen=include_offscreen,
        )

    return screenshot
