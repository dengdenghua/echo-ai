from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from runtime.execution.engines import EngineId, ExecutionPhase, ExecutionRoute
from runtime.execution.node_control import ExecutionNodeControl
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.sensing.gateway import realtime_execution
from runtime.sensing.gateway.realtime_execution_node import (
    NODE_LOCATION_REASON,
    drive_execution_node,
    node_work_location,
)
from runtime.workspace import WorkspaceStore


def test_work_location_parsing() -> None:
    assert node_work_location(None) is None
    assert node_work_location({"work_location": {"kind": "local"}}) is None
    assert node_work_location(
        {"work_location": {"kind": "node", "node_id": "nas", "workspace_id": "ws", "role": "coder"}}
    ) == {"node_id": "nas", "workspace_id": "ws", "role": "coder"}
    with pytest.raises(ValueError, match="节点"):
        node_work_location({"work_location": {"kind": "node", "node_id": "nas"}})


def test_node_route_keeps_every_phase_on_the_dispatch_driver() -> None:
    route = ExecutionRoute(EngineId.ECHO, "execution_node", NODE_LOCATION_REASON)
    for phase in ExecutionPhase:
        assert route.driver_for(phase) == "execution_node"


def test_turn_with_node_location_selects_the_node_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    async def no_connections(*_args: Any) -> None:
        return None

    monkeypatch.setattr(
        "runtime.sensing.gateway.realtime_preparation.require_role_connections", no_connections
    )
    intent = SimpleNamespace(
        user_context={
            "work_location": {
                "kind": "node",
                "node_id": "nas",
                "workspace_id": "ws",
                "role": "coder",
            }
        }
    )
    route = asyncio.run(
        realtime_execution.select_turn_execution(
            SimpleNamespace(),
            SimpleNamespace(params=SimpleNamespace(execution_engine="auto")),
            None,
            intent,  # type: ignore[arg-type]
            project_command=False,
            group_fanout=False,
            topology_id=None,
            codex_partner=False,
            reflection_fast_path=False,
        )
    )
    assert (route.driver, route.reason) == ("execution_node", NODE_LOCATION_REASON)


class _Runtime:
    def __init__(self, store: CollaborationStore) -> None:
        self._collaboration_store = store
        self.messages: list[tuple[str, str]] = []
        self.steering: list[bool] = []

    async def _emit_item_started(self, _turn, _log, _emitter, item) -> None:
        self.messages.append(("commentary", item.text))

    async def _emit_item_completed(self, *_args) -> None:
        return None

    async def _emit_agent_message(self, _turn, _log, _emitter, text: str) -> None:
        self.messages.append(("answer", text))

    def _set_turn_steering_accepting(self, _turn, accepting: bool) -> None:
        self.steering.append(accepting)


class _Emitter:
    def __init__(self) -> None:
        self.interrupted = False

    def is_turn_interrupted(self, _turn_id: str) -> bool:
        return self.interrupted


@pytest.fixture
def node_setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    spaces = WorkspaceStore(tmp_path / "spaces.db")
    project = tmp_path / "project"
    project.mkdir()
    (project / "notes.md").write_text("draft", encoding="utf-8")
    ws = spaces.create_workspace(
        name="Project",
        mount_type="local",
        mount_target=str(project),
        mount_options={},
        owner_id="local",
        tenant_id="local",
    )
    monkeypatch.setattr("runtime.workspace.WorkspaceStore", lambda *a, **k: spaces)
    monkeypatch.setattr("runtime.sensing.gateway.realtime_execution_node._POLL_INTERVAL_S", 0.01)
    store = CollaborationStore(tmp_path / "ledger")
    control = ExecutionNodeControl(store)
    control.advertise(
        node_id="nas",
        tenant_id="local",
        actor_id="local",
        label="书房 NAS",
        workspaces=[ws.id],
        roles=["coder"],
    )
    turn = SimpleNamespace(
        id="turn-1", params=SimpleNamespace(tenant_id=None, owner_actor_id=None), items=[]
    )
    intent = SimpleNamespace(
        user_context={
            "work_location": {
                "kind": "node",
                "node_id": "nas",
                "workspace_id": ws.id,
                "role": "coder",
            }
        }
    )
    return store, control, turn, intent


