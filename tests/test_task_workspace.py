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


@pytest.mark.asyncio
async def test_result_review_is_durable_revision_bound_and_never_reexecutes(tmp_path):
    workspace, device, coordinator = await setup(tmp_path)
    draft = await submit(workspace)
    with pytest.raises(ValueError, match="全部步骤"):
        await workspace.dispatch(
            "review_result",
            {"id": draft["id"], "revision": draft["revision"], "outcome": "achieved"},
            actor="os",
        )
    await workspace.dispatch(
        "approve", {"id": draft["id"], "revision": draft["revision"]}, actor="os"
    )
    await workspace.running[draft["id"]]
    task = workspace.view(workspace.records[draft["id"]])
    assert task["status"] == "succeeded" and task["result_review"] is None
    args = {"id": task["id"], "revision": task["revision"], "outcome": "achieved"}
    with pytest.raises(PermissionError):
        await workspace.dispatch("review_result", args, actor="stranger", source="stranger")
    with pytest.raises(ValueError, match="请选择"):
        await workspace.dispatch("review_result", {**args, "outcome": "unknown"}, actor="os")
    with pytest.raises(ValueError, match="已变化"):
        await workspace.dispatch(
            "review_result", {**args, "revision": draft["revision"]}, actor="os"
        )
    checked = await workspace.dispatch("review_result", args, actor="os-user")
    assert checked["result_review"]["reviewed_by"] == "os-user"
    restored = TaskWorkspace(coordinator, tmp_path)
    retry = await restored.dispatch("review_result", args, actor="device:phone", source="phone")
    assert retry["result_review"] == checked["result_review"]
    revised = await restored.dispatch(
        "review_result",
        {**args, "revision": checked["revision"], "outcome": "not_achieved"},
        actor="device:phone",
        source="phone",
    )
    assert revised["result_review"]["outcome"] == "not_achieved"
    assert revised["result_review"]["reviewed_by"] == "device:phone"
    with pytest.raises(ValueError, match="已变化"):
        await restored.dispatch("review_result", args, actor="os-user")
    assert device.calls == ["first", "second"]
    # Changed execution evidence invalidates a prior goal review.
    restored.procedures[task["id"]].results[-1]["summary"] = "new evidence"
    assert restored.view(restored.records[task["id"]])["result_review"] is None


async def staged_setup(root):
    workspace, phone, coordinator = await setup(root)
    pc = Device("pc")
    await pc.connect()
    await coordinator.pool.register(pc)
    coordinator.ws_server.peer_grants = {"phone": {"pc": ["first", "second"]}}
    prompts = []

    async def planner(task, target):
        prompts.append((target.tentacle_id, task))
        return [ToolCall("one", target.tentacle_id, "first")]

    coordinator._decision_engine = planner
    args = {
        "id": "workflow",
        "task": "电脑生成资料，手机接续",
        "stages": [
            {"device_id": "pc", "task": "生成资料"},
            {"device_id": "phone", "task": "查看前一步的资料"},
        ],
    }
    return workspace, phone, pc, coordinator, prompts, args


async def complete_stage(workspace, task_id="workflow"):
    view = workspace.view(workspace.records[task_id])
    await workspace.dispatch("approve", {"id": task_id, "revision": view["revision"]}, actor="os")
    await workspace.running[task_id]
    return workspace.view(workspace.records[task_id])


