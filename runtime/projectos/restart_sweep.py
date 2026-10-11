"""Mark interrupted projects without reclaiming a live executor or resuming work.

Live HTTP job leases are preserved across workers. Task/decomposition claims
carry a local process creation identity and their configured lease duration.
A confirmed dead local process can be fenced immediately; legacy, foreign or
uninspectable claims remain held until their lease expires. A startup timestamp
alone does not prove that an executor has died.

Abandoned work becomes blocked with a sealed audit event and requires explicit
recovery. The sweep never runs the engine, approves phases or accepts delivery.
Idle restart markers are deduplicated transactionally and do not cross a claim
that another worker acquired while this sweep was inspecting the project.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from uuid import uuid4

from runtime.projectos._claim_process import claim_owner_alive
from runtime.projectos._store_event_write import insert_sealed_event
from runtime.projectos._store_project_deletion import assert_project_not_deleting

_logger = logging.getLogger(__name__)

# One durable marker per interrupted run. Re-running the sweep over an
# already-marked project appends nothing new.
RESTART_INTERRUPTED_KIND = "project.run_interrupted_by_restart"
# ``cause`` recorded on the claim-orphaned audit events this sweep produces.
RESTART_CLAIM_CAUSE = "process_restart"


def sweep_projects_interrupted_by_restart(
    store: Any,
    *,
    started_at: float | None = None,
    task_supervisor: Any = None,
) -> list[dict[str, Any]]:
    """Mark every ``running`` project as interrupted by a restart.

    Only expired or confirmed-dead claims last renewed before ``started_at``
    (default: now) are released. Unexpired unknown owners remain fenced.

    Returns the marked projects as ``{"project_id", "name", "thread_id",
    "orphaned_task_ids", "orphaned_milestone_ids"}`` for startup logging.
    Best-effort like the job sweep: a store that cannot be read or written
    must never block serve. A project without claims keeps its status, so no
    acceptance or authorization state is rewritten.
    """

    if store is None:
        return []
    list_projects = getattr(store, "list_projects", None)
    append_event = getattr(store, "append_event", None)
    if not callable(list_projects) or not callable(append_event):
        return []
    cutoff = time.time() if started_at is None else float(started_at)
    try:
        projects = list(list_projects())
    except Exception:  # noqa: BLE001 - startup sweep is best-effort
        _logger.debug("project restart sweep could not list projects", exc_info=True)
        return []

    marked: list[dict[str, Any]] = []
    for project in projects:
        project_id = str(getattr(project, "id", "") or "")
        if not project_id:
            continue
        if task_supervisor is not None:
            from runtime.platform.process.task_supervisor import TERMINAL_TASK_STATUSES
            from runtime.projectos.http_dispatcher import ProjectHTTPDispatcher

            task = task_supervisor.store.get(ProjectHTTPDispatcher.task_id(project))
            if (
                task is not None
                and task.kind == "project_http"
                and task.owner_id == (project.owner_id or None)
                and task.metadata.get("tenant_id") == project.tenant_id
                and task.status not in TERMINAL_TASK_STATUSES
                and task.lease is not None
                and not task.lease.expired
                and claim_owner_alive(task.metadata.get("process_owner", "")) is not False
            ):
                # Another worker can still own this project. A cold start is
                # not evidence that its renewed claims have been abandoned.
                continue
        # Decide on the pre-sweep status: releasing a claim blocks the
        # project, but it was still running when the previous process died.
        was_running = str(getattr(project, "status", "") or "") == "running"
        orphaned_tasks, orphaned_milestones = _release_previous_process_claims(
            store, project_id, cutoff
        )
        if not was_running:
            continue
        thread_id = str(getattr(project, "execution_thread_id", "") or "")
        try:
            if not _record_restart_marker(
                store,
                project_id,
                payload={
                    # State is intact; only the driver is gone. Say so
                    # explicitly so this is never read as a failed project.
                    "detail": "backend restarted while this project was running",
                    "resumed": False,
                    "execution_thread_id": thread_id,
                    "orphaned_task_ids": orphaned_tasks,
                    "orphaned_milestone_ids": orphaned_milestones,
                    "recovery_required": bool(orphaned_tasks or orphaned_milestones),
                },
            ):
                continue
        except Exception:  # noqa: BLE001 - a single project must not stop the sweep
            _logger.debug("project restart sweep could not mark %s", project_id, exc_info=True)
            continue
        marked.append(
            {
                "project_id": project_id,
                "name": str(getattr(project, "name", "") or ""),
                "thread_id": thread_id,
                "orphaned_task_ids": orphaned_tasks,
                "orphaned_milestone_ids": orphaned_milestones,
            }
        )
    return marked


def _release_previous_process_claims(
    store: Any,
    project_id: str,
    cutoff: float,
) -> tuple[list[str], list[str]]:
    """Fence one project's claims left by a previous process; best-effort."""

    orphan_milestones = getattr(store, "orphan_stale_milestone_claims", None)
    orphan_tasks = getattr(store, "orphan_stale_task_claims", None)
    milestone_ids: list[str] = []
    task_ids: list[str] = []
    try:
        if callable(orphan_milestones):
            milestone_ids = [
                str(milestone.id)
                for milestone in orphan_milestones(
                    project_id, stale_before=cutoff, cause=RESTART_CLAIM_CAUSE
                )
            ]
        if callable(orphan_tasks):
            task_ids = [
                str(task.id)
                for task in orphan_tasks(project_id, stale_before=cutoff, cause=RESTART_CLAIM_CAUSE)
            ]
    except Exception:  # noqa: BLE001 - one project must not stop the sweep
        _logger.debug(
            "project restart sweep could not release claims of %s", project_id, exc_info=True
        )
    if task_ids or milestone_ids:
        _logger.warning(
            "projectos: released execution claims left by a previous process on %s "
            "(tasks: %s; decompositions: %s); the project is blocked awaiting recovery",
            project_id,
            ", ".join(task_ids) or "-",
            ", ".join(milestone_ids) or "-",
        )
    return task_ids, milestone_ids


def _record_restart_marker(store: Any, project_id: str, *, payload: dict[str, Any]) -> bool:
    """Check claims, deduplicate and seal the marker inside one transaction."""
    with store._lock, store._conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        project = store._project_doc_for_scope(conn, project_id, None)
        if project is None or project.status not in {"running", "blocked"}:
            return False
        assert_project_not_deleting(conn, project_id)
        active = conn.execute(
            "SELECT 1 FROM task_claims c INNER JOIN tasks t ON t.id=c.task_id "
            "INNER JOIN milestones m ON m.id=t.milestone_id WHERE m.project_id=? "
            "UNION ALL SELECT 1 FROM milestone_claims c "
            "INNER JOIN milestones m ON m.id=c.milestone_id WHERE m.project_id=? LIMIT 1",
            (project_id, project_id),
        ).fetchone()
        latest = conn.execute(
            "SELECT kind FROM project_events WHERE project_id=? AND kind IN (?, ?) "
            "ORDER BY seq DESC LIMIT 1",
            (project_id, RESTART_INTERRUPTED_KIND, "project.run"),
        ).fetchone()
        if active or (latest and latest[0] == RESTART_INTERRUPTED_KIND):
            return False
        insert_sealed_event(
            conn,
            {
                "id": f"EV-{uuid4().hex[:12]}",
                "project_id": project_id,
                "kind": RESTART_INTERRUPTED_KIND,
                "payload": {**payload, "execution_thread_id": project.execution_thread_id or ""},
                "created_at": time.time(),
            },
        )
        return True
