"""Device inventory, single-device task, broadcast and stats routes for the Tentacle dashboard."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Request as FastAPIRequest

from runtime.tentacle.fleet import broadcast as fleet_broadcast

if TYPE_CHECKING:
    from runtime.tentacle.coordinator import TentacleCoordinator


def register_device_routes(
    router: APIRouter,
    coordinator: TentacleCoordinator,
    require_http_auth: Callable[[FastAPIRequest], None],
    task_history: list[dict[str, Any]],
) -> None:
    """Register device inventory, lease and single-device task routes."""
    # ── 设备列表 ────────────────────────────────────────

    @router.get("/devices", dependencies=[Depends(require_http_auth)])
    async def list_devices() -> list[dict[str, Any]]:
        coordinator.pool.all_online()
        all_devices = list(coordinator.pool._tentacles.values())
        result = []
        for d in all_devices:
            result.append(
                {
                    "tentacle_id": d.tentacle_id,
                    "type": d.tentacle_type.value,
                    "platform": getattr(d, "platform", "unknown"),
                    "status": d.status.value,
                    "is_online": d.is_online,
                    "is_busy": d.is_busy,
                    "capabilities": d.capabilities[:5]
                    if len(d.capabilities) > 5
                    else d.capabilities,
                    "total_capabilities": len(d.capabilities),
                    "last_used_ago": round(time.time() - d.last_used_at, 1)
                    if d.last_used_at > 0
                    else None,
                    "meta": d.meta if hasattr(d, "meta") else {},
                    "health": coordinator.telemetry.health(d.tentacle_id),
                }
            )
        return result

    @router.get("/discovery", dependencies=[Depends(require_http_auth)])
    def discovery_status() -> dict[str, Any]:
        discovery = getattr(coordinator, "discovery", None)
        return (
            discovery.snapshot() if discovery else {"available": False, "error": "", "devices": []}
        )

    # ── 设备详情 ────────────────────────────────────────

    @router.get("/devices/{tentacle_id}", dependencies=[Depends(require_http_auth)])
    async def device_detail(tentacle_id: str) -> dict[str, Any]:
        device = coordinator.pool.get(tentacle_id)
        if device is None:
            raise HTTPException(404, f"Device {tentacle_id} not found")
        return {
            "tentacle_id": device.tentacle_id,
            "type": device.tentacle_type.value,
            "platform": getattr(device, "platform", "unknown"),
            "status": device.status.value,
            "is_online": device.is_online,
            "capabilities": device.capabilities,
            "meta": device.meta if hasattr(device, "meta") else {},
        }

    @router.get("/devices/{tentacle_id}/manifest", dependencies=[Depends(require_http_auth)])
    async def device_manifest(tentacle_id: str) -> dict[str, Any]:
        manifest = coordinator.pool.manifest(tentacle_id)
        if manifest is None:
            raise HTTPException(404, f"Device {tentacle_id} not found")
        return manifest.to_dict()

    @router.get("/devices/{tentacle_id}/lease", dependencies=[Depends(require_http_auth)])
    async def device_lease(tentacle_id: str) -> dict[str, Any]:
        if coordinator.pool.get(tentacle_id) is None:
            raise HTTPException(404, f"Device {tentacle_id} not found")
        lease = coordinator.pool.lock_holder(tentacle_id)
        return {
            "leased": lease is not None and not lease.is_expired,
            "lease": lease.to_dict() if lease else None,
        }

    # ── 提交任务 ────────────────────────────────────────

    @router.post("/task", dependencies=[Depends(require_http_auth)])
    async def submit_task(body: dict[str, Any]) -> dict[str, Any]:
        task = body.get("task", "").strip()
        tentacle_id = body.get("tentacle_id", "")
        if not task:
            raise HTTPException(400, "Missing 'task' field")
        if not tentacle_id:
            # 自动选择第一个在线设备
            devices = coordinator.pool.all_online()
            if not devices:
                raise HTTPException(404, "No online devices")
            tentacle_id = devices[0].tentacle_id

        device = coordinator.pool.get(tentacle_id)
        if device is None:
            raise HTTPException(404, f"Device {tentacle_id} not found")
        if not device.is_online:
            raise HTTPException(400, f"Device {tentacle_id} is offline")

        if coordinator._decision_engine is None:
            raise HTTPException(400, "No decision engine configured")

        task_id = f"web-{int(time.time() * 1000)}"
        start = time.time()

        try:
            tool_calls = await coordinator._decision_engine(task, device)
        except Exception as e:
            task_history.append(
                {
                    "task_id": task_id,
                    "task": task,
                    "tentacle_id": tentacle_id,
                    "success": False,
                    "error": str(e),
                    "steps": 0,
                    "duration_ms": int((time.time() - start) * 1000),
                    "timestamp": time.time(),
                }
            )
            raise HTTPException(500, f"Decision engine error: {e}") from e

        guarded_results = await coordinator.device_executor.execute_sequence(
            device,
            tool_calls,
            owner=f"dashboard:{task_id}",
            task_id=task_id,
        )
        results = []
        for call, result in zip(tool_calls, guarded_results, strict=False):
            results.append(
                {
                    "call_id": call.call_id,
                    "tool": call.tool,
                    "args": call.args,
                    "success": result.success,
                    "data": result.data,
                    "error": result.error_message,
                    "duration_ms": result.duration_ms,
                }
            )
            if not result.success:
                break

        success = all(r["success"] for r in results) if results else False
        duration = int((time.time() - start) * 1000)

        record = {
            "task_id": task_id,
            "task": task,
            "tentacle_id": tentacle_id,
            "success": success,
            "steps": len(results),
            "results": results,
            "duration_ms": duration,
            "timestamp": time.time(),
        }
        task_history.append(record)
        # 只保留最近 100 条
        if len(task_history) > 100:
            task_history.pop(0)

        return record


def register_fleet_routes(
    router: APIRouter,
    coordinator: TentacleCoordinator,
    require_http_auth: Callable[[FastAPIRequest], None],
    task_history: list[dict[str, Any]],
) -> None:
    """Register broadcast, task-history and coordinator-stats routes."""
    # ── 群发（一对多群控） ──────────────────────────────

    @router.post("/broadcast", dependencies=[Depends(require_http_auth)])
    async def broadcast_task(body: dict[str, Any]) -> dict[str, Any]:
        """把同一任务并发下发到多台设备并聚合结果。

        body: ``{task, tentacle_ids?, max_concurrency?}``——``tentacle_ids`` 省略
        或为 null 时对所有在线设备群发。单台失败被隔离，不影响其它设备。
        """
        task = body.get("task", "").strip()
        if not task:
            raise HTTPException(400, "Missing 'task' field")
        tentacle_ids = body.get("tentacle_ids")
        if tentacle_ids is not None and not isinstance(tentacle_ids, list):
            raise HTTPException(400, "'tentacle_ids' must be a list or omitted")
        try:
            max_concurrency = int(body.get("max_concurrency", 8) or 8)
        except (TypeError, ValueError):
            raise HTTPException(400, "'max_concurrency' must be an integer") from None

        start = time.time()
        result = await fleet_broadcast(
            coordinator, task, tentacle_ids, max_concurrency=max_concurrency
        )

        record = {
            "task_id": f"web-bcast-{int(time.time() * 1000)}",
            "task": task,
            "broadcast": True,
            "success": result["ok"],
            "total": result["total"],
            "succeeded": result["succeeded"],
            "failed": result["failed"],
            "results": result["results"],
            "duration_ms": int((time.time() - start) * 1000),
            "timestamp": time.time(),
        }
        task_history.append(record)
        if len(task_history) > 100:
            task_history.pop(0)
        return record

    # ── 任务历史 ────────────────────────────────────────

    @router.get("/tasks", dependencies=[Depends(require_http_auth)])
    async def list_tasks() -> list[dict[str, Any]]:
        return list(reversed(task_history))

    # ── 协调器统计 ──────────────────────────────────────

    @router.get("/stats", dependencies=[Depends(require_http_auth)])
    async def stats() -> dict[str, Any]:
        return coordinator.stats()


__all__ = ["register_device_routes", "register_fleet_routes"]
