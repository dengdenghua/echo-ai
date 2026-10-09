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
    identities.add(
        Identity(actor_id="operator", roles=("operator",)), api_key_plaintext="operator-test"
    )
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
            assert restored["result_review"] is None
            reconnected.send_json(
                {
                    "id": "review",
                    "method": "task/workspace/review_result",
                    "params": {
                        "id": restored["id"],
                        "revision": restored["revision"],
                        "outcome": "achieved",
                        "reviewed_by": "forged-operator",
                    },
                }
            )
            reviewed = reconnected.receive_json()["result"]
            assert reviewed["result_review"]["reviewed_by"] == "device:phone"
            shared = client.post(
                "/api/tentacle/task-workspace/get", headers=headers, json={"id": restored["id"]}
            ).json()
            assert shared["result_review"] == reviewed["result_review"]
            stale = client.post(
                "/api/tentacle/task-workspace/review_result",
                headers=headers,
                json={
                    "id": restored["id"],
                    "revision": restored["revision"],
                    "outcome": "not_achieved",
                },
            )
            assert stale.status_code == 409


def test_parent_task_handoff_uses_two_paired_devices_and_keeps_history_on_reconnect(tmp_path):
    prompts = []

    async def plan(text, device):
        prompts.append(text)
        tool = "desktop.echo" if device.tentacle_id == "pc" else "android.echo"
        return [ToolCall("planned", device.tentacle_id, tool, {"text": "stage"})]

    coordinator = TentacleCoordinator(
        host="127.0.0.1", port=0, dashboard_port=None, auth_token="test-pair", decision_engine=plan
    )
    coordinator.task_workspace_path = tmp_path
    coordinator.ws_server.peer_grants = {"phone": {"pc": ["desktop.echo"]}}
    identities = IdentityStore()
    identities.add(
        Identity(actor_id="operator", roles=("operator",)), api_key_plaintext="operator-test"
    )
    app = FastAPI()
    app.include_router(create_tentacle_router(coordinator, identity_store=identities))
    headers = {"Authorization": "Bearer operator-test"}

    def hello(socket, name, tool):
        socket.send_json(
            {
                "id": "hello",
                "method": "device/hello",
                "params": {
                    "tentacle_id": name,
                    "platform": "android" if name == "phone" else "windows",
                    "auth_token": "test-pair",
                    "capabilities": [tool],
                },
            }
        )
        assert socket.receive_json()["result"]["registered"]

    def invoke(client, command, view, **args):
        response = client.post(
            f"/api/tentacle/task-workspace/{command}",
            headers=headers,
            json={"id": "parent", "revision": view["revision"], **args},
        )
        assert response.status_code == 200, response.text
        return response.json()

    def poll(client, status):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            view = client.post(
                "/api/tentacle/task-workspace/get", headers=headers, json={"id": "parent"}
            ).json()
            if view["status"] == status and not view["busy"]:
                return view
            time.sleep(0.01)
        raise AssertionError(view)

    def reply(socket, expected_tool, evidence):
        call = socket.receive_json()
        assert call["params"]["tool"] == expected_tool
        socket.send_json(
            {
                "method": "tool/result",
                "params": {
                    "call_id": call["id"],
                    "success": True,
                    "data": json.dumps({"evidence": evidence}),
                },
            }
        )

    with TestClient(app) as client:
        with (
            client.websocket_connect("/api/tentacle/device/ws") as phone,
            client.websocket_connect("/api/tentacle/device/ws") as pc,
        ):
            hello(phone, "phone", "android.echo")
            hello(pc, "pc", "desktop.echo")
            phone.send_json(
                {
                    "id": "submit",
                    "method": "task/workspace/submit",
                    "params": {
                        "id": "parent",
                        "task": "协作" * 1800,
                        "stages": [
                            {"device_id": "pc", "task": "先处理"},
                            {"device_id": "phone", "task": "后查看"},
                        ],
                    },
                }
            )
            assert phone.receive_json()["result"]["source_device"] == "phone"
            assert (
                client.post(
                    "/api/tentacle/task-workspace/submit",
                    headers=headers,
                    json={"id": "oversized", "task": "x" * 65000},
                ).status_code
                == 413
            )
            first = poll(client, "awaiting_approval")
            invoke(client, "approve", first)
            reply(pc, "desktop.echo", "pc-receipt")
            first = poll(client, "awaiting_handoff")
            first = invoke(client, "review_result", first, outcome="achieved")
            invoke(client, "advance", first)
            second = poll(client, "awaiting_approval")
            assert second["stage_index"] == 1 and "pc-receipt" in prompts[1]
            invoke(client, "approve", second)
            reply(phone, "android.echo", "phone-receipt")
            final = poll(client, "succeeded")
            assert final["result_review"] is None
        with client.websocket_connect("/api/tentacle/device/ws") as phone:
            hello(phone, "phone", "android.echo")
            phone.send_json(
                {"id": "read", "method": "task/workspace/get", "params": {"id": "parent"}}
            )
            restored = phone.receive_json()["result"]
            assert restored["stage_index"] == 1 and len(restored["stage_history"]) == 1
            assert "pc-receipt" in restored["stage_history"][0]["results"][0]["summary"]
            assert "phone-receipt" in restored["results"][0]["summary"]
