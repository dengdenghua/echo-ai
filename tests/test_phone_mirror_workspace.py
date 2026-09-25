"""AI's authenticated HTTP UI bridge reaches the registered device socket."""

import json
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth import Identity, IdentityStore
from runtime.tentacle.coordinator import TentacleCoordinator
from runtime.tentacle.dashboard import create_tentacle_router


def test_workspace_mirror_uses_registered_device_and_session():
    coordinator = TentacleCoordinator(
        host="127.0.0.1", port=0, dashboard_port=None, auth_token="device-test-secret"
    )
    identities = IdentityStore()
    identities.add(Identity(actor_id="operator"), api_key_plaintext="operator-test-secret")
    app = FastAPI()
    app.include_router(create_tentacle_router(coordinator, identity_store=identities))
    headers = {"Authorization": "Bearer operator-test-secret"}
    endpoint = "/api/tentacle/devices/phone-one/mirror/files"
    with TestClient(app) as client:
        assert client.post(endpoint, json={}).status_code == 401
        assert client.post(endpoint, headers=headers, json={}).status_code == 409
        with client.websocket_connect("/api/tentacle/device/ws") as phone:
            phone.send_json(
                {
                    "id": "hello",
                    "method": "device/hello",
                    "params": {
                        "tentacle_id": "phone-one",
                        "auth_token": "device-test-secret",
                        "platform": "android",
                        "capabilities": ["android.exchange_files"],
                    },
                }
            )
            assert phone.receive_json()["result"]["registered"]
            inventory = client.get("/api/tentacle/devices", headers=headers).json()
            assert inventory[0]["tentacle_id"] == "phone-one"
            assert inventory[0]["is_online"]
            with ThreadPoolExecutor() as executor:
                response = executor.submit(
                    client.post,
                    endpoint,
                    headers=headers,
                    json={"operation": "read", "name": "bytes.bin", "offset": 0},
                )
                request = phone.receive_json()
                assert request["params"]["tentacle_id"] == "phone-one"
                assert request["params"]["tool"] == "android.exchange_files"
                phone.send_json(
                    {
                        "method": "tool/result",
                        "params": {
                            "call_id": request["id"],
                            "success": True,
                            "data": json.dumps({"data": "AP8CAA=="}),
                        },
                    }
                )
                result = response.result(timeout=5)
                assert result.status_code == 200
                assert result.json() == {"data": "AP8CAA=="}
        assert client.post(endpoint, headers=headers, json={}).status_code == 409
