"""Exercise the real observation handler through the image-capable tool bridge."""
import base64
import io
import json
from types import SimpleNamespace

import pytest
from PIL import Image

from runtime.execution.suckers import computer_api_skills as api
from runtime.execution.tool_engine.native_tool_execution import execute_native_tool_call
from runtime.platform.process.session import Session, session_scope
from runtime.safety.approval.approval_gate import ApprovalDecision


@pytest.fixture(autouse=True)
def approved_synthetic_observation():
    provider = SimpleNamespace(request=lambda *args, **kwargs: ApprovalDecision(
        approved=True, reason="single synthetic observation test"))
    with session_scope(Session(actor="test", metadata={
        "permission_mode": "default", "_approval_provider": provider,
    })):
        yield


def setup_capture(monkeypatch, *, capture_ok=True, raw=None):
    buffer = io.BytesIO()
    Image.new("RGB", (120, 60), "blue").save(buffer, format="PNG")
    pixels = buffer.getvalue()
    url = raw if raw is not None else "data:image/png;base64," + base64.b64encode(pixels).decode()
    calls = []

    def call(method, route, body=None):
        calls.append((method, route))
        if route == "/status":
            return {"ok": True, "ready": True}
        assert (method, route, body) == ("POST", "/screenshot", {})
        return {"ok": capture_ok, "data_url": url,
                "path": "C:/private-gateway-cache/not-readable.png", "size_bytes": len(pixels)}

    monkeypatch.setattr(api, "_call", call)
    stack = SimpleNamespace(executor=SimpleNamespace(registry=SimpleNamespace(
        has=lambda _: True, is_enabled=lambda _: True,
        get=lambda _: SimpleNamespace(handler=api._computer_observe),
    )))
    return stack, calls, pixels, url


def test_observation_delivers_original_pixels_without_reading_private_temp_path(monkeypatch):
    stack, calls, pixels, url = setup_capture(monkeypatch)
    images = []
    text, failed = execute_native_tool_call(stack, {"name": "computer_observe"}, image_items=images)
    assert not failed and calls == [("GET", "/status"), ("POST", "/screenshot")]
    assert len(images) == 1
    assert base64.b64decode(images[0]["imageUrl"].partition(",")[2]) == pixels
    assert url not in text and "_mcp_images" not in text
    observation = json.loads(text)["visual_observation"]
    assert observation["attached"] and observation["review_status"] == "unreviewed"
    assert observation["images"][0]["original_width"] == 120


def test_text_only_execution_never_prints_pixels_or_claims_delivery(monkeypatch):
    stack, _, _, url = setup_capture(monkeypatch)
    text, failed = execute_native_tool_call(stack, {"name": "computer_observe"})
    assert not failed and url not in text and "_mcp_images" not in text
    assert json.loads(text)["visual_observation"]["attached"] is False


def test_capture_failure_does_not_forward_pixels(monkeypatch):
    stack, _, _, url = setup_capture(monkeypatch, capture_ok=False)
    images = []
    text, failed = execute_native_tool_call(stack, {"name": "computer_observe"}, image_items=images)
    assert failed and images == [] and url not in text


@pytest.mark.parametrize("raw", ["https://example.invalid/private.png", "data:text/html;base64,YQ=="])
def test_unrecognized_media_is_not_forwarded_or_fetched(monkeypatch, raw):
    setup_capture(monkeypatch, raw=raw)
    result = api._computer_observe()
    assert "_mcp_images" not in result and raw not in json.dumps(result)


def test_oversized_inline_capture_is_not_retained(monkeypatch):
    from runtime.execution.tool_engine import tool_images

    monkeypatch.setattr(tool_images, "MAX_SOURCE_BYTES", 4)
    setup_capture(monkeypatch, raw="data:image/png;base64," + "A" * 1000)
    assert "_mcp_images" not in api._computer_observe()


def test_status_only_observation_does_not_capture(monkeypatch):
    _, calls, _, _ = setup_capture(monkeypatch)
    result = api._computer_observe(capture=False)
    assert calls == [("GET", "/status")]
    assert "_mcp_images" not in result and "screenshot" not in result
