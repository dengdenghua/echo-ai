"""Post-commit task notifications and optional compatibility consumers."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

from runtime.sensing.gateway._team_tasks_helpers import (
    _LOG,
    TaskProjection,
    TeamEventBroadcaster,
    _now,
)
from runtime.sensing.gateway._team_tasks_models import TeamTaskWire


class TeamTaskEvents:
    def __init__(
        self,
        broadcaster: TeamEventBroadcaster | None,
        projection: TaskProjection | None,
        delete_projection: Callable[[str], None] | None,
    ) -> None:
        self.broadcaster = broadcaster
        self.projection = projection
        self.delete_projection = delete_projection

    @staticmethod
    def payload(task: TeamTaskWire, event: str, **extra: Any) -> dict[str, Any]:
        return {
            "type": "task:progress",
            "team_id": task.room_id,
            "room_id": task.room_id,
            "task_id": task.id,
            "task": task.model_dump(),
            "event": event,
            "server_time": _now(),
            **extra,
        }

    def project(self, task: TeamTaskWire) -> None:
        if self.projection is not None:
            try:
                self.projection(task.room_id, task.model_dump())
            except Exception:  # noqa: BLE001 - compatibility consumers cannot undo a commit
                _LOG.warning("team task consumer failed for %s", task.id, exc_info=True)

    def project_delete(self, task_id: str) -> None:
        if self.delete_projection is not None:
            try:
                self.delete_projection(task_id)
            except Exception:  # noqa: BLE001 - compatibility consumers cannot undo a commit
                _LOG.warning("team task delete consumer failed for %s", task_id, exc_info=True)

    async def broadcast(self, task: TeamTaskWire, event: str, **extra: Any) -> None:
        if self.broadcaster is None:
            return
        try:
            pending = self.broadcaster(task.room_id, self.payload(task, event, **extra))
            if pending is not None:
                await pending
        except Exception:  # noqa: BLE001 - execution must survive notification failures
            _LOG.warning("team task broadcast failed for %s", task.id, exc_info=True)

    def broadcast_from_worker(self, task: TeamTaskWire, event: str, **extra: Any) -> None:
        asyncio.run(self.broadcast(task, event, **extra))
