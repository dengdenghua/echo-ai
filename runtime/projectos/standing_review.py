"""Owner-bound, short-lived plan reviews for durable unattended grants.

The review and confirmation are sealed project events. Confirmation checks the
current owner, tenant and stored plan in one write transaction; it does not rely
on a caller's source label as evidence of a decision. The ceiling is cumulative
project spend, including spend reported before this grant.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from typing import Any
from uuid import uuid4

from runtime.projectos._store_event_write import insert_sealed_event
from runtime.projectos._store_helpers import _milestone_from_doc
from runtime.projectos._store_project_deletion import assert_project_not_deleting
from runtime.projectos.governance import phase_fingerprint
from runtime.projectos.standing_authorization import (
    GRANTED_KIND,
    REVOKED_KIND,
    UI_CONFIRMATION_SOURCE,
)
from runtime.projectos.standing_http_models import StandingGrantResponse, StandingReviewResponse

REVIEW_KIND = "project.standing_authorization_reviewed"
REVIEW_TTL_SECONDS = 300
MAX_PHASES = 100


def _owner(store: Any, conn: Any, project_id: str, actor_id: str, tenant_id: str) -> Any:
    assert_project_not_deleting(conn, project_id)
    project = store._project_doc_for_scope(conn, project_id, None)
    if (
        project is None
        or not actor_id
        or not tenant_id
        or project.owner_id != actor_id
        or project.tenant_id != tenant_id
    ):
        raise PermissionError("only the current project owner can manage standing authorization")
    return project


def _phases(conn: Any, project: Any, phase_ids: list[str]) -> list[dict[str, Any]]:
    if not phase_ids or len(phase_ids) > MAX_PHASES or len(set(phase_ids)) != len(phase_ids):
        raise ValueError("select between one and 100 distinct phases")
    phases = []
    for phase_id in phase_ids:
        if phase_id not in project.milestone_ids:
            raise ValueError("phase does not belong to this project")
        row = conn.execute(
            "SELECT doc FROM milestones WHERE id=? AND project_id=?", (phase_id, project.id)
        ).fetchone()
        milestone = _milestone_from_doc(row[0]) if row else None
        if milestone is None or milestone.status in {"done", "failed", "blocked"}:
            raise ValueError("phase is unavailable for unattended work")
        cap = milestone.spec.get("ai_budget_usd")
        if (
            isinstance(cap, bool)
            or not isinstance(cap, (int, float))
            or not math.isfinite(cap)
            or cap <= 0
        ):
            raise ValueError("each selected phase needs a finite positive AI budget")
        phases.append(
            {
                "id": phase_id,
                "name": milestone.name,
                "fingerprint": phase_fingerprint(milestone),
                "ai_budget_usd": float(cap),
            }
        )
    return phases


def _append(
    conn: Any, project_id: str, kind: str, payload: dict[str, Any], *, event_id: str = ""
) -> dict[str, Any]:
    return insert_sealed_event(
        conn,
        {
            "id": event_id or f"EV-{uuid4().hex}",
            "project_id": project_id,
            "kind": kind,
            "payload": payload,
            "created_at": time.time(),
        },
    )


def review_standing_authorization(
    store: Any,
    project_id: str,
    *,
    actor_id: str,
    tenant_id: str,
    phase_ids: list[str],
    limit_usd: float,
) -> dict[str, Any]:
    if isinstance(limit_usd, bool) or not math.isfinite(limit_usd) or limit_usd <= 0:
        raise ValueError("limit_usd must be finite and positive")
    with store._lock, store._conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        project = _owner(store, conn, project_id, actor_id, tenant_id)
        if project.status not in {"planning", "running"}:
            raise ValueError("project is not available for unattended work")
        payload = {
            "project_id": project_id,
            "owner_id": actor_id,
            "tenant_id": tenant_id,
            "phases": _phases(conn, project, phase_ids),
            "limit_usd": float(limit_usd),
            "expires_at": time.time() + REVIEW_TTL_SECONDS,
            "budget_basis": "cumulative_project_spend",
        }
        event = _append(conn, project_id, REVIEW_KIND, payload)
        return {"review_id": event["id"], **payload}


def confirm_standing_authorization(
    store: Any,
    project_id: str,
    *,
    actor_id: str,
    tenant_id: str,
    review_id: str,
) -> dict[str, Any]:
    with store._lock, store._conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        project = _owner(store, conn, project_id, actor_id, tenant_id)
        row = conn.execute(
            "SELECT payload FROM project_events WHERE id=? AND project_id=? AND kind=?",
            (review_id, project_id, REVIEW_KIND),
        ).fetchone()
        if row is None:
            raise ValueError("review is unavailable")
        payload = StandingReviewResponse.model_validate(
            {"review_id": review_id, **json.loads(row[0])}
        ).model_dump()
        if (
            payload.get("owner_id") != actor_id
            or payload.get("tenant_id") != tenant_id
            or payload.get("project_id") != project_id
        ):
            raise PermissionError("review belongs to another owner or tenant")
        # Replaying a consumed review cannot re-enable a revoked grant. Check
        # consumption before expiry so an HTTP retry returns the same receipt.
        grant_id = "SG-" + hashlib.sha256(f"{project_id}:{review_id}".encode()).hexdigest()
        existing = conn.execute(
            "SELECT payload FROM project_events WHERE id=? AND project_id=? AND kind=?",
            (grant_id, project_id, GRANTED_KIND),
        ).fetchone()
        if existing is not None:
            if json.loads(existing[0]).get("review_id") != review_id:
                raise ValueError("grant receipt is corrupt")
            return {"grant_id": grant_id, "replayed": True}
        expires = payload.get("expires_at")
        if (
            not isinstance(expires, (int, float))
            or not math.isfinite(expires)
            or expires <= time.time()
        ):
            raise ValueError("review has expired")
        if project.status not in {"planning", "running"}:
            raise ValueError("project is not available for unattended work")
        current = _phases(conn, project, [phase["id"] for phase in payload["phases"]])
        if current != payload["phases"]:
            raise ValueError("plan changed; review the current phases again")
        event = _append(
            conn,
            project_id,
            GRANTED_KIND,
            {
                "project_id": project_id,
                "owner_id": actor_id,
                "tenant_id": tenant_id,
                "granted_by": actor_id,
                "source": UI_CONFIRMATION_SOURCE,
                "review_id": review_id,
                "phase_ids": [phase["id"] for phase in current],
                "phase_fingerprints": [phase["fingerprint"] for phase in current],
                "limit_usd": payload["limit_usd"],
                "budget_basis": payload["budget_basis"],
                "approves_initiation": False,
                "approves_new_phases": False,
                "approves_owner_acceptance": False,
            },
            event_id=grant_id,
        )
        return {"grant_id": event["id"], "replayed": False}


def standing_authorization_state(
    store: Any,
    project_id: str,
    *,
    actor_id: str,
    tenant_id: str,
) -> dict[str, Any] | None:
    with store._lock, store._conn() as conn:
        _owner(store, conn, project_id, actor_id, tenant_id)
        row = conn.execute(
            "SELECT id, kind, payload FROM project_events WHERE project_id=? AND kind IN (?, ?) "
            "ORDER BY seq DESC LIMIT 1",
            (project_id, GRANTED_KIND, REVOKED_KIND),
        ).fetchone()
        if row is None or row[1] == REVOKED_KIND:
            return None
        try:
            payload = json.loads(row[2])
            grant = StandingGrantResponse.model_validate({**payload, "grant_id": row[0]})
            if (
                grant.grant_id
                != "SG-" + hashlib.sha256(f"{project_id}:{grant.review_id}".encode()).hexdigest()
                or grant.project_id != project_id
                or grant.owner_id != actor_id
                or grant.tenant_id != tenant_id
                or grant.granted_by != actor_id
                or payload.get("source") != UI_CONFIRMATION_SOURCE
                or any(
                    payload.get(field) is not False
                    for field in (
                        "approves_initiation",
                        "approves_new_phases",
                        "approves_owner_acceptance",
                    )
                )
            ):
                return None
            review = conn.execute(
                "SELECT payload FROM project_events WHERE id=? AND project_id=? AND kind=?",
                (grant.review_id, project_id, REVIEW_KIND),
            ).fetchone()
            if review is None:
                return None
            reviewed = StandingReviewResponse.model_validate(
                {
                    "review_id": grant.review_id,
                    **json.loads(review[0]),
                }
            )
            if (
                reviewed.project_id != project_id
                or reviewed.owner_id != actor_id
                or reviewed.tenant_id != tenant_id
                or reviewed.limit_usd != grant.limit_usd
                or [phase.id for phase in reviewed.phases] != grant.phase_ids
                or [phase.fingerprint for phase in reviewed.phases] != grant.phase_fingerprints
            ):
                return None
            return {**payload, "grant_id": row[0]}
        except (ValueError, TypeError, KeyError):
            return None


def revoke_reviewed_authorization(
    store: Any,
    project_id: str,
    *,
    actor_id: str,
    tenant_id: str,
) -> dict[str, Any]:
    with store._lock, store._conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _owner(store, conn, project_id, actor_id, tenant_id)
        event = _append(
            conn,
            project_id,
            REVOKED_KIND,
            {
                "revoked_by": actor_id,
                "tenant_id": tenant_id,
            },
        )
        return {"revocation_id": event["id"]}