async def _complete_like_a_worker(store: CollaborationStore, control: ExecutionNodeControl) -> None:
    while not control.runs(tenant_id="local"):
        await asyncio.sleep(0.01)
    run = control.runs(tenant_id="local")[0]
    node = control.verify_node("nas", "local", "local")
    claimed = control.claim(run["run_id"], node=node, instance_id="worker-1")
    await asyncio.sleep(0.05)
    store.transition_collaboration_run(
        run["run_id"],
        status="completed",
        result={"output": "已整理好笔记", "artifacts": [{"path": "notes.md"}]},
        error="",
        worker_id="nas:worker-1",
        expected_attempt=claimed["attempt"],
    )


def test_driver_relays_progress_and_the_nodes_answer(node_setup) -> None:
    store, control, turn, intent = node_setup
    runtime, emitter = _Runtime(store), _Emitter()

    async def scenario() -> None:
        await asyncio.gather(
            drive_execution_node(runtime, turn, None, emitter, intent, text="整理笔记"),
            _complete_like_a_worker(store, control),
        )

    asyncio.run(scenario())

    assert runtime.steering == [False]
    kinds = [kind for kind, _ in runtime.messages]
    assert kinds[0] == "commentary" and "书房 NAS" in runtime.messages[0][1]
    assert kinds[-1] == "answer"
    answer = runtime.messages[-1][1]
    assert answer.startswith("已整理好笔记") and "`notes.md`" in answer
    run = control.runs(tenant_id="local")[0]
    assert run["input"]["goal"] == "整理笔记" and run["input"]["node_ids"] == ["nas"]


def test_interrupt_cancels_the_node_task(node_setup) -> None:
    store, control, turn, intent = node_setup
    runtime, emitter = _Runtime(store), _Emitter()

    async def scenario() -> None:
        task = asyncio.create_task(
            drive_execution_node(runtime, turn, None, emitter, intent, text="整理笔记")
        )
        while not control.runs(tenant_id="local"):
            await asyncio.sleep(0.01)
        emitter.interrupted = True
        await task

    asyncio.run(scenario())

    assert control.runs(tenant_id="local")[0]["status"] == "cancelled"
    assert not any(kind == "answer" for kind, _ in runtime.messages)


def test_unknown_node_fails_before_submitting(node_setup) -> None:
    store, control, turn, intent = node_setup
    intent.user_context["work_location"]["node_id"] = "gone"
    with pytest.raises(RuntimeError, match="找不到这个执行节点"):
        asyncio.run(drive_execution_node(_Runtime(store), turn, None, _Emitter(), intent, text="x"))
    assert control.runs(tenant_id="local") == []


def test_authenticated_caller_needs_write_access_to_the_workspace(node_setup) -> None:
    store, control, turn, intent = node_setup
    # The node belongs to tenant "local"; an authenticated stranger in that
    # tenant who is not a workspace member must not snapshot it.
    turn.params = SimpleNamespace(tenant_id="local", owner_actor_id="stranger")
    with pytest.raises(RuntimeError, match="没有写入权限"):
        asyncio.run(drive_execution_node(_Runtime(store), turn, None, _Emitter(), intent, text="x"))
    assert control.runs(tenant_id="local") == []


def test_node_failure_reason_drops_repeated_exception_names(node_setup) -> None:
    store, control, turn, intent = node_setup

    async def fail_like_a_worker() -> None:
        while not control.runs(tenant_id="local"):
            await asyncio.sleep(0.01)
        run = control.runs(tenant_id="local")[0]
        node = control.verify_node("nas", "local", "local")
        claimed = control.claim(run["run_id"], node=node, instance_id="worker-1")
        store.transition_collaboration_run(
            run["run_id"],
            status="failed",
            error="RuntimeError: RuntimeError: planner error",
            worker_id="nas:worker-1",
            expected_attempt=claimed["attempt"],
        )

    async def scenario() -> None:
        await asyncio.gather(
            drive_execution_node(_Runtime(store), turn, None, _Emitter(), intent, text="x"),
            fail_like_a_worker(),
        )

    with pytest.raises(RuntimeError, match=r"未完成：planner error$"):
        asyncio.run(scenario())
