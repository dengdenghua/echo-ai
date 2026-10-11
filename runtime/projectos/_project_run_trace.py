"""Compact audit trace for a Project OS run over a cowork group.

Split out of :mod:`runtime.projectos.group_execution`, which re-exports
``project_run_trace`` and records the trace on ``project.run_from_group``.
"""

from __future__ import annotations

from typing import Any


def project_run_trace(
    *,
    thread_id: str,
    roster: list[str],
    reused: bool,
    result: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    """Compact audit trace for Project OS runs over a cowork group."""
    raw_project = state.get("project")
    project = dict(raw_project) if isinstance(raw_project, dict) else {}
    raw_milestones = state.get("milestones")
    milestones = list(raw_milestones) if isinstance(raw_milestones, list) else []
    raw_tasks = state.get("tasks")
    tasks_by_ms = dict(raw_tasks) if isinstance(raw_tasks, dict) else {}
    raw_history = result.get("history")
    history = list(raw_history) if isinstance(raw_history, list) else []
    tick_events: list[dict[str, Any]] = []
    for index, tick in enumerate(history, start=1):
        if not isinstance(tick, dict):
            continue
        tick_events.append(
            {
                "tick": index,
                "project_status": tick.get("project_status"),
                "current_ms": tick.get("current_ms"),
                "events": [
                    str(event) for event in (tick.get("events") or []) if str(event or "").strip()
                ],
            }
        )

    milestone_summaries: list[dict[str, Any]] = []
    for milestone in milestones:
        if not isinstance(milestone, dict):
            continue
        ms_id = str(milestone.get("id") or "")
        tasks = tasks_by_ms.get(ms_id) if isinstance(tasks_by_ms, dict) else []
        tasks = tasks if isinstance(tasks, list) else []
        milestone_summaries.append(
            {
                "id": ms_id,
                "name": milestone.get("name"),
                "status": milestone.get("status"),
                "task_count": len(tasks),
                "done_task_count": sum(
                    1 for task in tasks if isinstance(task, dict) and task.get("status") == "done"
                ),
                "assignments": [
                    {
                        "task_id": task.get("id"),
                        "type": task.get("type"),
                        "status": task.get("status"),
                        "assigned_agent": task.get("assigned_agent"),
                        "available_actions": task.get("available_actions") or [],
                    }
                    for task in tasks
                    if isinstance(task, dict)
                ],
            }
        )

    return {
        "schema": "echo.projectos.run_trace.v1",
        "thread_id": thread_id,
        "project_id": project.get("id"),
        "project_name": project.get("name"),
        "project_status": result.get("final_status") or project.get("status"),
        "reused": reused,
        "roster": roster,
        "tick_count": result.get("ticks", len(tick_events)),
        "tick_events": tick_events,
        "milestones": milestone_summaries,
    }
