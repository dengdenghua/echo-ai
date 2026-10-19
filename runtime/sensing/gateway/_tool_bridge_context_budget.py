"""Bound native requests without separating tool calls from their results."""

from __future__ import annotations

import json

from runtime.core.cerebrum._react_context_helpers import (
    _estimate_tokens,
    context_budget_tokens_for_model,
    context_compaction_target_tokens,
)
from runtime.platform.models.custom_model_flags import model_context_window
from runtime.platform.models.llm import Message, ModelRequest

_COMPACTION_NOTICE = (
    "[native context compaction] Earlier tool exchanges were omitted to fit the context budget. "
    "Keep following the user's instructions. Re-read evidence before relying on omitted details; "
    "omission does not imply success or failure."
)


class NativeContextBudgetError(ValueError):
    """Essential instructions, schemas or latest evidence exceed the budget."""


def estimate_native_request_tokens(request: ModelRequest) -> int:
    # Serialize blocks in full: text-only estimators miss tool input, schemas
    # and non-text content. The estimate remains deliberately tokenizer-free.
    payload = {
        "messages": [message.model_dump(exclude_none=True) for message in request.messages],
        "tools": [tool.model_dump() for tool in request.tools],
        "images": request.images_b64,
    }
    return _estimate_tokens(json.dumps(payload, ensure_ascii=False, default=str))


def _tool_ids(message: Message, kind: str) -> set[str]:
    if not isinstance(message.content, list):
        return set()
    key = "id" if kind == "tool_use" else "tool_use_id"
    return {
        str(block[key])
        for block in message.content
        if isinstance(block, dict) and block.get("type") == kind and block.get(key)
    }


def _has_instructions(message: Message) -> bool:
    if message.role == "system":
        return True
    if message.role != "user":
        return False
    if not isinstance(message.content, list):
        return True
    return any(
        not isinstance(block, dict) or block.get("type") != "tool_result"
        for block in message.content
    )


def _removable_exchanges(messages: list[Message]) -> list[tuple[int, int]]:
    """Identify complete, consecutive assistant-call/user-result exchanges.

    Interleaved user steering and incomplete batches stay intact. Keep the
    latest exchange as working evidence; never cut a block or an argument.
    """
    exchanges: list[tuple[int, int]] = []
    index = 0
    while index < len(messages):
        message = messages[index]
        pending = _tool_ids(message, "tool_use") if message.role == "assistant" else set()
        if not pending:
            index += 1
            continue
        end = index + 1
        while end < len(messages) and pending:
            result = messages[end]
            if result.role != "user" or _has_instructions(result):
                break
            result_ids = _tool_ids(result, "tool_result")
            if not result_ids or not result_ids <= pending:
                break
            pending -= result_ids
            end += 1
        if not pending:
            exchanges.append((index, end))
            index = end
        else:
            index += 1
    return exchanges[:-1]


def fit_native_request(request: ModelRequest) -> ModelRequest:
    """Compact complete old exchanges or reject before any provider call.

    Instructions, steering, tool schemas and the latest exchange are kept
    verbatim. Durable trajectory messages are not mutated by this function.
    """
    capacity = context_budget_tokens_for_model(request.model)
    configured_window = model_context_window(request.model)
    if configured_window is not None:
        capacity = min(capacity, configured_window)
    capacity = max(0, capacity - (request.max_tokens or 0))
    current = estimate_native_request_tokens(request)
    target = context_compaction_target_tokens(current, capacity)
    if current <= target:
        return request

    removed: set[int] = set()
    candidate = request
    for start, end in _removable_exchanges(request.messages):
        removed.update(range(start, end))
        messages = [
            message for index, message in enumerate(request.messages) if index not in removed
        ]
        if not any(message.content == _COMPACTION_NOTICE for message in messages):
            # Place the disclosure before the first retained tool exchange.
            # It is ordinary context, not an elevated system instruction.
            position = next(
                (i for i, message in enumerate(messages) if message.role != "system"),
                len(messages),
            )
            messages.insert(position, Message(role="user", content=_COMPACTION_NOTICE))
        candidate = request.model_copy(update={"messages": messages})
        current = estimate_native_request_tokens(candidate)
        if current <= target:
            break
    if current > capacity:
        raise NativeContextBudgetError(
            f"Native context exceeds the input budget ({current} estimated tokens; "
            f"budget {capacity}). Reduce the input or tool catalog, or select a larger context model."
        )
    return candidate
