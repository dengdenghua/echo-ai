"""Production WebSocket client, actual temporary files and durable task receipts.

Both endpoints run on loopback on this host. This is not Android/ARM, an LLM
planner, an HTTP-operator acceptance test, or a physical-device acceptance.
"""

import asyncio
import contextlib
import hashlib

import pytest

from runtime.tentacle.base import ToolCall
from runtime.tentacle.coordinator import TentacleCoordinator
from runtime.tentacle.device_client import DesktopTools, DeviceClient
from runtime.tentacle.task_workspace import TaskWorkspace


@pytest.mark.asyncio
async def test_live_device_file_task_is_approved_verified_and_restored_without_replay(tmp_path):
    device_root = tmp_path / "device-files"
    device_root.mkdir()
    contents = "跨端任务\nverified on disk\n"
    plans = []

    async def plan(text, target):
        plans.append(text)
        return [
            ToolCall(
                "write",
                target.tentacle_id,
                "workspace.write_text",
                {"path": "result.txt", "text": contents},
            ),
            ToolCall("read", target.tentacle_id, "workspace.read_text", {"path": "result.txt"}),
        ]

    coordinator = TentacleCoordinator(
        host="127.0.0.1",
        port=0,
        dashboard_port=None,
        auth_token="isolated-loopback-test",
        decision_engine=plan,
    )
    await coordinator.ws_server.start()
    port = coordinator.ws_server._server.sockets[0].getsockname()[1]
    client = DeviceClient(
        url=f"ws://127.0.0.1:{port}",
        token="isolated-loopback-test",
        device_id="local-test-device",
        tools=DesktopTools(workspace=device_root),
        device_kind="unknown",
    )
    peer = asyncio.create_task(client.run_once())
    workspace = TaskWorkspace(coordinator, tmp_path / "task-state")
    try:
        await asyncio.wait_for(client.ready.wait(), timeout=5)
        request = {
            "id": "stable-file-task",
            "device_id": "local-test-device",
            "task": "create and verify a file",
        }
        await workspace.dispatch("submit", request, actor="test-operator")
        await asyncio.wait_for(workspace.running[request["id"]], timeout=5)
        task = await workspace.dispatch("get", {"id": request["id"]}, actor="test-operator")
        assert task["status"] == "awaiting_approval"
        assert not (device_root / "result.txt").exists()
        with pytest.raises(ValueError):
            await workspace.dispatch(
                "approve", {"id": task["id"], "revision": "stale"}, actor="test-operator"
            )
        assert not (device_root / "result.txt").exists()
        await workspace.dispatch(
            "approve", {"id": task["id"], "revision": task["revision"]}, actor="test-operator"
        )
        await asyncio.wait_for(workspace.running[task["id"]], timeout=5)
        completed = await workspace.dispatch("get", {"id": task["id"]}, actor="test-operator")
        assert completed["status"] == "succeeded"
        actual = (device_root / "result.txt").read_bytes()
        assert actual == contents.encode("utf-8")
        assert (
            hashlib.sha256(actual).hexdigest()
            == hashlib.sha256(contents.encode("utf-8")).hexdigest()
        )
        assert completed["current_step"] == 2
        assert len(completed["results"]) == 2
        assert completed["result_review"] is None
        await workspace.dispatch("submit", request, actor="test-operator")
        assert len(plans) == 1
        await workspace.shutdown()
        restored = TaskWorkspace(coordinator, tmp_path / "task-state")
        try:
            saved = await restored.dispatch("get", {"id": task["id"]}, actor="test-operator")
            assert saved["status"] == "succeeded"
            assert saved["results"] == completed["results"]
            assert saved["revision"] == completed["revision"]
            reviewed = await restored.dispatch(
                "review_result",
                {
                    "id": saved["id"],
                    "revision": saved["revision"],
                    "outcome": "achieved",
                },
                actor="test-operator",
            )
            assert reviewed["result_review"]["outcome"] == "achieved"
            assert len(plans) == 1
            assert list(device_root.iterdir()) == [device_root / "result.txt"]
        finally:
            await restored.shutdown()
    finally:
        await workspace.shutdown()
        peer.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await peer
        await coordinator.ws_server.stop()
