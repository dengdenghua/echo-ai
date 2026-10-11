"""Wire the project's read-only daily patrol into application startup/shutdown."""

from __future__ import annotations

from typing import Any

from runtime.adapters.scheduler.runner import BackgroundRunner
from runtime.projectos.patrol_service import record_daily_patrol
from runtime.projectos.store import ProjectStore

from ._app_background import stop_on_shutdown


def mount_project_patrol(app: Any, store: ProjectStore) -> None:
    if getattr(app.state, "project_patrol_runner", None) is not None:
        return
    runner = BackgroundRunner(name="project-daily-patrol")
    # Catch up on startup, then at 09:00 in the server's local timezone.
    # Deterministic sealed event IDs deduplicate restarts and multiple workers.
    runner.add_cron(
        "project-daily-patrol", "0 9 * * *", lambda: record_daily_patrol(store), run_on_start=True
    )
    app.state.project_patrol_runner = runner
    stop_on_shutdown(app, "project-daily-patrol", runner.stop)
    app.router.add_event_handler("startup", runner.start)
