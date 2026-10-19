"""Malformed provider inputs cannot fall through to default tool arguments."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from runtime.core.cerebrum.react_native import step_from_tool_calls
from runtime.core.cerebrum.react_types import _native_tool_calls_missing_required_args
from runtime.execution.suckers import Skill, SkillRegistry
from runtime.execution.tool_engine.native_tool_execution import execute_native_tool_call
from runtime.execution.tool_engine.tool_protocol import normalize_tool_call
from runtime.sensing.model_router._response_parsers import (
    parse_tool_call_arguments,
    tool_call_from_arguments,
)
from runtime.sensing.model_router.openai_compat_stream import iter_openai_sse
from runtime.sensing.model_router.openai_router import OpenAIModelRouter


@pytest.mark.parametrize(
    "raw",
    [
        '{"value": "unfinished',
        "not-json",
        "[]",
        "null",
        "42",
        "",
        None,
        '<parameter name="value">ok</parameter><parameter name="other">unfinished',
        {"wrapper": '<parameter name="value">unfinished'},
    ],
)
def test_malformed_arguments_are_not_an_empty_invocation(raw):
    with pytest.raises(ValueError, match="malformed tool arguments"):
        parse_tool_call_arguments(raw)


@pytest.mark.parametrize("raw", [{}, "{}", '"{}"'])
def test_legitimate_empty_arguments_remain_supported(raw):
    assert parse_tool_call_arguments(raw) == {}


def _provider_call(raw):
    return {
        "id": "call-broken",
        "type": "function",
        "function": {"name": "todo_read", "arguments": raw},
    }


@pytest.mark.parametrize("streaming", [False, True])
def test_provider_error_keeps_identity_but_never_runs_default_handler(streaming):
    raw = '{"value": "unfinished'
    if streaming:
        delta = _provider_call(raw)
        delta["index"] = 0
        payload = {"choices": [{"delta": {"tool_calls": [delta]}}]}
        response = SimpleNamespace(
            iter_lines=lambda: iter(["data: " + json.dumps(payload), "", "data: [DONE]", ""])
        )
        events = list(iter_openai_sse(response))
        call = next(event.tool_call for event in events if event.type == "tool_use")
        assert events[-1].final.tool_calls == [call]
    else:
        router = OpenAIModelRouter(base_url="http://unused.invalid/v1")
        payload = {"choices": [{"message": {"tool_calls": [_provider_call(raw)]}}]}
        call = router._extract_tool_calls(payload)[0]
    assert call.id == "call-broken"
    assert call.arguments_error

    effects = []
    registry = SkillRegistry()
    registry.register(
        Skill(
            name="todo_read",
            description="test",
            affinity=["test"],
            cost_profile="low",
            trusted_source="skill://public/test",
            handler=lambda value="DEFAULT": effects.append(value),
        )
    )
    stack = SimpleNamespace(executor=SimpleNamespace(registry=registry))
    output, is_error = execute_native_tool_call(stack, call)
    assert is_error
    assert "malformed tool arguments" in output
    assert effects == []
    # Even tools explicitly allowed to have empty input must not erase the
    # error while converting a native call into a ReAct action string.
    assert step_from_tool_calls([call]).actions == []
    assert _native_tool_calls_missing_required_args([call]) == ["todo_read"]
    with pytest.raises(ValueError, match="malformed tool arguments"):
        normalize_tool_call(call.model_dump())


def test_legacy_function_call_retains_argument_error():
    router = OpenAIModelRouter(base_url="http://unused.invalid/v1")
    calls = router._extract_tool_calls(
        {"choices": [{"message": {"function_call": _provider_call("broken")["function"]}}]}
    )
    assert calls[0].id == "function_call_0"
    assert calls[0].arguments_error


def test_valid_empty_call_still_executes_default_handler():
    call = tool_call_from_arguments(call_id="empty", name="noop", value="{}")
    assert call.arguments_error is None
    assert normalize_tool_call(call).arguments == {}


def test_subscription_and_gemini_adapters_do_not_guess_input_fields():
    from runtime.sensing.model_router.chatgpt_subscription_router import _tool_call_from_output
    from runtime.sensing.model_router.gemini_router import GeminiModelRouter

    subscription = _tool_call_from_output(
        {
            "type": "function_call",
            "call_id": "broken",
            "name": "todo_read",
            "arguments": '{"input": "unfinished',
        }
    )
    assert subscription.arguments_error
    gemini = GeminiModelRouter(base_url="http://unused.invalid")
    calls = gemini._extract_tool_calls(
        {
            "candidates": [
                {"content": {"parts": [{"functionCall": {"name": "todo_read", "args": []}}]}}
            ]
        }
    )
    assert calls[0].arguments_error


@pytest.mark.parametrize("stop_block", [True, False])
def test_anthropic_final_frame_cannot_erase_stream_argument_error(stop_block):
    from runtime.platform.models.llm import Message, ModelRequest
    from runtime.sensing.model_router.anthropic_router import AnthropicModelRouter

    class Stream:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def __iter__(self):
            yield SimpleNamespace(
                type="content_block_start",
                content_block=SimpleNamespace(
                    type="tool_use", id="broken", name="todo_read", input={}
                ),
            )
            yield SimpleNamespace(
                type="content_block_delta",
                delta=SimpleNamespace(
                    type="input_json_delta", partial_json='{"value": "unfinished'
                ),
            )
            if stop_block:
                yield SimpleNamespace(type="content_block_stop")

        def get_final_message(self):
            return SimpleNamespace(
                content=[SimpleNamespace(type="tool_use", id="broken", name="todo_read", input={})],
                usage=SimpleNamespace(input_tokens=10, output_tokens=10),
                stop_reason="tool_use",
            )

    client = SimpleNamespace(messages=SimpleNamespace(stream=lambda **kwargs: Stream()))
    router = AnthropicModelRouter(client=client)
    events = list(
        router.call_stream(
            ModelRequest(model="claude-test", messages=[Message(role="user", content="test")])
        )
    )
    final_call = events[-1].final.tool_calls[0]
    assert final_call.id == "broken" and final_call.arguments_error
    if stop_block:
        streamed_call = next(event.tool_call for event in events if event.type == "tool_use")
        assert streamed_call == final_call
    with pytest.raises(ValueError, match="malformed tool arguments"):
        normalize_tool_call(final_call)
