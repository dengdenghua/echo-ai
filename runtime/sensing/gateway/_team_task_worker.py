"""One claimed worker: renewal, atomic process events and fenced settlement."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from contextlib import suppress
from typing import Any

from runtime.memory.cowork._collaboration_team_records import TeamTaskConflict, TeamTaskSnapshot
from runtime.memory.cowork.team_task_authority import TeamTaskAuthority
from runtime.safety.approval.cancellation import CancellationSource, scoped_cancellation
from runtime.sensing.gateway._team_task_events import TeamTaskEvents
from runtime.sensing.gateway._team_task_mobile import mobile_records
from runtime.sensing.gateway._team_tasks_helpers import (
    _LOG,
    _jsonable,
    _mobile_artifacts,
    _now,
    _runner_artifacts,
    _runner_metadata,
    _runner_result_error,
    _runner_result_success,
)
from runtime.sensing.gateway._team_tasks_models import TeamTaskWire


def task_wire(snapshot: TeamTaskSnapshot) -> TeamTaskWire:
    return TeamTaskWire.model_validate({**snapshot.payload, "revision": snapshot.revision})


class TeamTaskWorker:
    def __init__(
        self,
        *,
        authority: TeamTaskAuthority,
        events: TeamTaskEvents,
        task: TeamTaskWire,
        run_token: str,
        prepared: dict[str, Any],
        boundary: Any,
        runner: Callable[..., Any],
        source: CancellationSource,
        loop: asyncio.AbstractEventLoop,
        lease: float,
        heartbeat_interval: float,
        on_exit: Callable[[str], None],
    ) -> None:
        self.authority, self.events, self.task = authority, events, task
        self.run_token, self.prepared, self.boundary = run_token, prepared, boundary
        self.runner, self.source, self.loop = runner, source, loop
        self.lease, self.heartbeat_interval = lease, heartbeat_interval
        self.on_exit = on_exit
        self.stopped = threading.Event()
        self.completed_roles: set[str] = set()

    def _renew(self) -> bool:
        try:
            claim = self.authority.heartbeat(self.task.id, self.run_token, lease=self.lease)
        except Exception:  # noqa: BLE001 - unavailable authority stops execution
            _LOG.exception("team task renewal failed for %s", self.task.id)
            claim = None
        if claim is None or claim.cancel_requested:
            self.source.cancel(reason="team task execution claim cancelled or lost")
            return False
        return True

    def _renew_loop(self) -> None:
        while not self.stopped.wait(self.heartbeat_interval):
            if not self._renew():
                return

    def _append_process_event(self, event: dict[str, Any]) -> TeamTaskWire:
        def merge(payload: dict[str, Any]) -> dict[str, Any]:
            metadata = dict(payload.get("metadata", {}))
            events = [item for item in metadata.get("process_events", []) if isinstance(item, dict)]
            metadata["process_events"] = [*events, _jsonable(event)][-300:]
            return {**payload, "metadata": metadata, "updated_at": _now()}

        committed = task_wire(self.authority.mutate(self.task.id, merge, run_token=self.run_token))
        self.events.project(committed)
        return committed

    def _emit_runner_event(self, event: dict[str, Any]) -> None:
        event_type, role = str(event.get("type") or "runner_event"), str(event.get("role") or "")
        try:
            committed = self._append_process_event(
                {
                    "ts": _now(),
                    "type": event_type,
                    "role": role,
                    "agent_id": event.get("agent_id"),
                    "status": str(event.get("status") or ""),
                    "event": _jsonable(event),
                }
            )
        except TeamTaskConflict:
            self.source.cancel(reason="team task process event lost its execution claim")
            return
        if event_type == "team_role_end" and role:
            self.completed_roles.add(role)
        total_roles = max(1, len(getattr(self.prepared["topology"], "agents", {}) or {}))
        self.events.broadcast_from_worker(
            committed,
            "role_completed" if event_type == "team_role_end" else event_type,
            runner_event=event,
            role=role or None,
            role_status=event.get("status") or None,
            completed_roles=len(self.completed_roles),
            total_roles=total_roles,
            progress=min(1.0, len(self.completed_roles) / total_roles),
        )

    def _settle(
        self,
        status: str,
        metadata_delta: dict[str, Any],
        artifacts: list[dict[str, Any]] | None = None,
    ) -> None:
        def merge(payload: dict[str, Any]) -> dict[str, Any]:
            stamp = _now()
            metadata = {**payload.get("metadata", {}), **metadata_delta}
            events = [
                item
                for item in payload.get("metadata", {}).get("process_events", [])
                if isinstance(item, dict)
            ]
            metadata["process_events"] = [
                *events,
                {
                    "ts": stamp,
                    "type": f"run_{status}",
                    "status": status,
                    "error": str(metadata.get("error") or ""),
                },
            ][-300:]
            result = {
                **payload,
                "status": status,
                "completed_at": stamp,
                "updated_at": stamp,
                "metadata": metadata,
            }
            if artifacts is not None:
                result["produced_artifacts"] = artifacts
            return result

        committed = task_wire(self.authority.mutate(self.task.id, merge, run_token=self.run_token))
        self.events.project(committed)
        extra = (
            {"error": str(committed.metadata["error"])} if committed.metadata.get("error") else {}
        )
        self.events.broadcast_from_worker(committed, f"run_{status}", **extra)

    def _execute(self) -> None:
        from runtime.execution.request import execution_request_scope
        from runtime.platform.process.session import session_scope

        with (
            execution_request_scope(self.boundary.request),
            session_scope(self.boundary.session),
            scoped_cancellation(self.source.token),
        ):
            records = mobile_records(self.task, self.prepared, self.source, self.loop)
            if records is not None:
                succeeded = sum(1 for item in records if item.get("ok"))
                status = (
                    "cancelled" if self.source.is_cancelled else ("done" if succeeded else "failed")
                )
                metadata: dict[str, Any] = {
                    "runner": {"engine": "mobile", "devices": len(records), "succeeded": succeeded}
                }
                if status == "failed":
                    metadata["error"] = "no connected device completed the task"
                self._settle(
                    status, metadata, _mobile_artifacts(records) if status == "done" else None
                )
                return
            result = self.runner(self._emit_runner_event).run(
                self.prepared["topology"],
                self.prepared["task_input"],
                context=self.prepared["context"],
            )
        status = (
            "cancelled"
            if self.source.is_cancelled
            else ("done" if _runner_result_success(result) else "failed")
        )
        metadata = {"runner": _runner_metadata(result, self.prepared)}
        if status == "failed":
            metadata["error"] = _runner_result_error(result) or "TeamRunner reported failure"
        self._settle(
            status, metadata, _runner_artifacts(result, self.prepared) if status == "done" else None
        )

    def run(self) -> None:
        renewal = threading.Thread(
            target=self._renew_loop, name=f"team-task-lease-{self.task.id}", daemon=True
        )
        try:
            if not self._renew():
                return
            renewal.start()
            self._execute()
        except TeamTaskConflict:
            self.source.cancel(reason="team task execution no longer owns the task")
        except Exception as exc:  # noqa: BLE001 - persist runner failure under the same claim
            _LOG.exception("team task runner failed for %s", self.task.id)
            with suppress(TeamTaskConflict):
                self._settle(
                    "failed",
                    {
                        "error": f"{type(exc).__name__}: {exc}",
                        "runner": {
                            "topology": getattr(self.prepared["topology"], "name", ""),
                            "meta_skill": self.prepared.get("meta_skill"),
                        },
                    },
                )
        finally:
            self.stopped.set()
            if renewal.ident is not None:
                renewal.join(timeout=2)
            try:
                self.authority.release(self.task.id, self.run_token)
            except Exception:  # noqa: BLE001 - lease expiry remains the recovery boundary
                _LOG.exception("team task release failed for %s", self.task.id)
            self.on_exit(self.run_token)
