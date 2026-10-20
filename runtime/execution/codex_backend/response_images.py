"""Preserve tool-output images across the Responses-to-model bridge."""

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from runtime.platform.models.llm import Message


def tool_output_message(
    call_id: str,
    output: Any,
    images_b64: list[str],
    *,
    decode_image: Callable[[Mapping[str, Any]], str],
    flatten_output: Callable[[Any], str],
) -> Message:
    if isinstance(output, Sequence) and not isinstance(output, (str, bytes, bytearray)):
        text_parts = []
        for part in output:
            if isinstance(part, Mapping) and part.get("type") in {
                "input_image",
                "image_url",
                "inputImage",
            }:
                image = dict(part)
                if "imageUrl" in image:
                    image["image_url"] = image.pop("imageUrl")
                images_b64.append(decode_image(image))
            else:
                text_parts.append(part)
        output = text_parts
    return Message(
        role="user",
        content=[
            {"type": "tool_result", "tool_use_id": call_id, "content": flatten_output(output)}
        ],
    )
