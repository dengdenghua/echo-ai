"""Durable phase authorization and provider-reported project spending.

Governance has one policy for every surface. A governed project (planned by
the project page/REST or by ``/project`` chat initiation, see
``model.GOVERNED_PROJECT_ORIGINS``) carries ``phase_agents``,
``ai_budget_usd`` and ``requires_owner_acceptance`` on each phase and is
fail-closed: a phase without its member list is never authorized. A project
the owner has not approved yet (``initiation_state == "pending"``) does not
execute at all. Legacy projects (no origin, created before governance) keep
running in chat as before; outside chat the owner approves them once, which
backfills the missing fields — see ``owner_decisions.approve_initiation``.
"""

import hashlib
import json
import math

from runtime.projectos._store_project_deletion import assert_project_not_deleting
from runtime.projectos.model import (
    GOVERNED_PROJECT_ORIGINS,
    PROJECT_ORIGIN_APP,
    PROJECT_ORIGIN_CLI,
)

INITIATION_APPROVED_KIND = "project.initiation_approved"
# Initiation states that need an owner decision before any execution.
INITIATION_REQUIRED_STATES = frozenset({"pending", "legacy"})
_CLOSED_MILESTONE_STATUSES = frozenset({"done", "failed"})


def governed_milestone_spec(phase_agents, *, ai_budget_usd=None, **extra):
    """The governance fields every phase of a governed project carries.

    Shared by chat initiation (per-phase staffing from the approved proposal)
    and the project page/REST (the group roster). ``ai_budget_usd=None`` is the
    chat default: no cap unless the owner states one in USD.
    """
    return {
        "requires_owner_acceptance": True,
        **extra,
        "phase_agents": sorted({str(agent) for agent in phase_agents if str(agent or "").strip()}),
        "ai_budget_usd": ai_budget_usd,
    }


def phase_agents_of(ms):
    agents = ms.spec.get("phase_agents")
    if not isinstance(agents, list):
        return []
    return [agent for agent in agents if isinstance(agent, str) and agent.strip()]


def milestone_governed(ms):
    """All three governance fields are present and the phase has members."""
    return (
        bool(phase_agents_of(ms))
        and "ai_budget_usd" in ms.spec
        and ms.spec.get("requires_owner_acceptance") is True
    )


def initiation_approval(store, project_id):
    """The newest owner initiation approval, read without an event window."""
    with store._lock, store._conn() as conn:
        if store._project_doc_for_scope(conn, project_id, None) is None:
            return None
        row = conn.execute(
            "SELECT payload, created_at FROM project_events WHERE project_id=? AND kind=? "
            "ORDER BY created_at DESC, seq DESC LIMIT 1",
            (project_id, INITIATION_APPROVED_KIND),
        ).fetchone()
    if row is None:
        return None
    try:
        payload = json.loads(row[0])
    except (TypeError, ValueError):
        payload = {}
    return {**(payload if isinstance(payload, dict) else {}), "approved_at": float(row[1])}


def initiation_state(store, project, milestones=None):
    """``approved`` | ``pending`` | ``legacy`` | ``exempt``.

    * ``exempt``: the offline CLI's stub projects.
    * ``approved``: the owner approved initiation, or the project was planned
      by chat initiation, which only plans after the owner approved.
    * ``pending``: a project-page/REST project awaiting the owner.
    * ``legacy``: created before governance. Phases that already carry the
      governance fields came from chat initiation and count as approved;
      anything else needs one owner approval outside chat.
    """
    if project.origin == PROJECT_ORIGIN_CLI:
        return "exempt"
    if initiation_approval(store, project.id) is not None:
        return "approved"
    if project.origin == PROJECT_ORIGIN_APP:
        return "pending"
    if project.origin in GOVERNED_PROJECT_ORIGINS:
        return "approved"
    phases = milestones if milestones is not None else store.milestones_for(project.id)
    unfinished = [ms for ms in phases if ms.status not in _CLOSED_MILESTONE_STATUSES]
    if unfinished and all(milestone_governed(ms) for ms in unfinished):
        return "approved"
    return "legacy"


def project_requires_governance(store, project):
    if project.origin in GOVERNED_PROJECT_ORIGINS:
        return True
    approval = initiation_approval(store, project.id)
    return approval is not None and approval.get("governed", True) is not False


def ordered_milestones(project, milestones):
    rank = {mid: index for index, mid in enumerate(project.milestone_ids)}
    return sorted(milestones, key=lambda ms: (rank.get(ms.id, len(rank)), ms.id))


