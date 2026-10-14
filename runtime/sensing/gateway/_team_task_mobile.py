"""Cancellable mobile execution for a claimed team task."""

from __future__ import annotations

import asyncio
import concurrent.futures
import time
from typing import Any

from runtime.safety.approval.cancellation import CancellationSource, scoped_cancellation
from runtime.sensing.gateway._team_tasks_models import TeamTaskWire


def mobile_records(
    task: TeamTaskWire,
    prepared: dict[str, Any],
    source: CancellationSource,
    loop: asyncio.AbstractEventLoop | None,
) -> list[dict[str, Any]] | None:
    refs = [
        a.ref.strip()
        for a in task.assignees
        if a.kind.strip().lower() == "agent" and a.ref.strip().startswith("mobile_")
    ]
    if not refs:
        return None
    from runtime.tentacle.team_bridge import (
        device_id_from_ref,
        get_active_coordinator,
        run_device_task,
    )

    coordinator = get_active_coordinator()
    records: list[dict[str, Any]] = []
    for ref in refs:
        if source.is_cancelled:
            break
        tentacle_id = device_id_from_ref(ref)
        if coordinator is None or loop is None:
            records.append(
                {
                    "tentacle_id": tentacle_id,
                    "ok": False,
                    "output": "",
                    "error": "mobile bridge not running",
                }
            )
            continue
        future: concurrent.futures.Future[Any] | None = None
        try:
            with scoped_cancellation(source.token):
                future = asyncio.run_coroutine_threadsafe(
                    run_device_task(coordinator, tentacle_id, prepared["task_input"]), loop
                )
                deadline = time.monotonic() + 260.0
                while True:
                    if source.is_cancelled:
                        future.cancel()
                        raise concurrent.futures.CancelledError("team task cancelled")
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        future.cancel()
                        raise TimeoutError("mobile task timed out")
                    try:
                        records.append(future.result(timeout=min(0.5, remaining)))
                        break
                    except concurrent.futures.TimeoutError:
                        continue
        except Exception as exc:  # noqa: BLE001 - isolate each device
            if future is not None and not future.done():
                future.cancel()
            records.append(
                {
                    "tentacle_id": tentacle_id,
                    "ok": False,
                    "output": "",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
    return records
