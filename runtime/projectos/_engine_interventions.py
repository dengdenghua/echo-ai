"""Operator interventions on a running project: task overrides and cancellation.

Split out of :mod:`runtime.projectos.engine` (``ProjectEngine`` mixes this in)
so the milestone loop stays readable. Both entry points are scoped to the
addressed project: an intervention resolves its task only through that
project's milestones, and a cancelled (``failed``) project accepts neither.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from runtime.projectos.model import Task
from runtime.projectos.store import ProjectClaimActiveError, ProjectStore


class ProjectInterventionMixin:
    """``intervene_task`` and ``cancel`` for :class:`ProjectEngine`."""

    store: ProjectStore

    if TYPE_CHECKING:  # provided by ProjectEngine

        def _audit(self, project_id: str, kind: str, payload: dict) -> None: ...

        def _with_downstream_tasks(self, tasks: list[Task], task_ids: set[str]) -> set[str]: ...

        def _reset_task_for_rerun(
            self, task: Task, *, reset_attempts: bool, clear_outputs: bool
        ) -> None: ...

    def intervene_task(
        self,
        project_id: str,
        task_id: str,
        *,
        action: str,
        assigned_agent: str | None = None,
        assigned_role: str | None = None,
        output: Any = None,
        reason: str = "",
        reset_attempts: bool = True,
        cascade: bool = True,
        actor: str = "",
    ) -> dict[str, Any]:
        """Apply an operator intervention to one task.

        ``reassign`` and ``reset`` put work back on the DAG frontier. ``complete``
        and ``skip`` mark a task as accepted by the operator so the milestone
        gate can move on. ``actor`` is the operator identity stamped into the
        task's review chain on complete/skip (empty falls back to "operator").
        """
        project = self.store.get_project(project_id)
        if project is None:
            return {"events": ["project_not_found"], "project_status": "failed"}
        if project.status == "failed":
            # A cancelled project is terminal: an intervention must neither
            # rewrite its tasks nor reopen a phase of it.
            result = {
                "events": [f"project_not_intervenable:{project.status}"],
                "project_status": project.status,
                "current_ms": project.current_ms,
            }
            self._audit(
                project_id,
                "task.intervention_rejected",
                {"task_id": task_id, "action": action, **result},
            )
            return result
        task = self.store.get_task(task_id)
        # Task ids are global keys: resolve the task only through this
        # project's own milestones. Otherwise ``/projects/A/tasks/<B's task>``
        # would rewrite B's work, audit it under A, and could even reopen B's
        # phase as A's ``current_ms``. From A's view such a task does not exist.
        owned = task is not None and task.milestone_id in {
            milestone.id for milestone in self.store.milestones_for(project.id)
        }
        if task is None or not owned:
            result = {
                "events": [f"task_not_found:{task_id}"],
                "project_status": project.status,
                "current_ms": project.current_ms,
            }
            self._audit(
                project_id,
                "task.intervention_rejected",
                {
                    "task_id": task_id,
                    "action": action,
                    "reason": "task_not_found" if task is None else "task_not_in_project",
                    **result,
                },
            )
            return result
        ms = self.store.get_milestone(task.milestone_id)
        if ms is None:
            result = {
                "events": [f"milestone_not_found:{task.milestone_id}"],
                "project_status": project.status,
                "current_ms": project.current_ms,
            }
            self._audit(
                project_id,
                "task.intervention_rejected",
                {"task_id": task_id, "action": action, **result},
            )
            return result

        action = str(action or "").strip().lower()
        events: list[str] = []
        tasks = self.store.tasks_for_milestone(ms.id)
        affected_ids = {task.id}
        if action == "reset" and cascade:
            affected_ids = self._with_downstream_tasks(tasks, affected_ids)
        if action in {"reassign", "reset", "complete", "skip"}:
            running_ids = tuple(
                current.id
                for current in tasks
                if current.id in affected_ids and current.status == "running"
            )
            if running_ids:
                raise ProjectClaimActiveError(project, task_ids=running_ids)
            self.store.assert_no_active_claims(
                project.id,
                task_ids=tuple(sorted(affected_ids)),
            )

        if action == "reassign":
            if assigned_agent is not None:
                task.assigned_agent = str(assigned_agent)
            if assigned_role is not None:
                task.assigned_role = str(assigned_role)
            self._reset_task_for_rerun(task, reset_attempts=reset_attempts, clear_outputs=True)
            events.append(f"task_reassigned:{task.id}")
        elif action == "reset":
            reset_ids = affected_ids
            for current_task in tasks:
                if current_task.id not in reset_ids:
                    continue
                self._reset_task_for_rerun(
                    current_task,
                    reset_attempts=reset_attempts,
                    clear_outputs=True,
                )
                events.append(f"task_reset:{current_task.id}")
        elif action == "complete":
            task.status = "done"
            task.output = output
            task.qa_verdict = {"approved": True, "reason": reason or "operator completed"}
            task.review_mode = "operator"
            task.reviewed_by = str(actor or "").strip() or "operator"
            self.store.save_task(task, allow_terminal_rewrite=True)
            events.append(f"task_completed_by_operator:{task.id}")
        elif action == "skip":
            task.status = "done"
            task.output = {
                "skipped": True,
                "reason": reason or "operator skipped",
                "previous_output": task.output,
            }
            task.qa_verdict = {"approved": True, "reason": reason or "operator skipped"}
            task.review_mode = "operator"
            task.reviewed_by = str(actor or "").strip() or "operator"
            self.store.save_task(task, allow_terminal_rewrite=True)
            events.append(f"task_skipped:{task.id}")
        else:
            result = {
                "events": [f"unknown_task_action:{action or '<empty>'}"],
                "project_status": project.status,
                "current_ms": project.current_ms,
            }
            self._audit(
                project_id,
                "task.intervention_rejected",
                {"task_id": task_id, "action": action, **result},
            )
            return result

        if ms.status in {"blocked", "done"} or project.status == "blocked":
            ms.status = "in_progress"
            self.store.save_milestone(project.id, ms, allow_terminal_rewrite=True)
            project.status = "running"
            project.current_ms = ms.id
            self.store.save_project(project, allow_terminal_rewrite=True)
            events.append(f"milestone_reopened:{ms.id}")
            events.append("project_recovered")

        current = self.store.get_project(project_id)
        result = {
            "events": events,
            "project_status": current.status if current else "failed",
            "current_ms": current.current_ms if current else None,
        }
        self._audit(
            project_id,
            "task.intervention",
            {
                "task_id": task_id,
                "action": action,
                "assigned_agent": assigned_agent,
                "assigned_role": assigned_role,
                "reason": reason,
                "reset_attempts": reset_attempts,
                "cascade": cascade,
                **result,
            },
        )
        return result

    def cancel(self, project_id: str, *, reason: str = "", actor: str = "") -> dict[str, Any]:
        """Abandon a project: terminal ``failed`` plus every execution claim voided.

        Every engine failure path blocks a project for recovery, so without
        this a project the operator gives up on stays ``blocked`` (active)
        forever and can never be deleted. Cancelling reuses the model's
        terminal ``failed`` status; the ``project.cancelled`` audit event says
        it was an operator decision. Live claims are released in the same
        transaction, so an in-flight worker can no longer publish and later
        ticks/runs/recovers refuse the project. ``done`` is not cancellable;
        cancelling an already-cancelled project is a no-op.
        """
        project = self.store.get_project(project_id)
        if project is None:
            return {"events": ["project_not_found"], "project_status": "failed"}
        outcome = self.store.cancel_project(project.id)
        current = outcome.project
        if not outcome.cancelled:
            already = outcome.previous_status == "failed"
            result = {
                "events": [
                    "project_already_cancelled"
                    if already
                    else f"project_not_cancellable:{outcome.previous_status}"
                ],
                "project_status": current.status,
                "current_ms": current.current_ms,
            }
            if not already:
                self._audit(
                    project.id,
                    "project.cancel_rejected",
                    {"reason": reason, "actor": actor, **result},
                )
            return result
        events = [
            *(f"task_claim_released:{task_id}" for task_id in outcome.released_task_ids),
            *(
                f"milestone_claim_released:{milestone_id}"
                for milestone_id in outcome.released_milestone_ids
            ),
            "project_cancelled",
        ]
        result = {
            "events": events,
            "project_status": current.status,
            "current_ms": current.current_ms,
        }
        self._audit(
            project.id,
            "project.cancelled",
            {
                "reason": reason,
                "actor": actor,
                "previous_status": outcome.previous_status,
                "released_task_claims": list(outcome.released_task_ids),
                "released_milestone_claims": list(outcome.released_milestone_ids),
                "failed_tasks": list(outcome.failed_task_ids),
                "failed_milestones": list(outcome.failed_milestone_ids),
                **result,
            },
        )
        return result
