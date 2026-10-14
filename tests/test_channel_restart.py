from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.sensing.gateway.channels_router import LocalChannelManager, create_channels_router


@pytest.mark.parametrize("target", ["discord-main", "discord"])
def test_restart_configured_transport_by_id_or_platform(tmp_path, target):
    calls = []
    manager = LocalChannelManager()
    manager.register(
        SimpleNamespace(
            channel_id="discord-main",
            stop=lambda: calls.append("stop"),
            start=lambda: calls.append("start"),
        )
    )
    app = FastAPI()
    app.include_router(create_channels_router(manager=manager, state_path=tmp_path / "state.json"))
    response = TestClient(app).post(f"/api/channels/{target}/restart")
    assert response.status_code == 200
    assert response.json()["restarted"] == ["discord-main"]
    assert calls == ["stop", "start"]


def test_restart_missing_transport_does_not_report_success(tmp_path):
    app = FastAPI()
    app.include_router(create_channels_router(state_path=tmp_path / "state.json"))
    assert TestClient(app).post("/api/channels/discord/restart").status_code == 404
