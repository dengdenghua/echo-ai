"""Standing authorization — advance a project unattended, within fixed bounds.

Explicit ``/project run`` advances a project while the user waits. A months-long
project needs the loop to continue when nobody is watching, which means the user
must be able to say "keep going" in advance. That permission has to be bounded,
revocable and fail-closed, or it becomes a way to spend budget and invoke tools
on work the user never reviewed.

The bounds reuse what Project OS already enforces:

* **Scope is a set of phase fingerprints, not a time window.**
  ``governance.phase_fingerprint`` already invalidates an authorization when the
  plan changes. Naming the exact phases inherits that property: rewriting a
  phase drops it out of the grant instead of silently keeping it covered. A
  "valid for 7 days" grant would have no content boundary at all.
* **Spending stops at this grant's own ceiling**, checked on top of — never
  instead of — the per-phase ``ai_budget_usd`` gate in ``governance``. That gate
  already compares cumulative project spend against the active phase's cap;
  this one bounds what unattended execution in particular may add.
* **Revocation is durable and immediate in effect**: once revoked, the next
  admission check fails. In-flight work settles under the existing stop
  semantics rather than being killed mid-task.

Approvals stay human. A standing authorization lets the loop finish work inside
phases the user already authorized; it never approves initiation, a new phase,
or owner acceptance. What it removes is the need to come back and retype
``/project run`` — not the need to decide.

Fail-closed by construction: no grant, an unparseable grant, a phase outside
the grant, or an unreadable cost all deny admission.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

_logger = logging.getLogger(__name__)

GRANTED_KIND = "project.standing_authorization_granted"
REVOKED_KIND = "project.standing_authorization_revoked"

# A grant is recorded by an explicit human confirmation in the UI. Anything
# else — a script, an API caller replaying a payload — is not a human approval,
# so the source is recorded and checked rather than assumed.
UI_CONFIRMATION_SOURCE = "ui_owner_confirmation"

# Events are read newest-first; a grant/revocation pair lives near the head.
_EVENT_SCAN_LIMIT = 500


@dataclass(frozen=True, slots=True)
class AdmissionDecision:
    """Whether unattended execution may advance this phase right now."""

    admitted: bool
    reason: str
    phase_id: str = ""
    remaining_usd: float | None = None

    @property
    def denied(self) -> bool:
        return not self.admitted


@dataclass(frozen=True, slots=True)
class StandingGrant:
    """The active grant: which phases, how much, and who confirmed it."""

    phase_fingerprints: frozenset[str]
    limit_usd: float
    granted_by: str
    source: str

    @property
    def from_human_confirmation(self) -> bool:
        return self.source == UI_CONFIRMATION_SOURCE


def active_grant(store: Any, project_id: str) -> StandingGrant | None:
    """The current grant, or ``None`` when there is none to act on.

    Scans newest-first and stops at the first grant or revocation, so a
    revocation always beats the grant it supersedes and re-granting after a
    revocation works. Every failure path returns ``None``: unattended execution
    must not proceed on a grant we could not read.
    """

    events_for_project = getattr(store, "events_for_project", None)
    if not callable(events_for_project):
        return None
    try:
        # The store selects the newest ``limit`` rows and then reverses them,
        # so this list is oldest-first. Walk it backwards to reach the most
        # recent grant/revocation first.
        events = list(events_for_project(project_id, limit=_EVENT_SCAN_LIMIT))
    except Exception:  # noqa: BLE001 - unreadable history denies admission
        _logger.debug("standing authorization unreadable for %s", project_id, exc_info=True)
        return None

    for event in reversed(events):
        if not isinstance(event, dict):
            continue
        kind = str(event.get("kind") or "")
        if kind == REVOKED_KIND:
            return None
        if kind != GRANTED_KIND:
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            # A malformed grant is not a grant.
            return None
        return _grant_from_payload(payload)
    return None


def _grant_from_payload(payload: dict) -> StandingGrant | None:
    raw_fingerprints = payload.get("phase_fingerprints")
    if not isinstance(raw_fingerprints, list):
        return None
    fingerprints = frozenset(
        str(value).strip() for value in raw_fingerprints if str(value or "").strip()
    )
    if not fingerprints:
        # An empty scope authorizes nothing; treat it as absent rather than as
        # a grant that happens to admit no phase.
        return None
    try:
        limit_usd = float(payload.get("limit_usd"))
    except (TypeError, ValueError):
        return None
    if not limit_usd > 0:
        return None
    return StandingGrant(
        phase_fingerprints=fingerprints,
        limit_usd=limit_usd,
        granted_by=str(payload.get("granted_by") or ""),
        source=str(payload.get("source") or ""),
    )


def admits_unattended_phase(store: Any, project_id: str, milestone: Any) -> AdmissionDecision:
    """Whether the loop may advance ``milestone`` with nobody watching.

    This is an *additional* gate. The caller must still satisfy every existing
    one — ``governance.phase_authorized`` for the phase itself and
    ``governance.budget_status`` for the per-phase ceiling. Passing here only
    means the user authorized unattended progress on this exact phase and that
    this grant's own ceiling has room left.
    """

    from runtime.projectos.governance import phase_fingerprint, reported_cost

    phase_id = str(getattr(milestone, "id", "") or "")
    grant = active_grant(store, project_id)
    if grant is None:
        return AdmissionDecision(False, "no_standing_authorization", phase_id)
    if not grant.from_human_confirmation:
        # A grant that did not come from an explicit human confirmation cannot
        # stand in for one, however well-formed its payload is.
        return AdmissionDecision(False, "grant_not_human_confirmed", phase_id)

    try:
        fingerprint = phase_fingerprint(milestone)
    except Exception:  # noqa: BLE001 - an unfingerprintable phase is out of scope
        _logger.debug("phase fingerprint failed for %s", phase_id, exc_info=True)
        return AdmissionDecision(False, "phase_fingerprint_unavailable", phase_id)
    if fingerprint not in grant.phase_fingerprints:
        # Either the phase was never covered, or it was rewritten since the
        # grant. Both must stop unattended execution and ask the user again.
        return AdmissionDecision(False, "phase_outside_standing_scope", phase_id)

    try:
        spent = float(reported_cost(store, project_id))
    except Exception:  # noqa: BLE001 - unknown spend must never spend more
        _logger.debug("standing budget unreadable for %s", project_id, exc_info=True)
        return AdmissionDecision(False, "reported_cost_unavailable", phase_id)
    remaining = grant.limit_usd - spent
    if remaining <= 0:
        return AdmissionDecision(False, "standing_budget_exhausted", phase_id, 0.0)
    return AdmissionDecision(True, "standing_authorization_active", phase_id, remaining)


def grant_standing_authorization(
    store: Any,
    project_id: str,
    *,
    milestones: list[Any],
    limit_usd: float,
    granted_by: str,
    source: str = UI_CONFIRMATION_SOURCE,
) -> dict:
    """Record a standing authorization over ``milestones``' current shape.

    Fingerprints are computed here rather than accepted from the caller: a
    caller-supplied fingerprint could cover a plan the user never saw. Raises
    ``ValueError`` on an empty scope or a non-positive ceiling — an
    authorization that admits nothing, or spends without bound, is a bug rather
    than a degenerate but valid grant.
    """

    from runtime.projectos.governance import phase_fingerprint

    if source != UI_CONFIRMATION_SOURCE:
        raise ValueError("a standing authorization requires an explicit human confirmation")
    try:
        ceiling = float(limit_usd)
    except (TypeError, ValueError) as exc:
        raise ValueError("limit_usd must be a number") from exc
    if not ceiling > 0:
        raise ValueError("limit_usd must be positive")
    fingerprints = [phase_fingerprint(milestone) for milestone in milestones]
    if not fingerprints:
        raise ValueError("a standing authorization must name at least one phase")

    return store.append_event(
        project_id,
        kind=GRANTED_KIND,
        payload={
            "phase_fingerprints": fingerprints,
            "phase_ids": [str(getattr(m, "id", "") or "") for m in milestones],
            "limit_usd": ceiling,
            "granted_by": str(granted_by or ""),
            "source": source,
            # Unattended progress only; approvals stay with the user.
            "approves_initiation": False,
            "approves_new_phases": False,
            "approves_owner_acceptance": False,
        },
    )


def revoke_standing_authorization(
    store: Any,
    project_id: str,
    *,
    revoked_by: str,
    reason: str = "",
) -> dict:
    """Stop admitting unattended work. In-flight tasks settle as they do today."""

    return store.append_event(
        project_id,
        kind=REVOKED_KIND,
        payload={
            "revoked_by": str(revoked_by or ""),
            "reason": str(reason or ""),
        },
    )
