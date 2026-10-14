"""Owner decisions for governed projects outside the chat.

In chat, ``/project`` asks the owner through approval prompts
(``realtime_project_initiation`` / ``_phase`` / ``_acceptance``). The project
page and REST clients cannot hold a prompt open, so the same decisions are
explicit calls that carry the fingerprint of exactly what the owner saw. Each
writes the event the chat writes (``project.phase_authorized``,
``project.delivery_accepted``, ``project.budget_changed``) plus
``project.initiation_approved``, so the engine gates treat both surfaces the
same way. Nothing here executes a task.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Callable
from typing import Any

from runtime.projectos.acceptance import (
    delivery_accepted,
    delivery_fingerprint,
    has_delivery_content,
)
from runtime.projectos.governance import (
    INITIATION_APPROVED_KIND,
    INITIATION_REQUIRED_STATES,
    budget_status,
    initiation_approval,
    initiation_state,
    ordered_milestones,
    phase_agents_of,
    phase_authorized,
    phase_fingerprint,
    plan_fingerprint,
    select_phase,
)
from runtime.projectos.model import Milestone, Project

_CLOSED = frozenset({"done", "failed"})
_UNSET: Any = object()


class OwnerDecisionError(Exception):
    """A decision that cannot be applied; ``status`` maps to the HTTP code."""

    def __init__(self, status: int, code: str, message: str, **detail: Any) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail

    def to_detail(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.detail}


def _load(store: Any, project_id: str) -> tuple[Project, list[Milestone]]:
    project = store.get_project(project_id)
    if project is None:
        raise OwnerDecisionError(404, "PROJECT_NOT_FOUND", "project not found")
    if project.status in _CLOSED:
        raise OwnerDecisionError(
            409,
            "PROJECT_TERMINAL",
            "project is finished or cancelled; no further decisions apply",
            status=project.status,
        )
    return project, ordered_milestones(project, store.milestones_for(project.id))


def _unstaffed(milestones: list[Milestone]) -> list[Milestone]:
    return [ms for ms in milestones if ms.status not in _CLOSED and not phase_agents_of(ms)]


def initiation_fingerprint(
    project: Project, milestones: list[Milestone], proposed_agents: list[str]
) -> str:
    """The plan plus the members an approval would assign to unstaffed phases."""
    return hashlib.sha256(
        f"{plan_fingerprint(project, milestones)}|{','.join(proposed_agents)}".encode()
    ).hexdigest()


def governance_view(
    store: Any,
    project: Project,
    milestones: list[Milestone] | None = None,
    *,
    roster: list[str] | None = None,
) -> dict[str, Any]:
    """What the owner must decide next, with the fingerprints to decide on."""

    phases = ordered_milestones(
        project, milestones if milestones is not None else store.milestones_for(project.id)
    )
    state = initiation_state(store, project, phases)
    unstaffed = [ms.id for ms in _unstaffed(phases)]
    proposed = sorted(set(roster or [])) if unstaffed else []
    approval = initiation_approval(store, project.id)
    initiation = {
        "state": state,
        "required": state in INITIATION_REQUIRED_STATES,
        "fingerprint": initiation_fingerprint(project, phases, proposed),
        "unstaffed_milestone_ids": unstaffed,
        "proposed_phase_agents": proposed,
        # A new project needs a team; a legacy plan without a group may be
        # approved as it is and keeps its pre-governance execution.
        "staffing_available": not unstaffed or bool(proposed) or state == "legacy",
        "governs": not unstaffed or bool(proposed),
        "approved_by": (approval or {}).get("actor"),
        "approved_at": (approval or {}).get("approved_at"),
    }
    terminal = project.status in _CLOSED
    phase = None if terminal else select_phase(project, phases)
    phase_view = None
    if phase is not None:
        phase_view = {
            "milestone_id": phase.id,
            "name": phase.name,
            "goal": phase.goal,
            "status": phase.status,
            "phase_agents": phase_agents_of(phase),
            "ai_budget_usd": phase.spec.get("ai_budget_usd"),
            "success_criteria": list(phase.success_criteria),
            "authorized": phase_authorized(store, project.id, phase),
            "fingerprint": phase_fingerprint(phase),
            "budget": budget_status(store, project.id, phase),
        }
    acceptance = []
    for ms in [] if terminal else phases:
        if not ms.spec.get("requires_owner_acceptance") or ms.status == "done":
            continue
        tasks = store.tasks_for_milestone(ms.id)
        if not tasks or any(t.status != "done" for t in tasks):
            continue
        if delivery_accepted(store, project.id, ms, tasks):
            continue
        acceptance.append(
            {
                "milestone_id": ms.id,
                "name": ms.name,
                "fingerprint": delivery_fingerprint(ms, tasks),
                "success_criteria": list(ms.success_criteria),
                "has_content": all(has_delivery_content(t.output) for t in tasks),
            }
        )
    blocked_reason = None
    if terminal:
        pass
    elif initiation["required"]:
        blocked_reason = "initiation"
    elif phase_view is not None and not phase_view["authorized"]:
        blocked_reason = "phase_authorization"
    elif acceptance:
        blocked_reason = "owner_acceptance"
    elif phase_view is not None and phase_view["budget"].get("paused"):
        blocked_reason = "budget"
    return {
        "initiation": initiation,
        "phase": phase_view,
        "acceptance": acceptance,
        "plan_fingerprint": plan_fingerprint(project, phases),
        "blocked_reason": blocked_reason,
    }


def approve_initiation(
    store: Any,
    project_id: str,
    *,
    actor: str,
    expected_fingerprint: str,
    roster: list[str] | None = None,
    ai_budget_usd: Any = _UNSET,
    source: str = "project_page",
) -> dict[str, Any]:
    """Record the owner's initiation approval, backfilling legacy phases.

    Unfinished phases missing a governance field get it now — members from the
    group roster the owner was shown, the stated budget (default: no cap, as
    in chat) and owner acceptance — so the project is governed from here on.
    A legacy plan with no group to staff it is approved as it is
    (``governed: False``): the owner allowed it to run, nothing is invented.
    """

    project, phases = _load(store, project_id)
    state = initiation_state(store, project, phases)
    if state not in INITIATION_REQUIRED_STATES:
        raise OwnerDecisionError(
            409,
            "INITIATION_NOT_REQUIRED",
            "project initiation is already approved",
            initiation_state=state,
        )
    view = governance_view(store, project, phases, roster=roster)["initiation"]
    if view["fingerprint"] != expected_fingerprint:
        raise OwnerDecisionError(
            409, "PLAN_CHANGED", "the plan or team changed; review it again before approving"
        )
    if not view["staffing_available"]:
        raise OwnerDecisionError(
            409,
            "PROJECT_NOT_STAFFED",
            "the project has no group members to staff its phases; attach it to a group first",
        )
    if ai_budget_usd is not _UNSET and ai_budget_usd is not None:
        ai_budget_usd = float(ai_budget_usd)
        if not math.isfinite(ai_budget_usd) or ai_budget_usd < 0:
            raise OwnerDecisionError(400, "INVALID_BUDGET", "AI budget must be a USD amount ≥ 0")
    backfilled: list[str] = []
    for ms in phases if view["governs"] else ():
        if ms.status in _CLOSED:
            continue
        spec = dict(ms.spec)
        if not phase_agents_of(ms):
            spec["phase_agents"] = list(view["proposed_phase_agents"])
        if ai_budget_usd is not _UNSET:
            spec["ai_budget_usd"] = ai_budget_usd
        spec.setdefault("ai_budget_usd", None)
        spec["requires_owner_acceptance"] = True
        if spec != ms.spec:
            ms.spec = spec
            # Rewrites only the spec of a phase that has not finished; a
            # blocked legacy phase keeps its status for explicit recovery.
            store.save_milestone(project.id, ms, allow_terminal_rewrite=True)
            backfilled.append(ms.id)
    payload = {
        "fingerprint": expected_fingerprint,
        "actor": actor,
        "previous_state": state,
        "backfilled_milestones": backfilled,
        "phase_agents": view["proposed_phase_agents"],
        "governed": view["governs"],
        "source": source,
    }
    if ai_budget_usd is not _UNSET:
        payload["ai_budget_usd"] = ai_budget_usd
    store.append_event(project.id, kind=INITIATION_APPROVED_KIND, payload=payload)
    return payload


def authorize_phase(
    store: Any,
    project_id: str,
    milestone_id: str,
    *,
    actor: str,
    expected_fingerprint: str,
    invite_members: Callable[[list[str]], None] | None = None,
    source: str = "project_page",
) -> dict[str, Any]:
    """Authorize the phase the next run executes — the chat's phase prompt."""

    project, phases = _load(store, project_id)
    if initiation_state(store, project, phases) in INITIATION_REQUIRED_STATES:
        raise OwnerDecisionError(
            409, "INITIATION_APPROVAL_REQUIRED", "approve the project initiation first"
        )
    phase = select_phase(project, phases)
    if phase is None or phase.id != milestone_id:
        raise OwnerDecisionError(
            409,
            "PHASE_NOT_CURRENT",
            "only the phase the next run executes can be authorized",
            current_milestone_id=phase.id if phase is not None else None,
        )
    agents = phase_agents_of(phase)
    if not agents:
        raise OwnerDecisionError(
            409, "PHASE_MEMBERS_UNAVAILABLE", "this phase has no members to authorize"
        )
    fingerprint = phase_fingerprint(phase)
    if fingerprint != expected_fingerprint:
        raise OwnerDecisionError(409, "PHASE_CHANGED", "the phase changed; review it again")
    payload = {"milestone_id": phase.id, "fingerprint": fingerprint, "agents": agents}
    if phase_authorized(store, project.id, phase):
        return {**payload, "already_authorized": True}
    if invite_members is not None:
        invite_members(agents)
    payload.update(actor=actor, source=source)
    store.append_event(project.id, kind="project.phase_authorized", payload=payload)
    return payload


