"""Screenshot observations preserve media without expanding file permissions."""

import base64
import io
import json
from types import SimpleNamespace

import pytest
from PIL import Image

from runtime.execution.tool_engine.host_tool_broker import validate_dynamic_tool_response
from runtime.execution.tool_engine.native_tool_execution import execute_native_tool_call
from runtime.execution.tool_engine.tool_images import (
    MAX_IMAGE_URL_CHARS,
    screenshot_observation,
)
from runtime.platform.process.session import Session, session_scope


def png_bytes(size=(2400, 1200)):
    buffer = io.BytesIO()
    Image.effect_noise(size, 50).convert("RGB").save(buffer, format="PNG")
    return buffer.getvalue()


def test_large_inline_screenshot_is_decodable_and_not_text_truncated():
    data = png_bytes()
    original = {"ok": True, "dataUrl": "data:image/png;base64," + base64.b64encode(data).decode()}
    images = []
    result = screenshot_observation("live_browser_screenshot", original, images)
    assert "dataUrl" in original and "dataUrl" not in result
    assert result["visual_observation"]["original_width"] == 2400
    assert result["visual_observation"]["attached"]
    assert len(images) == 1 and len(images[0]["imageUrl"]) <= MAX_IMAGE_URL_CHARS
    image = Image.open(io.BytesIO(base64.b64decode(images[0]["imageUrl"].split(",")[1])))
    image.load()
    assert image.size == (
        result["visual_observation"]["image_width"],
        result["visual_observation"]["image_height"],
    )


