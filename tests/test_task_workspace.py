import asyncio
from types import SimpleNamespace

import pytest

from runtime.tentacle.base import ToolCall, ToolResult
from runtime.tentacle.contract import ActionSpec, DeviceManifest
from runtime.tentacle.execution import ActionGrant
from runtime.tentacle.mobile.device import MobileDevice
from runtime.tentacle.pool import TentaclePool
from runtime.tentacle.task_workspace import TaskWorkspace


class Device(MobileDevice):
    @property
    def manifest(self):
        return DeviceManifest(
            device_id=self.tentacle_id,
            kind="test",
            platform="test",
            actions=(ActionSpec(name="first"), ActionSpec(name="second")),
        )

    @property
    def capabilities(self):
        return ["first", "second"]

    def __init__(self, name="phone"):
        super().__init__(name)
        self._capabilities = ["first", "second"]
        self.calls = []
        self.gate = None

    async def execute(self, call):
        self.calls.append(call.tool)
        if self.gate and call.tool == "first":
            await self.gate.wait()
        return ToolResult.ok(call.call_id, {"performed": call.tool})


async def setup(root):
    pool = TentaclePool()
    device = Device()
    await device.connect()
    await pool.register(device)

    async def plan(_task, target):
        return [
            ToolCall("one", target.tentacle_id, "first"),
            ToolCall("two", target.tentacle_id, "second"),
        ]

    coordinator = SimpleNamespace(
        pool=pool, _decision_engine=plan, ws_server=SimpleNamespace(peer_grants={})
    )
    return TaskWorkspace(coordinator, root), device, coordinator


async def submit(workspace, source="phone"):
    args = {"id": "same-task", "task": "做两步", "device_id": "phone"}
    await workspace.dispatch("submit", args, actor="device:phone", source=source)
    await workspace.running["same-task"]
    return workspace.view(workspace.records["same-task"])


async def started(device):
    async with asyncio.timeout(2):
        while not device.calls:
            await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_phone_submits_desktop_approves_and_restarted_server_returns_same_result(tmp_path):
    workspace, device, coordinator = await setup(tmp_path)
    task = await submit(workspace)
    assert task["status"] == "awaiting_approval"
    assert device.calls == []
    await workspace.dispatch(
        "approve", {"id": task["id"], "revision": task["revision"]}, actor="os-user"
    )
    await workspace.running[task["id"]]
    restored = TaskWorkspace(coordinator, tmp_path)
    task = (await restored.dispatch("list", {}, actor="phone", source="phone"))["tasks"][0]
    assert task["id"] == "same-task"
    assert task["status"] == "succeeded"
    assert task["current_step"] == 2
    assert len(task["results"]) == 2
    assert task["approved_by"] == "os-user"
    assert device.calls == ["first", "second"]


@pytest.mark.asyncio
async def test_pause_during_step_commits_success_before_resume(tmp_path):
    workspace, device, _ = await setup(tmp_path)
    device.gate = asyncio.Event()
    task = await submit(workspace)
    await workspace.dispatch(
        "approve", {"id": task["id"], "revision": task["revision"]}, actor="os"
    )
    await started(device)
    await workspace.dispatch("pause", {"id": task["id"]}, actor="phone", source="phone")
    device.gate.set()
    await workspace.running[task["id"]]
    task = workspace.view(workspace.records[task["id"]])
    assert task["status"] == "paused" and task["current_step"] == 1
    await workspace.dispatch("resume", {"id": task["id"], "revision": task["revision"]}, actor="ai")
    await workspace.running[task["id"]]
    assert device.calls == ["first", "second"]


@pytest.mark.asyncio
async def test_restart_during_action_requires_outcome_review_and_never_replays(tmp_path):
    workspace, device, coordinator = await setup(tmp_path)
    device.gate = asyncio.Event()
    task = await submit(workspace)
    await workspace.dispatch(
        "approve", {"id": task["id"], "revision": task["revision"]}, actor="os"
    )
    await started(device)
    await workspace.shutdown()
    restored = TaskWorkspace(coordinator, tmp_path)
    task = restored.view(restored.records[task["id"]])
    assert task["in_flight_step"] == 0 and task["status"] == "paused"
    with pytest.raises(ValueError, match="结果不明"):
        await restored.dispatch(
            "resume", {"id": task["id"], "revision": task["revision"]}, actor="ai"
        )
    assert device.calls == ["first"]
    await restored.dispatch(
        "resume",
        {"id": task["id"], "revision": task["revision"], "resolution": "completed"},
        actor="ai",
    )
    await restored.running[task["id"]]
    assert device.calls == ["first", "second"]


