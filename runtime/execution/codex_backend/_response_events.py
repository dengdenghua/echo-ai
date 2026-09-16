"""Serialize a completed Responses result as ordered SSE events."""

import json
from collections.abc import Mapping
from typing import Any, cast


def _responses_sse(response: Mapping[str, Any]) -> bytes:
    created = dict(response)
    created["status"] = "in_progress"
    created["output"] = []
    frames: list[tuple[str, dict[str, Any]]] = [
        (
            "response.created",
            {"type": "response.created", "response": created, "sequence_number": 0},
        )
    ]
    sequence = 1
    for index, item in enumerate(cast(list[dict[str, Any]], response["output"])):

        def emit(kind: str, **payload: Any) -> None:
            nonlocal sequence
            frames.append((kind, {"type": kind, "sequence_number": sequence, **payload}))
            sequence += 1

        initial = {**item, "status": "in_progress"}
        if item.get("type") == "message":
            initial["content"] = []
        elif item.get("type") == "function_call":
            initial["arguments"] = ""
        emit("response.output_item.added", output_index=index, item=initial)
        if item.get("type") == "message":
            for content_index, part in enumerate(item.get("content", [])):
                coordinates = {
                    "output_index": index,
                    "item_id": item["id"],
                    "content_index": content_index,
                }
                emit("response.content_part.added", **coordinates, part={**part, "text": ""})
                if part.get("type") == "output_text":
                    emit("response.output_text.delta", **coordinates, delta=part.get("text", ""))
                    emit("response.output_text.done", **coordinates, text=part.get("text", ""))
                emit("response.content_part.done", **coordinates, part=part)
        elif item.get("type") == "function_call":
            emit(
                "response.function_call_arguments.delta",
                output_index=index,
                item_id=item["id"],
                delta=item.get("arguments", ""),
            )
            emit(
                "response.function_call_arguments.done",
                output_index=index,
                item_id=item["id"],
                arguments=item.get("arguments", ""),
            )
        frames.append(
            (
                "response.output_item.done",
                {
                    "type": "response.output_item.done",
                    "output_index": index,
                    "item": item,
                    "sequence_number": sequence,
                },
            )
        )
        sequence += 1
    frames.append(
        (
            "response.completed",
            {
                "type": "response.completed",
                "response": dict(response),
                "sequence_number": sequence,
            },
        )
    )
    return b"".join(
        f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n".encode()
        for event, data in frames
    )
