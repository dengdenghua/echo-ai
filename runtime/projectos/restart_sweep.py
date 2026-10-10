"""Mark projects left mid-run by a previous process, without resuming them.

A project's durable state survives a restart, but nothing advances it: the
engine only runs from an explicit ``/project`` command, the REST endpoint, or
the CLI, and its worker is bound to that single request. A backend killed while
a project was running therefore leaves a ``running`` document that no longer
has anything driving it, and the UI keeps presenting it as in-flight.

This sweep records that discontinuity so the surface can show "interrupted —
continue when you're ready". It deliberately does **not** call
``ProjectEngine.run``: resuming would spend AI budget, write files and invoke
tools on a restart the user never approved. Phase authorization and owner
acceptance stay exactly where the previous process left them.

The one thing it does settle is the execution claims the dead process still
held. Claims carry no process identity, but the sweep runs while the app is
being wired — before this process can have claimed anything — so every claim
last renewed before the sweep started belongs to a previous process. Left in
place they would keep ``recover`` refusing (``ProjectClaimActiveError``) and
``run`` idling until the claim TTL expired. They are fenced exactly like an
expired claim: the task, its phase and the project become ``blocked`` (a
recoverable state) and an audit event records it. Nothing is re-run.
"""

from __future__ import annotations

import logging
import time
from typing import Any

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
) -> list[dict[str, Any]]:
    """Mark every ``running`` project as interrupted by a restart.

    Execution claims last renewed at or before ``started_at`` (default: now,
    i.e. service start) are released first, see the module docstring.

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
        # Decide on the pre-sweep status: releasing a claim blocks the
        # project, but it was still running when the previous process died.
        was_running = str(getattr(project, "status", "") or "") == "running"
        orphaned_tasks, orphaned_milestones = _release_previous_process_claims(
            store, project_id, cutoff
        )
        if not was_running:
            continue
        if _already_marked(store, project_id):
            continue
        thread_id = str(getattr(project, "execution_thread_id", "") or "")
        try:
            append_event(
                project_id,
                kind=RESTART_INTERRUPTED_KIND,
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
            )
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


def _already_marked(store: Any, project_id: str) -> bool:
    """Whether this project's latest run already carries a restart marker.

    A marker is superseded once the project is driven again, so the sweep
    compares against events recorded after the most recent run event rather
    than against the whole history.
    """

    events_for_project = getattr(store, "events_for_project", None)
    if not callable(events_for_project):
        return False
    try:
        # The store selects the newest rows and then reverses them, so this
        # list is oldest-first. Walk it backwards to see the latest first.
        events = list(events_for_project(project_id))
    except Exception:  # noqa: BLE001 - unreadable history must not block marking
        _logger.debug("project restart sweep could not read %s", project_id, exc_info=True)
        return False
    for event in reversed(events):
        kind = str((event or {}).get("kind") or "") if isinstance(event, dict) else ""
        if kind == RESTART_INTERRUPTED_KIND:
            return True
        # ``project.run`` is written once per explicit drive (engine.run), so a
        # newer run supersedes an older marker and the project can be marked
        # again if it is interrupted a second time.
        if kind == "project.run":
            return False
    return False
