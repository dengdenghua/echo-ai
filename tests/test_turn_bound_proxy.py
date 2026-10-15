"""A warm Responses proxy serves exactly one turn at a time."""

from __future__ import annotations

import pytest

from runtime.execution.codex_backend.responses_proxy import (
    CodexResponsesScope,
    ResponsesProxyError,
)
from runtime.execution.codex_backend.turn_bound_proxy import TurnBoundResponsesProxy
from runtime.platform.process.session import Session
from tests.test_codex_responses_proxy import _post, _RecordingRouter, _scope, _tool_history_payload


def _session(actor: str, turn: str) -> Session:
    return Session(
        actor=actor, thread_id=f"thread-{turn}", turn_id=turn, metadata={"tenant_id": "tenant-a"}
    )


@pytest.mark.asyncio
async def test_between_turns_every_request_is_refused() -> None:
    router = _RecordingRouter(tools=False)
    first = _session("alice", "turn-a")
    proxy = TurnBoundResponsesProxy(router, scope=_scope(), trusted_session=first)
    profile = await proxy.start()
    try:
        assert (await _post(profile, _tool_history_payload()))[0] == 200

        proxy.release_turn()
        assert (await _post(profile, _tool_history_payload(suffix="-idle")))[0] == 401

        second = _session("alice", "turn-b")
        next_turn = CodexResponsesScope(
            tenant_id="tenant-a",
            principal_id="alice",
            thread_id="thread-turn-b",
            turn_id="turn-b",
            model="deepseek-chat",
        )
        proxy.bind_turn(next_turn, second)
        # Same port and token: the warm OpenCode process keeps its config.
        assert (await _post(profile, _tool_history_payload(suffix="-next")))[0] == 200
        assert router.sessions == [first, second]
        assert proxy.scope.turn_id == "turn-b"

        with pytest.raises(ResponsesProxyError, match="identity or model"):
            proxy.bind_turn(_scope(model="another-model"), second)
        with pytest.raises(ResponsesProxyError, match="trusted session"):
            proxy.bind_turn(next_turn, _session("bob", "turn-c"))
    finally:
        await proxy.close()
    with pytest.raises(ResponsesProxyError, match="not running"):
        proxy.bind_turn(next_turn, second)
