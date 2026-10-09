"""Serialize a completed Responses result as ordered SSE events."""

import json
from collections.abc import Mapping
from typing import Any, cast


def _response_frames(response: Mapping[str, Any]) -> list[tuple[str, dict[str, Any]]]:
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
    return frames


def _responses_sse(response: Mapping[str, Any]) -> bytes:
    return b"".join(
        f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n".encode()
        for event, data in _response_frames(response)
    )


class ResponsesTextStream:
    """Emit text immediately; finalize validated tools and usage exactly once."""

    def __init__(self, response: dict[str, Any]) -> None:
        self.response = {**response, "status": "in_progress", "output": []}
        self.sequence = 0
        self.text = ""
        self.item_id = response["id"].replace("resp_", "msg_", 1)

    def emit(self, kind: str, **payload: Any) -> bytes:
        data = {"type": kind, "sequence_number": self.sequence, **payload}
        self.sequence += 1
        return f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n".encode()

    def start(self) -> bytes:
        return self.emit("response.created", response=self.response)

    def delta(self, text: str) -> bytes:
        if not text:
            return b""
        frames = b""
        if not self.text:
            # The final message phase depends on whether tools are returned.
            # Omit it until finalization rather than guessing final_answer.
            frames += self.emit(
                "response.output_item.added",
                output_index=0,
                item={
                    "id": self.item_id,
                    "type": "message",
                    "status": "in_progress",
                    "role": "assistant",
                    "content": [],
                },
            )
            frames += self.emit(
                "response.content_part.added",
                output_index=0,
                item_id=self.item_id,
                content_index=0,
                part={"type": "output_text", "text": "", "annotations": []},
            )
        self.text += text
        return frames + self.emit(
            "response.output_text.delta",
            output_index=0,
            item_id=self.item_id,
            content_index=0,
            delta=text,
        )

    def finish(self, response: dict[str, Any]) -> bytes:
        response["id"] = self.response["id"]
        response["created_at"] = self.response["created_at"]
        frames = b""
        if self.text:
            output = response["output"]
            if not output or output[0]["type"] != "message":
                raise ValueError("streamed text missing from final response")
            text = output[0]["content"][0]["text"]
            if not text.startswith(self.text):
                raise ValueError("streamed text differs from final response")
            frames += self.delta(text[len(self.text) :])
            output[0]["id"] = self.item_id
        for kind, payload in _response_frames(response):
            if kind == "response.created":
                continue
            if (
                self.text
                and payload.get("output_index") == 0
                and kind
                in {
                    "response.output_item.added",
                    "response.content_part.added",
                    "response.output_text.delta",
                }
            ):
                continue
            frames += self.emit(
                kind,
                **{
                    key: value
                    for key, value in payload.items()
                    if key not in {"type", "sequence_number"}
                },
            )
        return frames
