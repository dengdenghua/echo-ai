"""Run a chat turn on a selected execution node (work location ``node``).

The node is another Echo instance that claims snapshot tasks for a shared
workspace (see ``runtime.execution.node_worker``). This driver submits the
user's message as one such task, reports progress in the conversation, and
posts the node's answer and delivered files as the assistant reply. The node's
own sandbox (file tools only, no shell or network) still applies.
"""

from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path
from typing import Any

NODE_LOCATION_REASON = "work_location_node"
_POLL_INTERVAL_S = 1.0
_TASK_TIMEOUT_S = 900
# The node may wait in queue before it claims; give it room beyond the run cap.
_WAIT_GRACE_S = 120
# Worker errors arrive as "RuntimeError: RuntimeError: ..."; show the message.
_EXCEPTION_PREFIX = re.compile(r"^(?:[A-Za-z_][\w.]*(?:Error|Exception): )+")


def node_work_location(context: dict[str, Any] | None) -> dict[str, str] | None:
    """Return the requested node location, or ``None`` for this computer."""
    raw = (context or {}).get("work_location")
    if not isinstance(raw, dict) or raw.get("kind") != "node":
        return None
    location = {key: str(raw.get(key) or "").strip() for key in ("node_id", "workspace_id", "role")}
    if not all(location.values()):
        raise ValueError("执行节点需要指定节点、工作空间和角色")
    return location


def _principal(turn: Any) -> tuple[str, str]:
    # Matches the execution router's local fallback, which owns node listing.
    params = getattr(turn, "params", None)
    tenant = getattr(params, "tenant_id", None) or "local"
    actor = getattr(params, "owner_actor_id", None) or "local"
    return tenant, actor


async def _emit_commentary(runtime: Any, turn: Any, log: Any, emitter: Any, text: str) -> None:
    from runtime.protocol.items import AgentMessageItem, ItemStatus

    item = AgentMessageItem(text=text, message_kind="commentary")
    turn.items.append(item)
    await runtime._emit_item_started(turn, log, emitter, item)
    item.status = ItemStatus.COMPLETED
    await runtime._emit_item_completed(turn, log, emitter, item)


def _delivery_summary(result: dict[str, Any]) -> str:
    artifacts = result.get("artifacts") or []
    if not artifacts:
        return ""
    lines = [f"\n\n---\n节点改动了 {len(artifacts)} 个文件："]
    lines += [f"- `{artifact.get('path')}`" for artifact in artifacts[:32]]
    lines.append("可以在「共享空间 → 执行节点」中查看、下载，或应用到工作空间。")
    return "\n".join(lines)


async def drive_execution_node(
    runtime: Any,
    turn: Any,
    log: Any,
    emitter: Any,
    intent: Any,
    *,
    text: str,
) -> None:
    from runtime.execution.node_control import ExecutionNodeControl
    from runtime.memory.cowork.collaboration_store import CollaborationStore
    from runtime.sensing.gateway._realtime_turn_lifecycle_helpers import _collaboration_store
    from runtime.workspace import WorkspaceStore
    from runtime.workspace.execution_directory import execution_directory

    location = node_work_location(getattr(intent, "user_context", None))
    if location is None:
        raise ValueError("this turn did not select an execution node")
    # A node task is one atomic delivery. Mid-turn steering would otherwise be
    # replayed through this driver as a second, context-free task; refuse it so
    # the client sends it as the next turn instead.
    set_steering = getattr(runtime, "_set_turn_steering_accepting", None)
    if callable(set_steering):
        set_steering(turn, False)
    store = _collaboration_store(runtime) or CollaborationStore()
    control = ExecutionNodeControl(store)
    tenant, actor = _principal(turn)

    node = next((n for n in control.nodes(tenant) if n["node_id"] == location["node_id"]), None)
    if node is None:
        raise RuntimeError("找不到这个执行节点，它可能已被移除")
    label = node.get("label") or node["node_id"]
    if not node.get("online"):
        raise RuntimeError(f"执行节点「{label}」当前不在线，请确认那台机器上的 Echo 正在运行")
    spaces = WorkspaceStore()
    workspace = spaces.get_workspace(location["workspace_id"])
    # Same writable-workspace rule as the execution router: the snapshot is
    # taken here, so an authenticated caller must own or edit the workspace.
    if workspace is None or (
        getattr(getattr(turn, "params", None), "tenant_id", None)
        and (
            workspace.tenant_id != tenant
            or spaces.get_member_role(workspace.id, actor) not in {"owner", "editor"}
        )
    ):
        raise RuntimeError("找不到这个共享工作空间，或你没有写入权限")
    probe = execution_directory(workspace)

    run = await asyncio.to_thread(
        control.submit,
        tenant_id=tenant,
        actor_id=actor,
        request_id=f"turn:{turn.id}",
        workspace_id=location["workspace_id"],
        node_ids=[location["node_id"]],
        goal=text,
        role=location["role"],
        output_files=[],
        timeout_s=_TASK_TIMEOUT_S,
        snapshot_source=Path(probe["filesystem_path"]) if probe.get("ready") else None,
    )
    run_id = run["run_id"]
    await _emit_commentary(runtime, turn, log, emitter, f"已派发到执行节点「{label}」，等待领取…")

    deadline = time.monotonic() + _TASK_TIMEOUT_S + _WAIT_GRACE_S
    announced_attempt = -1
    while True:
        if emitter.is_turn_interrupted(turn.id):
            await asyncio.to_thread(
                store.transition_collaboration_run, run_id, status="cancelled", event_type="cancel"
            )
            return
        run = await asyncio.to_thread(store.collaboration_run, run_id) or run
        status = run.get("status")
        if status == "completed":
            break
        if status in {"failed", "cancelled"}:
            reason = _EXCEPTION_PREFIX.sub("", str(run.get("error") or "")) or (
                "任务已取消" if status == "cancelled" else "节点执行失败"
            )
            raise RuntimeError(f"执行节点「{label}」未完成：{reason}")
        attempt = int(run.get("attempt") or 0)
        if status == "running" and attempt != announced_attempt:
            announced_attempt = attempt
            suffix = f"（第 {attempt} 次尝试）" if attempt > 1 else ""
            await _emit_commentary(runtime, turn, log, emitter, f"「{label}」正在执行{suffix}…")
        if time.monotonic() >= deadline:
            raise TimeoutError(f"执行节点「{label}」超时未完成")
        await asyncio.sleep(_POLL_INTERVAL_S)

    result = run.get("result") or {}
    answer = str(result.get("output") or "").strip() or "（节点没有返回文字说明）"
    await runtime._emit_agent_message(turn, log, emitter, answer + _delivery_summary(result))


__all__ = ["NODE_LOCATION_REASON", "drive_execution_node", "node_work_location"]
