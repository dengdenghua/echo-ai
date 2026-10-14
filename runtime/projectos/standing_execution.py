"""Run an owner-reviewed grant through the existing execution engine gates."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from runtime.projectos.governance import budget_status, phase_fingerprint, reported_cost
from runtime.projectos.standing_model_calls import StandingModelBoundary, standing_model_boundary
from runtime.projectos.standing_review import standing_authorization_state
from runtime.safety.approval.cancellation import (
    CancellationSource,
    current_cancellation_token,
    scoped_cancellation,
)


def run_reviewed_project(
    engine: Any,
    project_id: str,
    *,
    actor_id: str,
    tenant_id: str,
    grant_id: str,
    validate_identity: Callable[[], bool],
    max_ticks: int = 20,
) -> dict[str, Any]:
    """Fence this run to one grant and recheck before every engine call boundary.

    In-flight calls may settle beyond the latest reported ceiling. Unknown
    receipts or an exhausted ceiling prevent the next call, including QA.
    This never changes initiation, phase or delivery approval state.
    """
    parent = current_cancellation_token()
    source = CancellationSource(parent=parent)
    selected_phase = [""]

    def ensure_admitted() -> None:
        parent.throw_if_cancelled()
        reason = "standing_authorization_unavailable"
        try:
            if not validate_identity():
                reason = "standing_owner_identity_unavailable"
                raise ValueError(reason)
            state = standing_authorization_state(
                engine.store, project_id, actor_id=actor_id, tenant_id=tenant_id
            )
            if state is None or state["grant_id"] != grant_id:
                raise ValueError(reason)
            project = engine.store.get_project(project_id)
            phase_id = selected_phase[0] or (project.current_ms if project else "")
            milestone = engine.store.get_milestone(phase_id) if phase_id else None
            if project is None or project.status not in {"planning", "running"}:
                raise ValueError(reason)
            if milestone is None or milestone.id not in project.milestone_ids:
                raise ValueError(reason)
            if phase_fingerprint(milestone) not in state["phase_fingerprints"]:
                reason = "phase_outside_standing_scope"
                raise ValueError(reason)
            cap = milestone.spec.get("ai_budget_usd")
            if type(cap) not in (int, float) or not math.isfinite(cap) or cap <= 0:
                reason = "standing_phase_budget_unavailable"
                raise ValueError(reason)
            spent = reported_cost(engine.store, project_id)
            if not math.isfinite(spent) or spent < 0 or spent >= state["limit_usd"]:
                reason = "standing_budget_exhausted"
                raise ValueError(reason)
            status = budget_status(engine.store, project_id, milestone)
            if status["paused"]:
                reason = f"standing_budget_{status['reason']}"
                raise ValueError(reason)
        except (PermissionError, ValueError, TypeError, KeyError):
            source.cancel(reason=reason)
        source.token.throw_if_cancelled()

    def phase_hook(hook: Callable[..., Any], milestone_index: int):
        def call(*args: Any, **kwargs: Any):
            milestone = args[milestone_index]
            selected_phase[0] = milestone.id
            ensure_admitted()
            current = engine.store.get_milestone(milestone.id)
            if current is None or phase_fingerprint(current) != phase_fingerprint(milestone):
                source.cancel(reason="standing_phase_changed")
                source.token.throw_if_cancelled()
            return hook(*args, **kwargs)

        return call

    def task_hook(hook: Callable[..., Any]):
        def call(task: Any, *args: Any, **kwargs: Any):
            selected_phase[0] = task.milestone_id
            ensure_admitted()
            return hook(task, *args, **kwargs)

        return call

    # Every engine is created for this one worker. Manual engines retain their
    # original hooks and do not inherit a standing model boundary.
    engine._decompose = phase_hook(engine._decompose, 0)
    engine._execute = task_hook(engine._execute)
    engine._qa = phase_hook(engine._qa, 1)
    if engine._run_task_team is not None:
        engine._run_task_team = task_hook(engine._run_task_team)
    if engine._run_task_human is not None:

        def human_requires_owner(*_args: Any, **_kwargs: Any):
            source.cancel(reason="standing_human_work_requires_owner")
            source.token.throw_if_cancelled()

        engine._run_task_human = human_requires_owner
    with (
        scoped_cancellation(source.token),
        standing_model_boundary(
            StandingModelBoundary(engine.store, project_id, ensure_admitted),
        ),
    ):
        project = engine.store.get_project(project_id)
        if project is not None:
            selected_phase[0] = project.current_ms or next(
                (
                    ms.id
                    for ms in engine.store.milestones_for(project_id)
                    if ms.status not in {"done", "failed", "blocked"}
                ),
                "",
            )
        ensure_admitted()
        return engine.run(project_id, max_ticks=max_ticks)
