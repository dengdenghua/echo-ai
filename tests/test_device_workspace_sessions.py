import asyncio
import base64
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth import Identity, IdentityStore
from runtime.tentacle.coordinator import TentacleCoordinator
from runtime.tentacle.dashboard import create_tentacle_router
from runtime.tentacle.discovery import DeviceDiscovery
from runtime.tentacle.mobile.screen_relay import decode_frame_header
from runtime.tentacle.transfer_journal import TransferJournal


def register(phone, name):
    phone.send_json({"id": "hello", "method": "device/hello", "params": {
        "tentacle_id": name, "auth_token": "test-device", "platform": "android",
        "capabilities": ["android.mirror_frame"],
    }})
    assert phone.receive_json()["result"]["registered"]


def test_cast_only_reaches_selected_subscriber_and_stops_when_receiver_leaves():
    coordinator = TentacleCoordinator(host="127.0.0.1", port=0, dashboard_port=None, auth_token="test-device")
    store = IdentityStore()
    store.add(Identity(actor_id="operator"), api_key_plaintext="test-operator")
    app = FastAPI()
    app.include_router(create_tentacle_router(coordinator, identity_store=store))
    headers = {"Authorization": "Bearer test-operator"}
    endpoint = "/api/tentacle/devices/phone-a/mirror/cast"
    with TestClient(app) as client, client.websocket_connect("/api/tentacle/device/ws") as first, client.websocket_connect("/api/tentacle/device/ws") as second:
        register(first, "phone-a")
        register(second, "phone-b")
        assert client.post(endpoint, json={"operation": "start"}).status_code == 401
        assert client.post(endpoint, headers=headers, json={"operation": "start"}).status_code == 409
        for phone in [first, second]:
            phone.send_json({"id": "sub", "method": "pc_screen/subscribe", "params": {"formats": ["jpeg"]}})
            assert phone.receive_json()["result"]["subscribed"]
        session = client.post(endpoint, headers=headers, json={"operation": "start"}).json()["sessionId"]
        assert client.post(endpoint, headers=headers, json={"operation": "start"}).status_code == 409
        jpeg = b"\xff\xd8test\xff\xd9"  # transport fixture, no image-decoding claim
        args = {"operation": "frame", "sessionId": session, "jpeg": base64.b64encode(jpeg).decode()}
        assert client.post(endpoint, headers=headers, json={**args, "sessionId": "wrong"}).status_code == 409
        assert client.post(endpoint, headers=headers, json=args).json() == {"delivered": True}
        frame = first.receive_bytes()
        source, _, _, offset = decode_frame_header(frame)
        assert source == "pc-host" and frame[offset:] == jpeg
        # If pixels were broadcast, the second client's next message would be binary.
        second.send_json({"id": "unsub", "method": "pc_screen/unsubscribe", "params": {}})
        assert second.receive_json()["result"]["unsubscribed"]
        first.send_json({"id": "unsub", "method": "pc_screen/unsubscribe", "params": {}})
        assert first.receive_json()["result"]["unsubscribed"]
        assert client.post(endpoint, headers=headers, json=args).status_code == 409


@pytest.mark.asyncio
async def test_real_udp_discovery_uses_source_address_and_never_imports_credentials():
    discovery = DeviceDiscovery()
    await discovery.start("127.0.0.1", 0)
    assert discovery.transport
    port = discovery.transport.get_extra_info("sockname")[1]
    sender, _ = await asyncio.get_running_loop().create_datagram_endpoint(asyncio.DatagramProtocol, remote_addr=("127.0.0.1", port))
    try:
        sender.sendto(json.dumps({"type": "octopus-beacon", "deviceId": "phone", "deviceName": "Pixel", "ip": "10.0.0.99", "authToken": "never-store"}).encode())
        async with asyncio.timeout(2):
            while not discovery.devices:
                await asyncio.sleep(0.01)
        assert discovery.snapshot()["devices"] == [{"id": "phone", "name": "Pixel", "platform": "android", "address": "127.0.0.1"}]
        discovery.devices["phone"]["seen"] -= 21
        assert discovery.snapshot()["devices"] == []
    finally:
        sender.close()
        discovery.stop()


def test_transfer_receipts_require_all_acknowledged_bytes_before_completion():
    journal = TransferJournal()
    journal.observe("phone", "transfer-1", {"operation": "begin", "name": "a.bin", "size": 4}, {"offset": 0})
    assert not journal.report("phone", "transfer-1", "done")
    journal.observe("phone", "transfer-1", {"operation": "chunk"}, {"offset": 4})
    journal.observe("phone", "transfer-1", {"operation": "complete"}, {"name": "a.bin", "size": 4})
    assert journal.snapshot()[0]["state"] == "done"
    assert not journal.report("another-phone", "transfer-1", "done")