@pytest.mark.asyncio
async def test_multidevice_parent_hands_off_reviewed_observations_without_replaying(tmp_path):
    workspace, phone, pc, coordinator, prompts, args = await staged_setup(tmp_path)
    await workspace.dispatch("submit", args, actor="phone", source="phone")
    await workspace.running["workflow"]
    first = await complete_stage(workspace)
    assert first["status"] == "awaiting_handoff" and first["stage_index"] == 0
    assert phone.calls == [] and pc.calls == ["first"] and len(prompts) == 1
    with pytest.raises(ValueError, match="先核对"):
        await workspace.dispatch(
            "advance", {"id": "workflow", "revision": first["revision"]}, actor="os"
        )
    negative = await workspace.dispatch(
        "review_result",
        {"id": "workflow", "revision": first["revision"], "outcome": "not_achieved"},
        actor="os",
    )
    with pytest.raises(ValueError, match="先核对"):
        await workspace.dispatch(
            "advance", {"id": "workflow", "revision": negative["revision"]}, actor="os"
        )
    reviewed = await workspace.dispatch(
        "review_result",
        {"id": "workflow", "revision": negative["revision"], "outcome": "achieved"},
        actor="os",
    )
    request = {"id": "workflow", "revision": reviewed["revision"]}
    with pytest.raises(ValueError, match="已变化"):
        await workspace.dispatch(
            "advance", {"id": "workflow", "revision": first["revision"]}, actor="os"
        )
    await workspace.dispatch("advance", request, actor="os")
    await workspace.running["workflow"]
    restored = TaskWorkspace(coordinator, tmp_path)
    next_stage = await restored.dispatch("advance", request, actor="ai")
    assert next_stage["stage_index"] == 1 and next_stage["device_id"] == "phone"
    assert next_stage["status"] == "awaiting_approval" and next_stage["result_review"] is None
    assert len(next_stage["stage_history"]) == 1
    assert next_stage["stage_history"][0]["result_review"]["outcome"] == "achieved"
    assert "performed" in prompts[1][1] and "当前阶段目标：查看前一步的资料" in prompts[1][1]
    assert len(prompts) == 2 and phone.calls == []
    # Retry the original submit even after the active target changed.
    same = await restored.dispatch("submit", args, actor="phone", source="phone")
    assert same["stage_index"] == 1
    assert len((await restored.dispatch("list", {}, actor="pc", source="pc"))["tasks"]) == 1
    with pytest.raises(PermissionError):
        await restored.dispatch("get", {"id": "workflow"}, actor="stranger", source="stranger")
    final = await complete_stage(restored)
    assert final["status"] == "succeeded" and final["result_review"] is None
    assert pc.calls == ["first"] and phone.calls == ["first"]
    final = await restored.dispatch(
        "review_result",
        {"id": "workflow", "revision": final["revision"], "outcome": "achieved"},
        actor="phone",
        source="phone",
    )
    assert final["result_review"]["reviewed_by"] == "phone"
    await restored.dispatch("remove", {"id": "workflow"}, actor="os")
    assert restored.store.load_all() == [] and not restored.records


@pytest.mark.asyncio
async def test_handoff_offline_restart_and_cancel_preserve_first_stage(tmp_path):
    workspace, phone, pc, coordinator, prompts, args = await staged_setup(tmp_path)
    await workspace.dispatch("submit", args, actor="os")
    await workspace.running["workflow"]
    first = await complete_stage(workspace)
    reviewed = await workspace.dispatch(
        "review_result",
        {"id": "workflow", "revision": first["revision"], "outcome": "achieved"},
        actor="os",
    )
    await phone.disconnect()
    await workspace.dispatch(
        "advance", {"id": "workflow", "revision": reviewed["revision"]}, actor="os"
    )
    await workspace.running["workflow"]
    restored = TaskWorkspace(coordinator, tmp_path)
    paused = restored.view(restored.records["workflow"])
    assert paused["status"] == "interrupted" and paused["stage_index"] == 1
    assert len(paused["stage_history"]) == 1 and len(prompts) == 1
    await phone.connect()
    await restored.dispatch(
        "resume", {"id": "workflow", "revision": paused["revision"]}, actor="ai"
    )
    await restored.running["workflow"]
    cancelled = await restored.dispatch("cancel", {"id": "workflow"}, actor="ai")
    assert cancelled["status"] == "cancelled"
    with pytest.raises(ValueError, match="已取消"):
        await restored.dispatch(
            "advance", {"id": "workflow", "revision": reviewed["revision"]}, actor="ai"
        )
    assert pc.calls == ["first"] and phone.calls == []