@pytest.mark.asyncio
async def test_stale_approval_and_foreign_phone_are_rejected(tmp_path):
    workspace, device, _ = await setup(tmp_path)
    task = await submit(workspace)
    with pytest.raises(ValueError, match="已变化"):
        await workspace.dispatch("approve", {"id": task["id"], "revision": "stale"}, actor="os")
    with pytest.raises(PermissionError):
        await workspace.dispatch("get", {"id": task["id"]}, actor="other", source="other")
    with pytest.raises(PermissionError):
        await workspace.dispatch(
            "submit",
            {"id": "other", "task": "do it", "device_id": "phone"},
            actor="other",
            source="other",
        )
    assert (await workspace.dispatch("list", {}, actor="other", source="other"))["tasks"] == []
    assert device.calls == []


@pytest.mark.asyncio
async def test_no_planner_is_an_interrupted_task_not_a_success(tmp_path):
    workspace, _, coordinator = await setup(tmp_path)
    coordinator._decision_engine = None
    task = await submit(workspace)
    assert task["status"] == "interrupted"
    assert "规划器" in task["error"]
    assert task["current_step"] == 0


@pytest.mark.asyncio
async def test_peer_action_grants_are_checked_after_planning_and_again_at_execution(tmp_path):
    workspace, device, coordinator = await setup(tmp_path)
    coordinator.ws_server.peer_grants = {"other": {"phone": ["first"]}}
    task = await submit(workspace, source="other")
    assert task["status"] == "interrupted" and "授权" in task["error"]
    coordinator.ws_server.peer_grants["other"]["phone"].append("second")
    await workspace.dispatch("resume", {"id": task["id"], "revision": task["revision"]}, actor="os")
    await workspace.running[task["id"]]
    task = workspace.view(workspace.records[task["id"]])
    coordinator.ws_server.peer_grants.clear()
    await workspace.dispatch(
        "approve", {"id": task["id"], "revision": task["revision"]}, actor="os"
    )
    await workspace.running[task["id"]]
    assert device.calls == []
    assert workspace.view(workspace.records[task["id"]])["status"] == "paused"


@pytest.mark.asyncio
async def test_resubmission_reuses_identity_and_cancelled_history_can_be_removed(tmp_path):
    workspace, device, _ = await setup(tmp_path)
    await submit(workspace)
    same = await workspace.dispatch(
        "submit",
        {"id": "same-task", "task": "做两步", "device_id": "phone"},
        actor="device:phone",
        source="phone",
    )
    assert same["status"] == "awaiting_approval" and len(workspace.records) == 1
    with pytest.raises(ValueError, match="另一项"):
        await workspace.dispatch(
            "submit",
            {"id": "same-task", "task": "different", "device_id": "phone"},
            actor="device:phone",
            source="phone",
        )
    await workspace.dispatch("cancel", {"id": "same-task"}, actor="os")
    await workspace.dispatch("remove", {"id": "same-task"}, actor="os")
    assert not list(tmp_path.glob("task-*.json"))
    assert device.calls == []


def test_approved_plan_grants_bind_exact_arguments():
    grant = ActionGrant("write", exact_arguments={"path": "a.txt", "content": "approved"})
    assert grant.allows("write", {"path": "a.txt", "content": "approved"})
    assert not grant.allows("write", {"path": "b.txt", "content": "approved"})


@pytest.mark.asyncio
async def test_revocation_while_a_step_is_running_blocks_the_next_step(tmp_path):
    workspace, device, coordinator = await setup(tmp_path)
    coordinator.ws_server.peer_grants = {"other": {"phone": ["first", "second"]}}
    device.gate = asyncio.Event()
    task = await submit(workspace, source="other")
    await workspace.dispatch(
        "approve", {"id": task["id"], "revision": task["revision"]}, actor="os"
    )
    await started(device)
    coordinator.ws_server.peer_grants.clear()
    device.gate.set()
    await workspace.running[task["id"]]
    assert device.calls == ["first"]
    assert workspace.view(workspace.records[task["id"]])["status"] == "failed"
