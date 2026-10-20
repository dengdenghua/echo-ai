"""Turn-local image handoff for the native tool-result protocol."""

from typing import Any

from runtime.platform.process.session import current_session


def remember_tool_images(call_id: str, images: list[dict[str, str]]) -> None:
    session = current_session()
    if session is not None and images:
        session.metadata.setdefault("_native_visual_results", {})[call_id] = images


def visual_tool_results(blocks: list[dict[str, Any]], session: Any) -> list[dict[str, Any]]:
    pending = session.metadata.get("_native_visual_results", {})
    result = []
    for block in blocks:
        images = pending.pop(block.get("tool_use_id"), [])
        item = dict(block)
        if images and not block.get("is_error"):
            content = [{"type": "text", "text": str(block.get("content") or "")}]
            for image in images:
                header, data = image["imageUrl"].split(",", 1)
                content.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": header[5:].split(";")[0],
                            "data": data,
                        },
                    }
                )
            item["content"] = content
        result.append(item)
    return result
