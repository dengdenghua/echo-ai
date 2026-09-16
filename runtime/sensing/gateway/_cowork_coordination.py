"""Group-scoped coordination HTTP API; identity comes only from request ACLs."""

from typing import Literal

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

from runtime.memory.cowork.async_work import AsyncWorkQueueFullError


class TaskBody(BaseModel):
    assignee: str = Field(min_length=1, max_length=160)
    prompt: str = Field(min_length=1, max_length=12000)
    request_id: str = Field(min_length=1, max_length=160)
    dependencies: list[str] = Field(default_factory=list, max_length=32)


class ReceiptBody(BaseModel):
    task_id: str = Field(min_length=1, max_length=160)
    action: Literal["acknowledge", "cancel"]
    message_id: str = Field(default="", max_length=160)


def mount_coordination_routes(router, service, access, runtime):
    def owned_task(thread_id, task_id, request):
        task = service.ledger.get(task_id)
        if task is None or task["thread_id"] != thread_id:
            raise HTTPException(404, "task not found")
        actor = access.actor(request)
        member = service.groups.state(thread_id).member(task["member_id"])
        if actor != task["actor_id"] and (member is None or member.accountable_owner != actor):
            raise HTTPException(403, "only the task initiator or accountable owner may act")
        return task

    @router.get("/api/collab/{thread_id}/coordination")
    def snapshot(thread_id: str, request: Request):
        access.require_collaborative_thread(thread_id, request)
        data = service.snapshot(thread_id)
        data["runner_enabled"] = bool(getattr(runtime, "runner_enabled", False))
        data["actor_id"] = access.actor(request)
        decision = getattr(request.state, "cowork_thread_access", None)
        data["can_write"] = decision.can_write if decision is not None else True
        return data

    @router.post("/api/collab/{thread_id}/coordination/tasks")
    def create_task(thread_id: str, body: TaskBody, request: Request):
        access.require_collaborative_thread(thread_id, request, write=True)
        if not getattr(runtime, "runner_enabled", False):
            raise HTTPException(503, "后台任务执行器暂不可用，请恢复服务后重试")
        try:
            task = service.create_task(
                thread_id,
                access.actor(request),
                body.assignee,
                body.prompt,
                body.request_id,
                body.dependencies,
            )
            return {"task": task}
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except AsyncWorkQueueFullError as exc:
            raise HTTPException(429, "后台任务队列已满，请等待现有工作完成") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.post("/api/collab/{thread_id}/coordination/receipt")
    def receipt(thread_id: str, body: ReceiptBody, request: Request):
        access.require_collaborative_thread(thread_id, request, write=True)
        task = owned_task(thread_id, body.task_id, request)
        try:
            if body.action == "cancel":
                if service.queue.get(task["id"]) is None:
                    raise HTTPException(409, "请使用对话中的停止按钮结束当前回复")
                service.queue.cancel_batch(
                    [task["id"]], reason=f"cancelled by {access.actor(request)}"
                )
                service.sync(thread_id)
                return {"cancelled": True}
            return {
                "acknowledged": service.ledger.acknowledge(
                    task["id"], body.message_id, actor=access.actor(request)
                )
            }
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