def accept_delivery(
    store: Any,
    project_id: str,
    milestone_id: str,
    *,
    actor: str,
    expected_fingerprint: str,
    source: str = "project_page",
) -> dict[str, Any]:
    """Record owner acceptance of exactly the delivered task outputs."""

    project, phases = _load(store, project_id)
    milestone = next((ms for ms in phases if ms.id == milestone_id), None)
    if milestone is None:
        raise OwnerDecisionError(404, "MILESTONE_NOT_FOUND", "milestone not found")
    tasks = store.tasks_for_milestone(milestone.id)
    if not tasks or any(t.status != "done" for t in tasks):
        raise OwnerDecisionError(
            409, "DELIVERY_NOT_READY", "the phase has not finished its deliverables yet"
        )
    if any(not has_delivery_content(t.output) for t in tasks):
        raise OwnerDecisionError(
            409, "DELIVERY_EMPTY", "some tasks have no deliverable content to accept"
        )
    fingerprint = delivery_fingerprint(milestone, tasks)
    if fingerprint != expected_fingerprint:
        raise OwnerDecisionError(
            409, "DELIVERY_CHANGED", "the deliverables changed; review the latest version"
        )
    payload = {"milestone_id": milestone.id, "fingerprint": fingerprint}
    if delivery_accepted(store, project.id, milestone, tasks):
        return {**payload, "already_accepted": True}
    payload.update(actor=actor, source=source)
    store.append_event(project.id, kind="project.delivery_accepted", payload=payload)
    return payload


