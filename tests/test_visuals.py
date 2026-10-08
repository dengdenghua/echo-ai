from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.suckers.registry import SkillRegistry
from runtime.execution.suckers.visual_skills import (
    _guidelines,
    _show_visual,
    register_visual_skills,
)
from runtime.execution.tool_spec_builder import build_anthropic_tool_specs
from runtime.platform import visuals
from runtime.safety.auth.scope import TenantScope
from runtime.sensing.gateway.visuals_router import create_visuals_router


@pytest.fixture(autouse=True)
def clean_receipts():
    visuals._RECEIPTS.clear()
    yield
    visuals._RECEIPTS.clear()


def test_receipt_requires_owner_token_and_thread():
    owner = TenantScope("tenant-a", "alice")
    receipt = visuals.create_visual(owner, "task-a")
    visual_id, token = receipt["visual_id"], receipt["receipt_token"]
    assert visuals.visual_status(visual_id, owner, "task-a")["status"] == "pending"
    for other in (None, TenantScope("tenant-b", "alice"), TenantScope("tenant-a", "bob")):
        assert not visuals.report_visual(visual_id, token, other, "rendered")
        assert visuals.visual_status(visual_id, other, "task-a")["status"] == "unknown"
    assert not visuals.report_visual(visual_id, "wrong", owner, "rendered")
    assert visuals.visual_status(visual_id, owner, "task-b")["status"] == "unknown"
    assert visuals.report_visual(visual_id, token, owner, "rendered")
    assert visuals.report_visual(visual_id, token, owner, "error", "script failed")
    assert visuals.report_visual(visual_id, token, owner, "rendered")
    assert visuals.visual_status(visual_id, owner, "task-a")["status"] == "error"
    assert "token" not in visuals.visual_status(visual_id, owner, "task-a")


def test_receipts_bounded_and_expired(monkeypatch):
    monkeypatch.setattr(visuals, "MAX_RECEIPTS", 2)
    now = [100.0]
    monkeypatch.setattr(visuals.time, "monotonic", lambda: now[0])
    first = visuals.create_visual(None, "task")
    visuals.create_visual(None, "task")
    last = visuals.create_visual(None, "task")
    assert len(visuals._RECEIPTS) == 2
    assert visuals.visual_status(first["visual_id"], None, "task")["status"] == "unknown"
    now[0] += visuals.RECEIPT_TTL + 1
    assert visuals.visual_status(last["visual_id"], None, "task")["status"] == "unknown"


@pytest.mark.parametrize(
    "args",
    [
        {"title": "x", "code": "x", "format": "png"},
        {"title": "x", "code": "x" * 100001, "format": "html"},
        {"title": "x", "code": "```html\n<p>x</p>\n```", "format": "html"},
        {"title": "", "code": "<svg/>"},
        {"title": "x", "code": "<p>x</p>", "format": "svg"},
    ],
)
def test_invalid_payload_creates_no_receipt(args):
    assert not _show_visual(**args)["ok"]
    assert not visuals._RECEIPTS


def test_valid_payload_pending_and_guidance_on_demand():
    receipt = _show_visual("Example", "<svg><text>Example</text></svg>")
    assert receipt["status"] == "pending"
    assert "code" not in receipt
    assert _guidelines("interactive")["ok"]
    assert not _guidelines("unknown")["ok"]


def test_visual_tool_schemas_remain_available():
    registry = SkillRegistry()
    assert register_visual_skills(registry) == 3
    specs = build_anthropic_tool_specs(registry)
    show = next(spec for spec in specs if spec.name == "show_visual")
    assert {"title", "code", "format"} <= set(show.input_schema["properties"])


def test_http_receipt_auth_and_invalid_tokens():
    app = FastAPI()
    app.include_router(create_visuals_router())
    client = TestClient(app)
    receipt = visuals.create_visual(None, "task")
    url = f"/api/visuals/{receipt['visual_id']}/receipt"
    body = {"receipt_token": receipt["receipt_token"], "status": "rendered"}
    assert client.post(url, json={**body, "receipt_token": "x" * 32}).status_code == 404
    assert client.post(url, json={**body, "status": "success"}).status_code == 422
    response = client.post(url, json=body)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    protected = FastAPI()
    protected.include_router(create_visuals_router(require_auth=True))
    assert TestClient(protected).post(url, json=body).status_code in {401, 403}