def plan_fingerprint(project, milestones):
    """What the owner sees when deciding on the plan as a whole."""
    return hashlib.sha256(
        json.dumps(
            {
                "project": project.id,
                "name": project.name,
                "goal": project.goal,
                "phases": [phase_fingerprint(ms) for ms in ordered_milestones(project, milestones)],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


def select_phase(project, milestones):
    """The phase the next run would execute — the one chat asks to authorize."""
    ms = next((m for m in milestones if m.id == project.current_ms), None)
    if ms is None or ms.status == "done":
        done = {m.id for m in milestones if m.status == "done"}
        ms = next(
            (
                m
                for m in ordered_milestones(project, milestones)
                if m.status != "done" and all(dep in done for dep in m.dependencies)
            ),
            None,
        )
    return ms


def phase_fingerprint(ms):
    agents = ms.spec.get("phase_agents", [])
    return hashlib.sha256(
        json.dumps(
            {
                "id": ms.id,
                "name": ms.name,
                "goal": ms.goal,
                "spec": {
                    **ms.spec,
                    "phase_agents": sorted(agents if isinstance(agents, list) else []),
                },
                "success_criteria": ms.success_criteria,
                "dependencies": sorted(ms.dependencies),
                "planned_start": ms.planned_start,
                "due_at": ms.due_at,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


def phase_authorized(store, project_id, ms):
    if "phase_agents" not in ms.spec:
        # Fail closed: a governed project's phase without its member list was
        # never reviewed. Only legacy and CLI projects run ungoverned phases.
        project = store.get_project(project_id)
        return project is not None and not project_requires_governance(store, project)
    if not phase_agents_of(ms):
        return False
    return any(
        e["kind"] == "project.phase_authorized"
        and e["payload"].get("fingerprint") == phase_fingerprint(ms)
        for e in store.events_for_project(project_id, limit=500)
    )


def record_usage(store, project_id, result, *, task_id="", milestone_id=""):
    usage = result.get("governance") or {}
    if not isinstance(usage, dict):
        usage = {}
    root = usage.get("root_id")
    root = root.strip() if isinstance(root, str) else ""
    if root == "__unreported__":
        root = ""
    value = usage.get("cost_usd")
    valid = bool(root) and type(value) in (int, float) and math.isfinite(value) and value >= 0
    # The provider returns a cumulative root snapshot. Keep the maximum, not
    # a sum of repeated snapshots, so retries and parallel callbacks are safe.
    with store._lock, store._conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        assert_project_not_deleting(conn, project_id)
        if store._project_doc_for_scope(conn, project_id, None) is None:
            raise PermissionError("project usage scope unavailable")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS project_reported_usage (project_id TEXT, root_id TEXT, cost REAL NOT NULL, PRIMARY KEY(project_id, root_id))"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS project_missing_usage (project_id TEXT, root_id TEXT, task_id TEXT, PRIMARY KEY(project_id, root_id, task_id))"
        )
        if valid:
            conn.execute(
                "INSERT INTO project_reported_usage VALUES (?,?,?) ON CONFLICT(project_id,root_id) DO UPDATE SET cost=MAX(cost,excluded.cost)",
                (project_id, root, float(value)),
            )
            # A fresh provider snapshot only resolves this execution. It must
            # never clear another member's receipt or uncorrelated legacy gaps.
            conn.execute(
                "DELETE FROM project_missing_usage WHERE project_id=? AND root_id=?",
                (project_id, root),
            )
        else:
            conn.execute(
                "INSERT OR IGNORE INTO project_missing_usage VALUES (?,?,?)",
                (project_id, root or "__unreported__", task_id),
            )
    store.append_event(
        project_id,
        kind="project.usage_reported" if valid else "project.usage_missing",
        payload={
            "task_id": task_id,
            "milestone_id": milestone_id,
            "root_id": root or None,
            "cost_usd": float(value) if valid else None,
        },
    )
    return valid


def reported_cost(store, project_id):
    with store._lock, store._conn() as conn:
        if store._project_doc_for_scope(conn, project_id, None) is None:
            raise PermissionError("project usage scope unavailable")
        if not conn.execute(
            "SELECT 1 FROM sqlite_master WHERE name='project_reported_usage'"
        ).fetchone():
            return 0.0
        return float(
            conn.execute(
                "SELECT COALESCE(SUM(cost),0) FROM project_reported_usage WHERE project_id=?",
                (project_id,),
            ).fetchone()[0]
        )


def budget_reached(store, project_id, ms):
    return budget_status(store, project_id, ms)["paused"]


def budget_status(store, project_id, ms):
    """Read-only explanation shared by execution and the project workbench."""
    cap = ms.spec.get("ai_budget_usd")
    if cap is None:
        return {"paused": False, "reason": None, "limit_usd": None}
    cost = reported_cost(store, project_id)
    with store._lock, store._conn() as conn:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE name='project_reported_usage'"
        ).fetchone()
        legacy_unknown = (
            exists
            and conn.execute(
                "SELECT 1 FROM project_reported_usage WHERE project_id=? AND root_id='__unreported__'",
                (project_id,),
            ).fetchone()
        )
        missing_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE name='project_missing_usage'"
        ).fetchone()
        missing = (
            conn.execute(
                "SELECT task_id FROM project_missing_usage WHERE project_id=?", (project_id,)
            ).fetchall()
            if missing_exists
            else []
        )
    unknown = legacy_unknown or missing
    reason = "usage_missing" if unknown else "limit_reached" if cost >= float(cap) else None
    missing_tasks = {row[0] for row in missing if row[0]}
    if legacy_unknown:
        missing_tasks.update(
            e["payload"]["task_id"]
            for e in store.events_for_project(project_id, limit=500)
            if e["kind"] == "project.usage_missing" and e["payload"].get("task_id")
        )
    missing_tasks = sorted(missing_tasks)
    return {
        "paused": reason is not None,
        "reason": reason,
        "missing_task_ids": missing_tasks,
        "reported_cost_usd": cost,
        "limit_usd": float(cap),
    }


def budget_pause_message(status):
    if status.get("reason") == "usage_missing":
        tasks = status.get("missing_task_ids") or []
        return (
            "费用回报缺失，无法确认剩余额度；请核对执行记录与费用回报。提高预算不能解除此暂停。"
            + (
                "待核对任务：" + "、".join(tasks)
                if tasks
                else "历史记录未关联具体任务，需核对本项目执行记录。"
            )
        )
    return "已上报费用达到预算上限；可申请调整预算，经批准后继续。"
