"""``POST /api/codex/prewarm`` warms the caller's next Codex chat reply."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth.scope import TenantScope
from runtime.sensing.gateway import _config_endpoints_codex_prewarm as endpoint
from runtime.sensing.gateway.config_router import create_config_router

_AGENT = SimpleNamespace(agent_id="eve", capabilities={})


def _client(tmp_path, *, agent: Any = _AGENT) -> TestClient:
    bundle = create_config_router(
        stack=SimpleNamespace(planner=None), custom_models_path=tmp_path / "models.json"
    )
    app = FastAPI()
    app.include_router(bundle.router)
    app.state.realtime_gateway = SimpleNamespace(_runtime=SimpleNamespace(_default_agent=agent))
    return TestClient(app)


def test_prewarm_runs_as_the_caller_with_the_realtime_default_agent(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[Any, Any]] = []

    async def prewarm(stack: Any, agent: Any, *, trusted_session: Any) -> bool:
        calls.append((agent, trusted_session))
        return True

    monkeypatch.setattr(endpoint, "prewarm_codex_chat", prewarm)
    monkeypatch.setattr(
        endpoint, "scope_from_request", lambda _request: TenantScope("tenant-a", "alice")
    )
    with _client(tmp_path) as client:
        response = client.post("/api/codex/prewarm")

    assert response.status_code == 200 and response.json() == {"warm": True}
    agent, session = calls[0]
    assert agent is _AGENT
    assert session.actor == "alice" and session.metadata == {"tenant_id": "tenant-a"}


def test_a_scope_without_a_tenant_matches_the_gateways_legacy_tenant(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sessions: list[Any] = []

    async def prewarm(stack: Any, agent: Any, *, trusted_session: Any) -> bool:
        sessions.append(trusted_session)
        return True

    monkeypatch.setattr(endpoint, "prewarm_codex_chat", prewarm)
    monkeypatch.setattr(endpoint, "scope_from_request", lambda _request: TenantScope("", "bob"))
    with _client(tmp_path) as client:
        client.post("/api/codex/prewarm")

    assert sessions[0].metadata == {"tenant_id": "legacy:bob"}


def test_prewarm_failures_answer_not_warm(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken(*_args: Any, **_kwargs: Any) -> bool:
        raise RuntimeError("Codex account credentials are unavailable")

    monkeypatch.setattr(endpoint, "prewarm_codex_chat", broken)
    with _client(tmp_path) as client:
        assert client.post("/api/codex/prewarm").json() == {"warm": False}
    with _client(tmp_path, agent=None) as client:
        assert client.post("/api/codex/prewarm").json() == {"warm": False}
