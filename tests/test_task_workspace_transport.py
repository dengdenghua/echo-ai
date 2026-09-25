import json
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth import Identity, IdentityStore
from runtime.tentacle.base import ToolCall
from runtime.tentacle.coordinator import TentacleCoordinator
from runtime.tentacle.dashboard import create_tentacle_router


def test_paired_phone_task_is_approved_over_http_executed_on_pc_and_read_after_reconnect(tmp_path):
    async def plan(_text, device):
        return [ToolCall("planned", device.tentacle_id, "desktop.echo", {"text": "hello"})]

    coordinator = TentacleCoordinator(
        host="127.0.0.1",
        port=0,
        dashboard_port=None,
        auth_token="device-test",
        decision_engine=plan,
    )
    coordinator.task_workspace_path = tmp_path
    coordinator.ws_server.peer_grants = {"phone": {"pc": ["desktop.echo"]}}
    identities = IdentityStore()
    identities.add(Identity(actor_id="operator"), api_key_plaintext="operator-test")
    app = FastAPI()
    app.include_router(create_tentacle_router(coordinator, identity_store=identities))
    headers = {"Authorization": "Bearer operator-test"}

    def hello(socket, device, platform, capabilities):
        socket.send_json(
            {
                "id": "hello",
                "method": "device/hello",
                "params": {
                    "tentacle_id": device,
                    "platform": platform,
                    "auth_token": "device-test",
                    "capabilities": capabilities,
                },
            }
        )
        assert socket.receive_json()["result"]["registered"]

    def poll(client, status):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            tasks = client.post(
                "/api/tentacle/task-workspace/list", headers=headers, json={}
            ).json()["tasks"]
            if tasks and tasks[0]["status"] == status:
                return tasks[0]
            time.sleep(0.01)
        raise AssertionError(tasks)

    with TestClient(app) as client:
        assert client.post("/api/tentacle/task-workspace/list", json={}).status_code == 401
        with (
            client.websocket_connect("/api/tentacle/device/ws") as phone,
            client.websocket_connect("/api/tentacle/device/ws") as pc,
        ):
            hello(phone, "phone", "android", [])
            hello(pc, "pc", "windows", ["desktop.echo"])
            phone.send_json(
                {
                    "id": "request",
                    "method": "task/workspace/submit",
                    "params": {
                        "id": "across-devices",
                        "device_id": "pc",
                        "task": "打个招呼",
                    },
                }
            )
            assert phone.receive_json()["result"]["source_device"] == "phone"
            task = poll(client, "awaiting_approval")
            response = client.post(
                "/api/tentacle/task-workspace/approve",
                headers=headers,
                json={"id": task["id"], "revision": task["revision"]},
            )
            assert response.status_code == 200
            call = pc.receive_json()
            assert call["method"] == "tool/execute"
            assert call["params"]["tool"] == "desktop.echo"
            pc.send_json(
                {
                    "method": "tool/result",
                    "params": {
                        "call_id": call["id"],
                        "success": True,
                        "data": json.dumps({"text": "hello"}),
                    },
                }
            )
            task = poll(client, "succeeded")
            assert task["current_step"] == 1
            assert task["approved_by"] == "operator"
        with client.websocket_connect("/api/tentacle/device/ws") as reconnected:
            hello(reconnected, "phone", "android", [])
            reconnected.send_json({"id": "later", "method": "task/workspace/list", "params": {}})
            restored = reconnected.receive_json()["result"]["tasks"][0]
            assert restored["id"] == task["id"] and restored["status"] == "succeeded"
