from __future__ import annotations

from types import SimpleNamespace

import pytest

from runtime.platform.models.llm import Message, ModelRequest, ToolSpec
from runtime.sensing.gateway import _tool_bridge_context_budget as module
from runtime.sensing.gateway._tool_bridge_loop_context import _NativeLoopDirective
from runtime.sensing.gateway._tool_bridge_loop_stream import _reserve_model_round


@pytest.fixture(autouse=True)
def fixed_model_budget(monkeypatch):
    monkeypatch.setattr(module, "context_budget_tokens_for_model", lambda model: 2000)
    monkeypatch.setattr(module, "model_context_window", lambda model: None)


def _exchange(call_id, content="result"):
    return [
        Message(
            role="assistant",
            content=[
                {"type": "tool_use", "id": call_id, "name": "read", "input": {"path": call_id}}
            ],
        ),
        Message(
            role="user",
            content=[{"type": "tool_result", "tool_use_id": call_id, "content": content}],
        ),
    ]


def _request(messages, **kwargs):
    return ModelRequest(model="test", messages=messages, max_tokens=200, **kwargs)


def test_small_request_is_unchanged():
    request = _request([Message(role="user", content="hello")])
    assert module.fit_native_request(request) is request


def test_compaction_keeps_pairs_instructions_steering_and_latest_evidence():
    messages = [
        Message(role="system", content="system policy"),
        Message(role="user", content="original task"),
    ]
    messages += _exchange("old", "x" * 9000)
    messages += [Message(role="user", content="new steering")]
    messages += _exchange("recent", "verified evidence")
    request = _request(messages)
    result = module.fit_native_request(request)
    assert module.estimate_native_request_tokens(result) < 1800
    assert messages == request.messages  # original trajectory remains intact
    assert messages[0] in result.messages and messages[1] in result.messages
    assert messages[4] in result.messages
    assert result.messages[-2:] == messages[-2:]
    assert not any(module._tool_ids(m, "tool_use") == {"old"} for m in result.messages)
    uses = set().union(*(module._tool_ids(m, "tool_use") for m in result.messages))
    results = set().union(*(module._tool_ids(m, "tool_result") for m in result.messages))
    assert uses == results == {"recent"}


@pytest.mark.parametrize("oversized", ["system", "user", "schema", "latest_result"])
def test_essential_oversize_is_rejected_without_truncating(oversized):
    messages = [Message(role="system", content="policy"), Message(role="user", content="task")]
    tools = []
    if oversized in {"system", "user"}:
        index = 0 if oversized == "system" else 1
        messages[index] = Message(role=oversized, content="x" * 9000)
    elif oversized == "schema":
        tools = [ToolSpec(name="huge", description="x" * 9000)]
    else:
        messages += _exchange("latest", "x" * 9000)
    with pytest.raises(module.NativeContextBudgetError, match="input budget"):
        module.fit_native_request(_request(messages, tools=tools))


def test_parallel_batch_is_removed_as_one_unit():
    batch = _exchange("first", "x" * 9000)
    second = _exchange("second")
    batch[0] = batch[0].model_copy(update={"content": batch[0].content + second[0].content})
    batch.append(second[1])
    request = _request([Message(role="user", content="task"), *batch, *_exchange("latest")])
    result = module.fit_native_request(request)
    assert all(
        "first" not in str(m.content) and "second" not in str(m.content) for m in result.messages
    )


def test_incomplete_batch_is_never_pruned_into_an_orphan():
    incomplete = _exchange("pending", "x" * 9000)
    incomplete[0] = incomplete[0].model_copy(
        update={
            "content": incomplete[0].content
            + [{"type": "tool_use", "id": "missing", "name": "read", "input": {}}]
        }
    )
    request = _request([Message(role="user", content="task"), *incomplete, *_exchange("latest")])
    with pytest.raises(module.NativeContextBudgetError):
        module.fit_native_request(request)


def test_small_configured_window_is_honored(monkeypatch):
    monkeypatch.setattr(module, "model_context_window", lambda model: 500)
    with pytest.raises(module.NativeContextBudgetError):
        module.fit_native_request(_request([Message(role="user", content="x" * 1500)]))


def test_preflight_stops_before_budget_reservation_or_provider_dispatch():
    reserved = []
    finalized = []
    ctx = SimpleNamespace(
        req=_request([Message(role="user", content="x" * 9000)]),
        _reserve_native_model_budget=lambda request: reserved.append(request),
        _finalize_native_trajectory=lambda **kwargs: finalized.append(kwargs),
    )
    stream = _reserve_model_round(ctx)
    event = next(stream)
    assert event[0] == "error" and event[1]["kind"] == "context_budget_exceeded"
    with pytest.raises(StopIteration) as done:
        next(stream)
    assert done.value.value is _NativeLoopDirective.TERMINAL
    assert reserved == []
    assert finalized == [{"success": False, "disposition": "failed"}]
