"""Preview, plan, ground, and vision routes for computer automation.

Pure structural split of ``computer_router.create_computer_router`` — no
logic changes. The register functions take the router's shared
``ComputerRouterState`` (and, where needed, the auth dependency and the
``screenshot`` endpoint other routes call) explicitly; the factory still owns
the registration order.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, Request

from ._computer_appshot_routes import register_computer_appshot_routes
from .computer_actions import (
    _actions_from_payload,
    _extract_json_payload,
    _normalize_action,
    _plan_actions,
    _queue_preview,
)
from .computer_control_session import (
    _cleanup_pending,
    _record_activity,
    _record_control_action,
    _record_control_evidence,
    _update_control_action,
)
from .computer_lease import (
    _effective_owner,
    _lease_from_body,
    _public_lease,
)
from .computer_router_state import ComputerRouterState
from .computer_vision import _call_openai_vision, _vision_model_config

_ScreenshotHandler = Callable[[dict[str, Any] | None], dict[str, Any]]
_AuthDependency = Callable[[Request], str | None]


def _register_preview_and_plan_routes(
    router: APIRouter,
    state: ComputerRouterState,
    _auth_dep: _AuthDependency,
    screenshot: _ScreenshotHandler,
) -> None:
    """Queue a preview, mount the appshot routes, and plan heuristic next steps."""

    @router.post("/actions/preview")
    def preview_action(
        body: dict[str, Any], actor: str | None = Depends(_auth_dep)
    ) -> dict[str, Any]:
        _cleanup_pending(state)
        owner = _effective_owner(body, actor)
        action = _normalize_action(body)
        preview = _queue_preview(state, action, owner)
        control_action_id = _record_control_action(
            state,
            body,
            action_id=str(body.get("control_action_id") or f"computer-preview-{preview['token']}"),
            action_type=str(action.get("action") or "computer_action"),
            descriptor={
                "type": "computer_preview",
                "action": action,
                "risk": preview["risk"],
                "preview_token": preview["token"],
                "preview_contract": preview["preview_contract"],
            },
            status="waiting_user",
            owner=owner,
        )
        _record_control_evidence(
            state,
            body,
            action_id=control_action_id,
            kind="action",
            action=str(action.get("action") or "computer_preview"),
            ok=True,
            summary=f"preview queued · {preview['risk']['level']}",
            detail={
                "token": preview["token"],
                "risk": preview["risk"],
                "preview_contract": preview["preview_contract"],
            },
            owner=owner,
        )
        _record_activity(
            state,
            "preview_queued",
            action=action,
            token=str(preview["token"]),
            risk=preview["risk"],
            detail={
                "lease_owner": owner,
                "preview_contract_id": preview["preview_contract"]["contract_id"],
            },
            proof={"preview_contract": preview["preview_contract"]},
        )
        return {
            "ok": True,
            "lease": _public_lease(state),
            **preview,
        }

    register_computer_appshot_routes(
        router=router,
        state=state,
        screenshot=screenshot,
        preview_action=preview_action,
        auth_dependency=_auth_dep,
    )

    @router.post("/actions/plan")
    def plan_actions(body: dict[str, Any]) -> dict[str, Any]:
        _cleanup_pending(state)
        owner = _lease_from_body(body)
        goal = str(body.get("goal") or "")
        capture = bool(body.get("capture", True))
        control_action_id = _record_control_action(
            state,
            body,
            action_type="computer_plan",
            descriptor={"type": "computer_plan", "goal": goal, "capture": capture},
            status="running",
            owner=owner,
        )
        screenshot_data: dict[str, Any] | None = None
        if capture:
            screenshot_data = screenshot(
                {**body, "control_action_id": f"{control_action_id}:screenshot"}
            )

        suggestions = []
        for idx, action in enumerate(_plan_actions(goal), start=1):
            preview = _queue_preview(state, action, owner)
            suggestions.append(
                {
                    "id": f"step-{idx}",
                    "title": f"Step {idx}: {action['action']}",
                    "rationale": "Heuristic next action based on the task text and current screen observation.",
                    **preview,
                }
            )
            _record_control_action(
                state,
                body,
                action_id=f"computer-preview-{preview['token']}",
                action_type=str(action.get("action") or "computer_action"),
                descriptor={
                    "type": "computer_preview",
                    "goal": goal,
                    "action": action,
                    "risk": preview["risk"],
                    "preview_token": preview["token"],
                },
                status="waiting_user",
                owner=owner,
            )
        _record_activity(
            state,
            "plan_created",
            detail={
                "goal": goal,
                "suggestion_count": len(suggestions),
                "capture": capture,
            },
        )
        payload = {
            "ok": True,
            "goal": goal,
            "screenshot": screenshot_data,
            "suggestions": suggestions,
            "mode": "observe-plan-confirm",
            "lease": _public_lease(state),
            "limitations": [
                "This first pass uses local heuristics and UIA semantic grounding when available.",
                "Visual screenshot grounding is only used by /actions/vision, not this local planner.",
                "Every suggested action still requires explicit user confirmation before execution.",
            ],
        }
        _update_control_action(
            state,
            body,
            control_action_id,
            status="done",
            result={"suggestion_count": len(suggestions), "mode": payload["mode"]},
        )
        _record_control_evidence(
            state,
            body,
            action_id=control_action_id,
            kind="result",
            action="computer_plan",
            ok=True,
            summary=f"{len(suggestions)} suggestion(s)",
            detail={
                "goal": goal,
                "suggestions": [
                    {
                        "id": item.get("id"),
                        "title": item.get("title"),
                        "action": item.get("action"),
                        "risk": item.get("risk"),
                        "token": item.get("token"),
                    }
                    for item in suggestions
                ],
            },
            owner=owner,
        )
        return payload


def _register_ground_routes(
    router: APIRouter, state: ComputerRouterState, screenshot: _ScreenshotHandler
) -> None:
    """Validate pasted vision-model output into confirmable action previews."""

    @router.post("/actions/ground")
    def ground_actions(body: dict[str, Any]) -> dict[str, Any]:
        _cleanup_pending(state)
        owner = _lease_from_body(body)
        goal = str(body.get("goal") or "")
        output = body.get("output")
        capture = bool(body.get("capture", True))
        control_action_id = _record_control_action(
            state,
            body,
            action_type="computer_ground",
            descriptor={"type": "computer_ground", "goal": goal, "capture": capture},
            status="running",
            owner=owner,
        )
        screenshot_data: dict[str, Any] | None = None
        if capture:
            screenshot_data = screenshot(
                {**body, "control_action_id": f"{control_action_id}:screenshot"}
            )

        if output is None:
            _update_control_action(
                state,
                body,
                control_action_id,
                status="done",
                result={"suggestion_count": 0, "mode": "vision-output-adapter"},
            )
            _record_control_evidence(
                state,
                body,
                action_id=control_action_id,
                kind="result",
                action="computer_ground",
                ok=True,
                summary="schema helper returned",
                detail={"goal": goal, "suggestion_count": 0},
                owner=owner,
            )
            return {
                "ok": True,
                "goal": goal,
                "screenshot": screenshot_data,
                "suggestions": [],
                "mode": "vision-output-adapter",
                "lease": _public_lease(state),
                "schema": {
                    "actions": [
                        {"action": "click", "x": 100, "y": 200, "button": "left"},
                        {"action": "type", "text": "hello"},
                        {"action": "key", "keys": ["enter"]},
                    ]
                },
                "limitations": [
                    "No vision model output was provided.",
                    "Paste a JSON action from any vision model to validate and queue it.",
                ],
            }

        payload = _extract_json_payload(output if isinstance(output, str) else json.dumps(output))
        actions = _actions_from_payload(payload)
        suggestions = []
        for idx, action in enumerate(actions, start=1):
            preview = _queue_preview(state, action, owner)
            suggestions.append(
                {
                    "id": f"vision-{idx}",
                    "title": f"Vision {idx}: {action['action']}",
                    "rationale": "Validated action parsed from vision model output.",
                    **preview,
                }
            )
            _record_control_action(
                state,
                body,
                action_id=f"computer-preview-{preview['token']}",
                action_type=str(action.get("action") or "computer_action"),
                descriptor={
                    "type": "computer_preview",
                    "goal": goal,
                    "action": action,
                    "risk": preview["risk"],
                    "preview_token": preview["token"],
                    "source": "ground",
                },
                status="waiting_user",
                owner=owner,
            )
        _record_activity(
            state,
            "grounded_actions_created",
            detail={"goal": goal, "suggestion_count": len(suggestions)},
        )
        payload = {
            "ok": True,
            "goal": goal,
            "screenshot": screenshot_data,
            "suggestions": suggestions,
            "mode": "vision-output-adapter",
            "lease": _public_lease(state),
            "limitations": [
                "This endpoint validates vision output but does not execute automatically.",
                "Every parsed action still requires explicit user confirmation.",
            ],
        }
        _update_control_action(
            state,
            body,
            control_action_id,
            status="done",
            result={"suggestion_count": len(suggestions), "mode": payload["mode"]},
        )
        _record_control_evidence(
            state,
            body,
            action_id=control_action_id,
            kind="result",
            action="computer_ground",
            ok=True,
            summary=f"{len(suggestions)} grounded action(s)",
            detail={"goal": goal, "suggestion_count": len(suggestions)},
            owner=owner,
        )
        return payload


def _register_vision_routes(
    router: APIRouter, state: ComputerRouterState, screenshot: _ScreenshotHandler
) -> None:
    """Ground actions through the configured vision model."""

    @router.post("/actions/vision")
    def vision_actions(body: dict[str, Any]) -> dict[str, Any]:
        _cleanup_pending(state)
        owner = _lease_from_body(body)
        goal = str(body.get("goal") or "")
        model_id = str(body.get("model_id") or "")
        control_action_id = _record_control_action(
            state,
            body,
            action_type="computer_vision",
            descriptor={"type": "computer_vision", "goal": goal, "model_id": model_id},
            status="running",
            owner=owner,
        )
        config = _vision_model_config(model_id)
        screenshot_data = screenshot(
            {**body, "control_action_id": f"{control_action_id}:screenshot"}
        )
        if not screenshot_data.get("ok"):
            _update_control_action(
                state,
                body,
                control_action_id,
                status="failed",
                result={"screenshot": screenshot_data},
                error=str(screenshot_data.get("error") or "screenshot failed"),
            )
            return {
                "ok": False,
                "goal": goal,
                "screenshot": screenshot_data,
                "suggestions": [],
                "mode": "vision-model",
                "lease": _public_lease(state),
                "error": screenshot_data.get("error") or "screenshot failed",
            }
        if not config:
            _update_control_action(
                state,
                body,
                control_action_id,
                status="failed",
                result={"screenshot": screenshot_data},
                error="vision model not configured",
            )
            return {
                "ok": False,
                "goal": goal,
                "screenshot": screenshot_data,
                "suggestions": [],
                "mode": "vision-model",
                "lease": _public_lease(state),
                "error": (
                    "vision model not configured · pass model_id for a custom openai-compatible "
                    "model or set ECHO_COMPUTER_VISION_* env vars"
                ),
            }
        data_url = str(screenshot_data.get("data_url") or "")
        output = _call_openai_vision(config=config, goal=goal, data_url=data_url)
        payload = _extract_json_payload(output)
        actions = _actions_from_payload(payload)
        suggestions = []
        for idx, action in enumerate(actions, start=1):
            preview = _queue_preview(state, action, owner)
            suggestions.append(
                {
                    "id": f"vision-model-{idx}",
                    "title": f"Vision model {idx}: {action['action']}",
                    "rationale": "Grounded action returned by the configured vision model.",
                    **preview,
                }
            )
            _record_control_action(
                state,
                body,
                action_id=f"computer-preview-{preview['token']}",
                action_type=str(action.get("action") or "computer_action"),
                descriptor={
                    "type": "computer_preview",
                    "goal": goal,
                    "action": action,
                    "risk": preview["risk"],
                    "preview_token": preview["token"],
                    "source": "vision",
                },
                status="waiting_user",
                owner=owner,
            )
        _record_activity(
            state,
            "vision_actions_created",
            detail={
                "goal": goal,
                "model_id": str(config.get("id") or model_id),
                "suggestion_count": len(suggestions),
            },
        )
        payload = {
            "ok": True,
            "goal": goal,
            "model_id": str(config.get("id") or model_id),
            "screenshot": screenshot_data,
            "suggestions": suggestions,
            "mode": "vision-model",
            "lease": _public_lease(state),
            "raw_output": output,
            "limitations": [
                "The screenshot is sent to the configured vision model provider.",
                "Returned actions are validated and require explicit user confirmation.",
            ],
        }
        _update_control_action(
            state,
            body,
            control_action_id,
            status="done",
            result={"suggestion_count": len(suggestions), "mode": payload["mode"]},
        )
        _record_control_evidence(
            state,
            body,
            action_id=control_action_id,
            kind="result",
            action="computer_vision",
            ok=True,
            summary=f"{len(suggestions)} vision action(s)",
            detail={"goal": goal, "model_id": str(config.get("id") or model_id)},
            owner=owner,
        )
        return payload
