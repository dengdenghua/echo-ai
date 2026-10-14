"""Explicit project recovery, kept separate from the execution loop."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from runtime.projectos.engine import ProjectEngine


def recover_project(
    engine: ProjectEngine,
    project_id: str,
    *,
    task_ids: list[str] | None = None,
    reset_attempts: bool = True,
    clear_outputs: bool = True,
) -> dict[str, Any]:
    """Reopen a blocked project so the loop can continue.

    By default, only failed/rejected/blocked tasks in the current blocked
    milestone are retried. When operators pass explicit task ids, those
    tasks and their downstream dependants in the same milestone are reset
    together so stale outputs do not survive a partial rework.
    """
    project = engine.store.get_project(project_id)
    if project is None:
        return {"events": ["project_not_found"], "project_status": "failed"}
    project = engine.store.assert_no_active_claims(project.id)
    if project.status != "blocked":
        raise ValueError(
            "项目当前未阻塞，无需恢复；如需继续推进，请使用 /project run"
            if project.status == "running"
            else "项目已取消，不能再恢复"
            if project.status == "failed"
            else "项目当前未阻塞，无需恢复；请先查看项目报告"
        )

    events: list[str] = []
    selected = {str(task_id) for task_id in (task_ids or []) if str(task_id).strip()}
    milestones = engine.store.milestones_for(project.id)
    tasks_by_ms = {ms.id: engine.store.tasks_for_milestone(ms.id) for ms in milestones}
    # Explicit ids are resolved only inside this project's own milestones;
    # an id from another project must fail loudly, not be silently ignored
    # while the blocked phase is reopened with its failed work untouched.
    foreign = sorted(selected - {task.id for tasks in tasks_by_ms.values() for task in tasks})
    if foreign:
        raise ValueError(f"recovery tasks do not belong to this project: {', '.join(foreign)}")
    target_ms_ids = {project.current_ms} if project.current_ms else set()
    target_ms_ids.update(ms.id for ms in milestones if ms.status == "blocked")

    changed = False
    first_reopened: str | None = None
    for ms in milestones:
        tasks = tasks_by_ms[ms.id]
        explicit_here = {task.id for task in tasks if task.id in selected}
        if any(
            task.id in explicit_here and task.status not in {"failed", "rejected", "blocked"}
            for task in tasks
        ):
            raise ValueError("recovery tasks must be failed, rejected, or blocked")
        should_consider = (
            bool(explicit_here)
            or ms.id in target_ms_ids
            or any(task.status in {"failed", "rejected", "blocked"} for task in tasks)
        )
        if not should_consider:
            continue

        reset_ids = explicit_here
        if selected and explicit_here:
            reset_ids = engine._with_downstream_tasks(tasks, reset_ids)
        elif not selected:
            reset_ids = {
                task.id for task in tasks if task.status in {"failed", "rejected", "blocked"}
            }

        for task in tasks:
            if task.id not in reset_ids:
                continue
            engine._reset_task_for_rerun(
                task,
                reset_attempts=reset_attempts,
                clear_outputs=clear_outputs and not (task.qa_verdict or {}).get("review_error"),
            )
            events.append(f"task_recovered:{task.id}")
            changed = True

        if ms.status == "blocked" or reset_ids:
            ms.status = "in_progress"
            engine.store.save_milestone(project.id, ms, allow_terminal_rewrite=True)
            events.append(f"milestone_reopened:{ms.id}")
            first_reopened = first_reopened or ms.id
            changed = True

    if changed:
        project.status = "running"
        if first_reopened:
            project.current_ms = first_reopened
        engine.store.save_project(project, allow_terminal_rewrite=True)
        events.append("project_recovered")
    else:
        events.append("nothing_to_recover")

    current = engine.store.get_project(project_id)
    result = {
        "events": events,
        "project_status": current.status if current else "failed",
        "current_ms": current.current_ms if current else None,
    }
    engine._audit(
        project_id,
        "project.recover",
        {
            "task_ids": list(selected),
            "reset_attempts": reset_attempts,
            "clear_outputs": clear_outputs,
            **result,
        },
    )
    return result