def set_budget(
    store: Any,
    project_id: str,
    *,
    actor: str,
    ai_budget_usd: float | None,
    expected_fingerprint: str,
    source: str = "project_page",
) -> dict[str, Any]:
    """Change the AI budget cap on every phase, like ``/project budget``.

    The phase fingerprint covers the cap, so the current phase must be
    authorized again before execution continues — the same as in chat.
    """

    project, phases = _load(store, project_id)
    if plan_fingerprint(project, phases) != expected_fingerprint:
        raise OwnerDecisionError(409, "PLAN_CHANGED", "the plan changed; review it again")
    if ai_budget_usd is not None and (not math.isfinite(ai_budget_usd) or ai_budget_usd < 0):
        raise OwnerDecisionError(400, "INVALID_BUDGET", "AI budget must be a USD amount ≥ 0")
    for ms in phases:
        ms.spec["ai_budget_usd"] = ai_budget_usd
        store.save_milestone(project.id, ms)
    payload = {"cap_usd": ai_budget_usd, "actor": actor, "source": source}
    store.append_event(project.id, kind="project.budget_changed", payload=payload)
    return payload


__all__ = [
    "OwnerDecisionError",
    "accept_delivery",
    "approve_initiation",
    "authorize_phase",
    "governance_view",
    "initiation_fingerprint",
    "set_budget",
]
