"""Runner construction and the server-owned team execution boundary."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any
from uuid import uuid4

from runtime.sensing.gateway._team_tasks_helpers import RunnerFactory
from runtime.sensing.gateway._team_tasks_models import TeamTaskWire


def _make_task_execution(
    *,
    runner_factory: RunnerFactory | None,
    workspace_root: Path | None,
    logs_root: Path | None,
) -> tuple[Callable[..., Any], ...]:
    def _runner_instance(event_emitter: Callable[[dict[str, Any]], None]) -> Any:
        if runner_factory is None:
            from runtime.safety.organization.team_runner import TeamRunner

            return TeamRunner(timeout_seconds=900, event_emitter=event_emitter)
        try:
            return runner_factory(timeout_seconds=900, event_emitter=event_emitter)
        except TypeError:
            return runner_factory()

    def _host_execution_boundary(
        task: TeamTaskWire,
        *,
        actor: str | None,
        tenant_id: str,
        goal: str,
    ) -> Any:
        """Create one server-owned task shared by every role in this run."""

        from runtime.execution.artifact_contracts import HandoffRecorder
        from runtime.execution.host_boundary import create_host_execution_boundary

        normalized_tenant = tenant_id.strip() if actor else ""
        execution_thread_id = f"team-{task.id}"
        execution_task_id = f"team-run-{uuid4().hex}"
        metadata: dict[str, Any] = {
            "source": "team_tasks_http",
            "mode": "team",
            "team_id": task.room_id,
        }

        if workspace_root is not None:
            from runtime.platform.runtime_policy.workspaces import (
                WorkspaceManager,
                managed_workspace_metadata,
                managed_workspace_path,
            )

            manager = WorkspaceManager(Path(workspace_root))
            if actor and normalized_tenant:
                managed = managed_workspace_path(
                    workspace_root,
                    tenant_id=normalized_tenant,
                    actor_id=actor,
                    thread_id=execution_thread_id,
                )
                layout = manager.bind_managed(execution_thread_id, managed)
                metadata.update(
                    managed_workspace_metadata(
                        workspace_root,
                        tenant_id=normalized_tenant,
                        actor_id=actor,
                        thread_id=execution_thread_id,
                    )
                )
            else:
                layout = manager.layout(execution_thread_id)
                metadata["workspace_path"] = str(layout.root)
            metadata["_host_workspace_read_root"] = layout.root
            metadata["_artifact_output_root"] = str(layout.final)

        recorder = None
        if logs_root is not None:
            from runtime.memory.threads.event_log import EventLog, thread_log_path

            event_log = EventLog(thread_log_path(logs_root, execution_thread_id))

            def read_handoffs() -> tuple[dict[str, Any], ...]:
                return tuple(
                    dict(event.payload)
                    for event in event_log.iter_events()
                    if event.event == "execution_handoff" and event.thread_id == execution_thread_id
                )

            def write_handoff(receipt: dict[str, Any]) -> None:
                event_log.execution_handoff(
                    execution_thread_id,
                    execution_task_id,
                    receipt,
                )

            recorder = HandoffRecorder(
                write_handoff,
                read_handoffs,
            )

        return create_host_execution_boundary(
            task_id=execution_task_id,
            thread_id=execution_thread_id,
            goal=goal,
            timeout_s=900.0,
            actor_id=actor,
            tenant_id=normalized_tenant or None,
            metadata=metadata,
            handoff_recorder=recorder,
        )

    return _runner_instance, _host_execution_boundary