@pytest.mark.asyncio
async def test_participant_cannot_approve_other_device_actions_without_exact_grants(tmp_path):
    workspace, phone, pc, coordinator, _, args = await staged_setup(tmp_path)
    await workspace.dispatch("submit", args, actor="os")
    await workspace.running["workflow"]
    view = workspace.view(workspace.records["workflow"])
    coordinator.ws_server.peer_grants = {"phone": {"pc": ["second"]}}
    with pytest.raises(PermissionError, match="所需操作"):
        await workspace.dispatch(
            "approve",
            {"id": "workflow", "revision": view["revision"]},
            actor="phone",
            source="phone",
        )
    assert (
        not pc.calls and workspace._procedure(workspace.records["workflow"]).status.value == "draft"
    )
    procedure = workspace._procedure(workspace.records["workflow"])
    from runtime.tentacle.procedure import ProcedureStatus

    procedure.status = ProcedureStatus.PAUSED
    procedure.in_flight_step = 0
    current = workspace.view(workspace.records["workflow"])
    with pytest.raises(PermissionError, match="所需操作"):
        await workspace.dispatch(
            "resume",
            {"id": "workflow", "revision": current["revision"], "resolution": "completed"},
            actor="phone",
            source="phone",
        )
    assert procedure.in_flight_step == 0 and procedure.current_step == 0 and procedure.results == []
    coordinator.ws_server.peer_grants = {}
    with pytest.raises(PermissionError):
        await workspace.dispatch(
            "submit", {**args, "id": "unauthorized"}, actor="phone", source="phone"
        )


@pytest.mark.asyncio
async def test_cancelled_handoff_cannot_advance_or_leave_orphan_checkpoints(tmp_path):
    workspace, phone, pc, _, _, args = await staged_setup(tmp_path)
    await workspace.dispatch("submit", args, actor="os")
    await workspace.running["workflow"]
    first = await complete_stage(workspace)
    with pytest.raises(ValueError, match="取消剩余"):
        await workspace.dispatch("remove", {"id": "workflow"}, actor="os")
    assert (tmp_path / "task-workflow.json").exists()
    cancelled = await workspace.dispatch("cancel", {"id": "workflow"}, actor="os")
    assert cancelled["status"] == "cancelled"
    with pytest.raises(ValueError, match="已取消"):
        await workspace.dispatch(
            "review_result",
            {"id": "workflow", "revision": first["revision"], "outcome": "achieved"},
            actor="os",
        )
    await workspace.dispatch("remove", {"id": "workflow"}, actor="os")
    assert not workspace.store.load_all()
    assert pc.calls == ["first"] and phone.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "stages", [[], [{}], [{}] * 9, [None, {}], [{"device_id": "pc", "task": ""}] * 2]
)
async def test_invalid_workflow_stages_are_rejected_before_persisting(tmp_path, stages):
    workspace, _, _ = await setup(tmp_path)
    with pytest.raises(ValueError):
        await workspace.dispatch(
            "submit", {"id": "invalid", "task": "test", "stages": stages}, actor="os"
        )
    assert not workspace.records


@pytest.mark.asyncio
async def test_operator_created_workflow_still_checks_approving_phone_grants_on_each_step(tmp_path):
    workspace, phone, pc, coordinator, _, args = await staged_setup(tmp_path)

    async def plan(_task, target):
        return [
            ToolCall("1", target.tentacle_id, "first"),
            ToolCall("2", target.tentacle_id, "second"),
        ]

    coordinator._decision_engine = plan
    pc.gate = asyncio.Event()
    await workspace.dispatch("submit", args, actor="os")
    await workspace.running["workflow"]
    current = workspace.view(workspace.records["workflow"])
    await workspace.dispatch(
        "approve",
        {"id": "workflow", "revision": current["revision"]},
        actor="phone",
        source="phone",
    )
    await started(pc)
    coordinator.ws_server.peer_grants = {}
    pc.gate.set()
    await workspace.running["workflow"]
    final = workspace.view(workspace.records["workflow"])
    assert final["status"] == "failed" and pc.calls == ["first"] and phone.calls == []
