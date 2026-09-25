"""One durable device-task workspace for HTTP operators and paired devices.

Planning and UI metadata wrap the existing Procedure executor; they do not
introduce another action runner. Approval always binds the displayed plan.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

from runtime.platform.io import atomic_write_json
from runtime.platform.process.paths import app_paths

from .base import ToolResult
from .execution import ActionGrant, ApprovalEnvelope, DeviceActionExecutor
from .procedure import (
    Procedure,
    ProcedureCheckpointStore,
    ProcedureExecutor,
    ProcedureStatus,
    ProcedureStep,
)


class TaskWorkspace:
    def __init__(self, coordinator: Any, root: Path) -> None:
        self.coordinator = coordinator
        self.root = root
        self.store = ProcedureCheckpointStore(root / "procedures")
        executor = getattr(coordinator, "device_executor", None) or DeviceActionExecutor(
            coordinator.pool
        )
        self.action_executor = executor
        self.executor = ProcedureExecutor(executor, self.store)
        self.records: dict[str, dict[str, Any]] = {}
        self.procedures = {p.procedure_id: p for p in self.store.load_all()}
        self.running: dict[str, asyncio.Task] = {}
        self.closed = False
        for path in root.glob("task-*.json"):
            record = json.loads(path.read_text(encoding="utf-8"))
            self.records[record["id"]] = record
            if record["phase"] == "planning":
                record.update(phase="interrupted", error="服务已重启，请重新生成执行计划")
                self._save(record)
        for p in self.procedures.values():
            if p.status == ProcedureStatus.RUNNING:
                p.status = ProcedureStatus.PAUSED
                p.error = (
                    "服务已重启；请核对当前步骤后继续"
                    if p.in_flight_step is not None
                    else "服务已重启，可从已确认步骤继续"
                )
                self.store.save(p)

    def _save(self, record: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        record["updated_at"] = time.time()
        atomic_write_json(
            self.root / f"task-{record['id']}.json", record, mode=0o600, keep_backup=False
        )

    def view(self, record: dict[str, Any]) -> dict[str, Any]:
        p = self.procedures.get(record["id"])
        result = dict(record)
        result.update(
            status=record["phase"], steps=[], current_step=0, results=[], in_flight_step=None
        )
        if p:
            result.update(
                status="awaiting_approval" if p.status == ProcedureStatus.DRAFT else p.status.value,
                steps=[{"action": s.action, "arguments": s.arguments} for s in p.steps],
                current_step=p.current_step,
                in_flight_step=p.in_flight_step,
                results=p.results[-3:],
                error=p.error,
                updated_at=max(p.updated_at, record["updated_at"]),
            )
        result["revision"] = hashlib.sha256(
            json.dumps(
                [
                    result["device_id"],
                    result["steps"],
                    result["current_step"],
                    result["in_flight_step"],
                ],
                sort_keys=True,
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
        result["busy"] = record["id"] in self.running and not self.running[record["id"]].done()
        return result

    def _allowed(self, source: str | None, target: str, actions: list[str] | None = None) -> bool:
        if source is None or source == target:
            return True
        grants = self.coordinator.ws_server.peer_grants.get(source, {}).get(target, [])
        return bool(grants) and (actions is None or all(action in grants for action in actions))

    def _schedule(self, task_id: str, coroutine: Any) -> None:
        if self.closed:
            coroutine.close()
            raise ValueError("设备服务正在关闭")
        self.running[task_id] = asyncio.create_task(coroutine)

    async def _plan(self, record: dict[str, Any]) -> None:
        try:
            device = self.coordinator.pool.get(record["device_id"])
            if device is None or not device.is_online:
                raise ValueError("目标设备离线，请连接后重新生成计划")
            if self.coordinator._decision_engine is None:
                raise ValueError("当前设备中心尚未配置任务规划器")
            calls = await asyncio.wait_for(
                self.coordinator._decision_engine(record["task"], device), 60
            )
            if record["phase"] != "planning":
                return
            if not calls or len(calls) > 32:
                raise ValueError("规划器没有生成可执行步骤，或超过 32 步上限")
            if any(call.tentacle_id != record["device_id"] for call in calls):
                raise ValueError("计划包含其他设备的操作，请为目标设备分别创建任务")
            if not self._allowed(
                record["source_device"], record["device_id"], [c.tool for c in calls]
            ):
                raise ValueError("此手机尚未获得目标设备所需操作的授权")
            p = Procedure(
                record["id"],
                record["device_id"],
                tuple(
                    ProcedureStep(str(index), call.tool, dict(call.args))
                    for index, call in enumerate(calls)
                ),
            )
            errors = self.executor.validate(p, device)
            if errors:
                raise ValueError("; ".join(errors))
            if len(json.dumps(p.to_dict())) > 64000:
                raise ValueError("任务计划过大")
            self.store.save(p)
            self.procedures[p.procedure_id] = p
            record.update(phase="awaiting_approval", error=None)
        except asyncio.CancelledError:
            if record["phase"] == "planning":
                record.update(phase="interrupted", error="计划生成已中断")
            raise
        except Exception as exc:
            if record["phase"] == "planning":
                record.update(phase="interrupted", error=str(exc)[:2000])
        finally:
            self._save(record)

    async def _run(self, record: dict[str, Any], actor: str) -> None:
        p = self.procedures[record["id"]]
        try:
            device = self.coordinator.pool.get(p.device_id)
            if device is None or not device.is_online:
                raise ValueError("设备已离线，连接后可继续")
            if not self._allowed(record["source_device"], p.device_id, [s.action for s in p.steps]):
                raise ValueError("设备间的操作授权已撤销")
            envelope = ApprovalEnvelope(
                envelope_id=f"workspace:{p.procedure_id}:{time.time_ns()}",
                actor_id=actor,
                device_id=p.device_id,
                task_id=p.procedure_id,
                expires_at=time.time() + 3600,
                grants=tuple(
                    ActionGrant(s.action, exact_arguments=dict(s.arguments)) for s in p.steps
                ),
            )
            # Check directed grants on every step, including revocation while
            # an earlier step is waiting for a device response.
            guarded = WorkspaceActionExecutor(
                self.action_executor,
                lambda action: self._allowed(
                    record["source_device"],
                    p.device_id,
                    [action],
                ),
            )
            await ProcedureExecutor(guarded, self.store).run(p, device, envelope=envelope)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            p.status = ProcedureStatus.PAUSED
            p.error = str(exc)[:2000]
            self.store.save(p)

    async def dispatch(
        self, command: str, args: dict[str, Any], *, actor: str, source: str | None = None
    ) -> dict[str, Any]:
        if command == "devices":
            return {
                "devices": [
                    {"id": d.tentacle_id, "platform": d.platform, "online": d.is_online}
                    for d in self.coordinator.pool.all()
                    if self._allowed(source, d.tentacle_id)
                ]
            }
        if command == "list":
            rows = [
                self.view(r)
                for r in self.records.values()
                if source is None or r["source_device"] == source or r["device_id"] == source
            ]
            return {"tasks": sorted(rows, key=lambda r: r["updated_at"], reverse=True)[:50]}
        task_id = args.get("id", "")
        if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", task_id):
            raise ValueError("任务 ID 无效")
        record = self.records.get(task_id)
        if command == "submit":
            target, text = args.get("device_id"), args.get("task")
            if (
                not isinstance(target, str)
                or not isinstance(text, str)
                or not 1 <= len(text.strip()) <= 4096
            ):
                raise ValueError("请选择设备并填写任务（最多 4096 字）")
            if not self._allowed(source, target):
                raise PermissionError("尚未授权此设备间的操作")
            if record:
                if (record["device_id"], record["task"], record["source_device"]) != (
                    target,
                    text.strip(),
                    source,
                ):
                    raise ValueError("此任务 ID 已用于另一项任务")
                return self.view(record)
            if len(self.records) >= 100:
                raise ValueError("任务记录已达 100 条，请先移除已结束的记录")
            if sum(not t.done() for t in self.running.values()) >= 8:
                raise ValueError("设备中心任务繁忙，请稍后再试")
            record = {
                "id": task_id,
                "task": text.strip(),
                "device_id": target,
                "source_device": source,
                "created_by": actor,
                "created_at": time.time(),
                "phase": "planning",
                "error": None,
            }
            self.records[task_id] = record
            self._save(record)
            self._schedule(task_id, self._plan(record))
            return self.view(record)
        if record is None:
            raise ValueError("找不到任务")
        if (
            source is not None
            and record["source_device"] != source
            and record["device_id"] != source
        ):
            raise PermissionError("此任务不属于当前设备")
        p = self.procedures.get(task_id)
        busy = task_id in self.running and not self.running[task_id].done()
        if command == "get":
            result = self.view(record)
            result["results"] = list(p.results) if p else []
            return result
        if command == "pause":
            if p:
                self.executor.pause(p)
            else:
                record["phase"] = "interrupted"
                self._save(record)
        elif command == "cancel":
            if p:
                self.executor.cancel(p)
            record["phase"] = "cancelled"
            self._save(record)
        elif command == "remove":
            if busy or (p and not p.complete) or (not p and record["phase"] != "cancelled"):
                raise ValueError("请先取消任务再移除记录")
            (self.root / f"task-{task_id}.json").unlink(missing_ok=True)
            self.store.path_for(task_id).unlink(missing_ok=True)
            self.procedures.pop(task_id, None)
            self.records.pop(task_id)
            self.running.pop(task_id, None)
            return {"removed": True}
        elif command in {"approve", "resume"}:
            if busy:
                raise ValueError("当前步骤仍在执行，请等待结果")
            if args.get("revision") != self.view(record)["revision"]:
                raise ValueError("任务已变化，请刷新后核对最新计划")
            if p is None:
                if record["phase"] != "interrupted":
                    raise ValueError("此任务不能继续")
                record.update(phase="planning", error=None)
                self._save(record)
                self._schedule(task_id, self._plan(record))
                return self.view(record)
            if p.status not in {ProcedureStatus.DRAFT, ProcedureStatus.PAUSED}:
                raise ValueError("此任务不能继续")
            if p.in_flight_step is not None:
                if args.get("resolution") != "completed":
                    raise ValueError("上一步结果不明，请先在目标设备核对；未完成请取消后重新规划")
                p.results.append(
                    {
                        "step": p.in_flight_step,
                        "action": p.steps[p.in_flight_step].action,
                        "success": True,
                        "summary": "用户核对已完成",
                        "confirmed_by": actor,
                    }
                )
                p.current_step = p.in_flight_step + 1
                p.in_flight_step = None
            record["approved_by"] = actor
            record["approved_at"] = time.time()
            self._save(record)
            self.executor.resume(p)
            self._schedule(task_id, self._run(record, actor))
        else:
            raise ValueError("未知任务操作")
        return self.view(record)

    async def shutdown(self) -> None:
        self.closed = True
        active = [task for task in self.running.values() if not task.done()]
        for task in active:
            task.cancel()
        await asyncio.gather(*active, return_exceptions=True)


class WorkspaceActionExecutor:
    def __init__(self, delegate: Any, allowed: Any) -> None:
        self.delegate = delegate
        self.pool = delegate.pool
        self.allowed = allowed

    async def execute(self, device: Any, call: Any, **kwargs: Any) -> ToolResult:
        if not self.allowed(call.tool):
            return ToolResult.fail(call.call_id, -32004, "设备间操作授权已撤销，已停止后续步骤")
        return await self.delegate.execute(device, call, **kwargs)


def get_task_workspace(coordinator: Any) -> TaskWorkspace:
    if not hasattr(coordinator, "task_workspace"):
        root = getattr(
            coordinator, "task_workspace_path", app_paths().data_dir / "tentacle" / "task-workspace"
        )
        coordinator.task_workspace = TaskWorkspace(coordinator, root)
    return coordinator.task_workspace
