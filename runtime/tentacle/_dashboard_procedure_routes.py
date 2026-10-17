"""Deterministic procedure, execution receipt and telemetry routes for the Tentacle dashboard."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from contextlib import suppress
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Request as FastAPIRequest
from fastapi.responses import StreamingResponse

from runtime.tentacle.contract import manifest_for
from runtime.tentacle.procedure import Procedure, ProcedureStep, RetryPolicy
from runtime.tentacle.simulation import ProcedureSimulator, SimulationScenario

if TYPE_CHECKING:
    from runtime.tentacle.coordinator import TentacleCoordinator


def register_procedure_routes(
    router: APIRouter,
    coordinator: TentacleCoordinator,
    require_http_auth: Callable[[FastAPIRequest], None],
) -> None:
    """Register deterministic device procedure CRUD, run and control routes."""
    # ── 确定性设备流程 ──────────────────────────────────

    @router.get("/procedures", dependencies=[Depends(require_http_auth)])
    async def list_procedures() -> list[dict[str, Any]]:
        return sorted(
            (procedure.to_dict() for procedure in coordinator.procedures.values()),
            key=lambda item: item["updated_at"],
            reverse=True,
        )

    @router.post("/procedures", dependencies=[Depends(require_http_auth)])
    async def create_procedure(body: dict[str, Any]) -> dict[str, Any]:
        procedure_id = str(body.get("procedure_id") or "").strip()
        device_id = str(body.get("device_id") or "").strip()
        raw_steps = body.get("steps")
        if not procedure_id or not device_id or not isinstance(raw_steps, list) or not raw_steps:
            raise HTTPException(400, "procedure_id, device_id and non-empty steps are required")
        device = coordinator.pool.get(device_id)
        if device is None:
            raise HTTPException(404, f"Device {device_id} not found")
        try:
            steps = tuple(
                ProcedureStep(
                    step_id=str(step["step_id"]),
                    action=str(step["action"]),
                    arguments=dict(step.get("arguments") or {}),
                    retry=RetryPolicy(**dict(step.get("retry") or {})),
                )
                for step in raw_steps
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(400, f"invalid procedure steps: {exc}") from exc
        procedure = Procedure(procedure_id, device_id, steps)
        try:
            coordinator.procedure_store.path_for(procedure_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        errors = coordinator.procedure_executor.validate(procedure, device)
        if errors:
            raise HTTPException(400, {"message": "procedure validation failed", "errors": errors})
        try:
            coordinator.register_procedure(procedure)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return procedure.to_dict()

    def _procedure_or_404(procedure_id: str) -> Procedure:
        procedure = coordinator.procedures.get(procedure_id)
        if procedure is None:
            raise HTTPException(404, f"Procedure {procedure_id} not found")
        return procedure

    @router.post("/procedures/{procedure_id}/run", dependencies=[Depends(require_http_auth)])
    async def run_procedure(
        procedure_id: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        procedure = _procedure_or_404(procedure_id)
        wait = bool((body or {}).get("wait", False))
        task = coordinator.schedule_procedure(procedure_id)
        if wait:
            await task
        return procedure.to_dict()

    @router.post("/procedures/{procedure_id}/dry-run", dependencies=[Depends(require_http_auth)])
    async def dry_run_procedure(
        procedure_id: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        procedure = _procedure_or_404(procedure_id)
        device = coordinator.pool.get(procedure.device_id)
        if device is None:
            raise HTTPException(404, f"Device {procedure.device_id} not found")
        payload = body or {}
        initial_state = payload.get("initial_state") or {}
        injected_faults = payload.get("injected_faults") or {}
        if not isinstance(initial_state, dict) or not isinstance(injected_faults, dict):
            raise HTTPException(400, "initial_state and injected_faults must be objects")
        scenario = SimulationScenario(
            initial_state=dict(initial_state),
            injected_faults={str(key): str(value) for key, value in injected_faults.items()},
        )
        report = ProcedureSimulator().simulate(procedure, manifest_for(device), scenario)
        coordinator.telemetry.publish(
            "procedure.simulated",
            procedure.device_id,
            {
                "procedure_id": procedure.procedure_id,
                "success": report.success,
                "steps": len(report.steps),
            },
        )
        return report.to_dict()

    @router.post("/procedures/{procedure_id}/pause", dependencies=[Depends(require_http_auth)])
    async def pause_procedure(procedure_id: str) -> dict[str, Any]:
        procedure = _procedure_or_404(procedure_id)
        coordinator.procedure_executor.pause(procedure)
        return procedure.to_dict()

    @router.post("/procedures/{procedure_id}/resume", dependencies=[Depends(require_http_auth)])
    async def resume_procedure(
        procedure_id: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        procedure = _procedure_or_404(procedure_id)
        previous = coordinator.procedure_tasks.get(procedure_id)
        if previous is not None and not previous.done():
            await previous
        coordinator.procedure_executor.resume(procedure)
        task = coordinator.schedule_procedure(procedure_id)
        if bool((body or {}).get("wait", False)):
            await task
        return procedure.to_dict()

    @router.post("/procedures/{procedure_id}/cancel", dependencies=[Depends(require_http_auth)])
    async def cancel_procedure(procedure_id: str) -> dict[str, Any]:
        procedure = _procedure_or_404(procedure_id)
        coordinator.procedure_executor.cancel(procedure)
        return procedure.to_dict()

    @router.post(
        "/procedures/{procedure_id}/emergency-stop", dependencies=[Depends(require_http_auth)]
    )
    async def emergency_stop_procedure(procedure_id: str) -> dict[str, Any]:
        procedure = _procedure_or_404(procedure_id)
        device = coordinator.pool.get(procedure.device_id)
        if device is None:
            raise HTTPException(404, f"Device {procedure.device_id} not found")
        running = coordinator.procedure_tasks.get(procedure_id)
        if running is not None and not running.done():
            running.cancel()
            with suppress(asyncio.CancelledError):
                await running
        await coordinator.procedure_executor.emergency_stop(procedure, device)
        return procedure.to_dict()


def register_telemetry_routes(
    router: APIRouter,
    coordinator: TentacleCoordinator,
    require_http_auth: Callable[[FastAPIRequest], None],
) -> None:
    """Register execution receipt, device health/telemetry and event-stream routes."""

    @router.get("/receipts", dependencies=[Depends(require_http_auth)])
    async def list_execution_receipts(
        device_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        safe_limit = max(0, min(limit, 500))
        return [
            receipt.to_dict()
            for receipt in coordinator.device_executor.ledger.list(
                device_id=device_id, limit=safe_limit
            )
        ]

    @router.get("/devices/{tentacle_id}/health", dependencies=[Depends(require_http_auth)])
    async def device_health(tentacle_id: str) -> dict[str, Any]:
        device = coordinator.pool.get(tentacle_id)
        if device is None:
            raise HTTPException(404, f"Device {tentacle_id} not found")
        heartbeat = await device.heartbeat()
        coordinator.telemetry.record_heartbeat(heartbeat)
        return coordinator.telemetry.health(tentacle_id)

    @router.get("/devices/{tentacle_id}/telemetry", dependencies=[Depends(require_http_auth)])
    async def device_telemetry(
        tentacle_id: str, metric: str | None = None, limit: int = 200
    ) -> dict[str, Any]:
        if coordinator.pool.get(tentacle_id) is None:
            raise HTTPException(404, f"Device {tentacle_id} not found")
        safe_limit = max(0, min(limit, 2_000))
        return {
            "samples": coordinator.telemetry.samples(tentacle_id, metric=metric, limit=safe_limit),
            "faults": coordinator.telemetry.faults(tentacle_id, limit=min(safe_limit, 200)),
        }

    @router.get("/events", dependencies=[Depends(require_http_auth)])
    async def tentacle_events(request: FastAPIRequest) -> StreamingResponse:
        queue = coordinator.telemetry.subscribe()

        async def stream():
            try:
                yield "event: ready\ndata: {}\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=15)
                    except TimeoutError:
                        yield ": keepalive\n\n"
                        continue
                    payload = json.dumps(event, ensure_ascii=False, default=str)
                    yield f"event: {event['event']}\ndata: {payload}\n\n"
            finally:
                coordinator.telemetry.unsubscribe(queue)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )


__all__ = ["register_procedure_routes", "register_telemetry_routes"]