def test_file_screenshot_respects_workspace_and_preserves_region(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    inside = work / "shot.png"
    outside = tmp_path / "private.png"
    data = png_bytes((80, 40))
    inside.write_bytes(data)
    outside.write_bytes(data)
    with session_scope(Session(metadata={"workspace_path": str(work)})):
        images = []
        result = screenshot_observation(
            "screen_capture",
            {
                "path": "shot.png",
                "region": [100, 200, 80, 40],
            },
            images,
        )
        assert len(images) == 1
        assert result["region"] == [100, 200, 80, 40]
        for path in [str(outside), "../private.png"]:
            images = []
            result = screenshot_observation("screen_capture", {"path": path}, images)
            assert images == [] and result["visual_observation"]["attached"] is False


@pytest.mark.parametrize(
    "raw",
    [
        "https://example.com/shot.png",
        "not base64",
        "data:text/html;base64,YQ==",
        "data:image/png;base64,YQ==",
    ],
)
def test_invalid_media_is_explicit_and_never_fetched(raw):
    images = []
    result = screenshot_observation("live_browser_screenshot", {"dataUrl": raw}, images)
    assert images == [] and result["visual_observation"]["attached"] is False
    assert raw not in json.dumps(result)


def test_unrelated_file_result_is_not_read_as_image():
    original = {"path": "arbitrary-file.png"}
    images = []
    assert screenshot_observation("read_file", original, images) is original
    assert images == []


def test_current_task_read_denial_blocks_even_workspace_image(tmp_path, monkeypatch):
    from runtime.execution.tool_engine import tool_images

    image = tmp_path / "shot.png"
    image.write_bytes(png_bytes((40, 20)))
    monkeypatch.setattr(
        tool_images,
        "current_execution_request",
        lambda: SimpleNamespace(
            task=SimpleNamespace(permissions=SimpleNamespace(allows_read=lambda _: False)),
        ),
    )
    with session_scope(Session(metadata={"workspace_path": str(tmp_path)})):
        images = []
        result = screenshot_observation("screen_capture", {"path": str(image)}, images)
    assert not images and not result["visual_observation"]["attached"]


def test_small_screenshot_preserves_original_bytes():
    original = png_bytes((40, 20))
    images = []
    screenshot_observation(
        "live_browser_screenshot",
        {
            "dataUrl": "data:image/png;base64," + base64.b64encode(original).decode(),
        },
        images,
    )
    assert base64.b64decode(images[0]["imageUrl"].split(",")[1]) == original


def test_native_execution_detaches_media_before_text_pruning_and_honors_failure():
    data_url = "data:image/png;base64," + base64.b64encode(png_bytes((500, 500))).decode()
    output = {"ok": True, "dataUrl": data_url}
    stack = SimpleNamespace(
        executor=SimpleNamespace(
            registry=SimpleNamespace(
                has=lambda _: True,
                is_enabled=lambda _: True,
                get=lambda _: SimpleNamespace(handler=lambda: output),
            )
        )
    )
    images = []
    text, failed = execute_native_tool_call(
        stack,
        {"name": "live_browser_screenshot"},
        image_items=images,
    )
    assert not failed and len(images) == 1 and data_url not in text
    assert json.loads(text)["visual_observation"]["attached"]
    output["ok"] = False
    images = []
    _, failed = execute_native_tool_call(
        stack,
        {"name": "live_browser_screenshot"},
        image_items=images,
    )
    assert failed and images == []


def test_transport_rejects_oversized_media_instead_of_corrupting_it():
    for url in ["data:image/png;base64," + "YQ==" * 130_000, "https://example.com/image.png"]:
        result = validate_dynamic_tool_response(
            {
                "success": True,
                "contentItems": [{"type": "inputImage", "imageUrl": url}],
            }
        )
        assert result["success"] is False


@pytest.mark.parametrize("size", [(80, 40), (2400, 1200)])
def test_render_file_becomes_real_image_without_base64_in_text(size):
    from runtime.execution.tool_engine.tool_images import image_observation

    raw = png_bytes(size)
    images = []
    result = image_observation(
        "read_file",
        {
            "ok": True,
            "kind": "image",
            "media_type": "image/png",
            "data_base64": base64.b64encode(raw).decode(),
            "path": "render.png",
        },
        images,
    )
    assert len(images) == 1
    assert "data_base64" not in result and "data:" not in json.dumps(result)
    receipt = result["visual_observation"]
    assert receipt["attached"] and receipt["review_status"] == "unreviewed"
    assert len(receipt["image_sha256"]) == 64
    image = Image.open(io.BytesIO(base64.b64decode(images[0]["imageUrl"].split(",")[1])))
    image.load()
    assert image.width == receipt["image_width"]


def test_mcp_image_only_result_survives_bridge_and_is_not_a_pass_verdict():
    from runtime.adapters.mcp_client.bridge import _make_handler_for
    from runtime.execution.tool_engine.tool_images import image_observation

    raw = png_bytes((64, 32))
    block = {"type": "image", "mimeType": "image/png", "data": base64.b64encode(raw).decode()}
    client = SimpleNamespace(
        call_tool=lambda name, args: SimpleNamespace(
            success=True, output=None, latency_ms=1, raw_content=[block]
        )
    )
    output = _make_handler_for(client, "get_screenshot_of_window_as_image")()
    images = []
    result = image_observation("mcp_blender_screenshot", output, images)
    assert len(images) == 1 and "_mcp_images" not in result
    assert result["visual_observation"]["attached"]
    assert result["visual_observation"]["review_status"] == "unreviewed"
    assert base64.b64decode(images[0]["imageUrl"].split(",")[1]) == raw


def test_corrupt_file_image_is_unreviewed_and_never_text_encoded():
    from runtime.execution.tool_engine.tool_images import image_observation

    images = []
    result = image_observation(
        "read_file",
        {"ok": True, "kind": "image", "media_type": "image/png", "data_base64": "invalid"},
        images,
    )
    assert not images and not result["visual_observation"]["attached"]
    assert result["visual_observation"]["review_status"] == "unreviewed"
    assert "data_base64" not in result


def test_native_loop_image_result_is_multimodal_and_consumed_only_once():
    from runtime.execution.tool_engine.native_visual_results import visual_tool_results
    from runtime.sensing.gateway._tool_bridge_exec import _execute_tool_call

    raw = png_bytes((64, 32))
    stack = SimpleNamespace(
        executor=SimpleNamespace(
            registry=SimpleNamespace(
                has=lambda _: True,
                is_enabled=lambda _: True,
                get=lambda _: SimpleNamespace(
                    handler=lambda **_: {
                        "ok": True,
                        "kind": "image",
                        "media_type": "image/png",
                        "data_base64": base64.b64encode(raw).decode(),
                    }
                ),
            )
        )
    )
    session = Session(metadata={})
    with session_scope(session):
        text, failed = _execute_tool_call(
            stack, {"id": "render-call", "name": "read_file", "arguments": {}}
        )
    assert not failed
    original = [{"type": "tool_result", "tool_use_id": "render-call", "content": text}]
    result = visual_tool_results(original, session)
    assert isinstance(original[0]["content"], str)
    assert result[0]["content"][1]["type"] == "image"
    assert base64.b64decode(result[0]["content"][1]["source"]["data"]) == raw
    assert visual_tool_results(original, session)[0]["content"] == text
