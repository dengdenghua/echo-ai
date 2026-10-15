"""A conversation keeps its Codex App Server process between turns."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from typing import Any, cast

import pytest

from runtime.execution.codex_backend import CodexExecutionSession, warm_pool
from runtime.execution.codex_backend._transport import deny_approval
from runtime.execution.codex_backend.types import Notification
from runtime.safety.approval.approval_gate import AutoDenyProvider
from tests.test_codex_execution_backend import _binding, _make_session


@pytest.fixture(autouse=True)
def _empty_pool() -> None:
    warm_pool._pool.clear()


def _completed() -> Notification:
    return Notification(
        "turn/completed", {"threadId": "inner-existing", "turn": {"id": "turn-new"}}
    )


def test_a_finished_turn_leaves_its_process_for_the_next_one(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(warm_pool, "key_for", lambda *_args, **_kwargs: "conversation")
    first, security, context, factory, client = _make_session(tmp_path, binding=_binding())
    client.ready = True

    def turn(turn_id: str) -> CodexExecutionSession:
        return CodexExecutionSession(
            replace(first.request, outer_turn_id=turn_id),
            security=cast(Any, security),
            approval_provider=AutoDenyProvider(),
            is_interrupted=lambda: False,
            client_factory=cast(Any, factory),
            keep_warm=True,
        )

    async def run(session: CodexExecutionSession, events: list[Notification]) -> None:
        client.events = events
        await session.start()
        async for _ in session.notifications():
            pass
        await session.close()

    async def scenario() -> None:
        await run(turn("outer-1"), [_completed()])
        assert client.closed is False and context.cleaned is False
        entry = warm_pool._pool["conversation"]
        assert entry.in_use is False
        # Between turns the App Server's requests reach no one's broker.
        refused = await entry.handlers.approve(SimpleNamespace(method="execCommandApproval"))
        assert refused == deny_approval("execCommandApproval")

        second = turn("outer-2")
        client.events = [_completed()]
        await second.start()
        assert [call for call, _ in client.calls].count("initialize") == 1
        assert entry.handlers.approval is second._approval_broker
        resumes = [args for call, args in client.calls if call == "thread/resume"]
        assert len(resumes) == 2  # this turn's tools and instructions are reasserted
        async for _ in second.notifications():
            pass
        await second.close()
        assert client.closed is False

        # A turn that never completed (interrupted, failed) takes the process down.
        await run(turn("outer-3"), [])
        assert client.closed is True and context.cleaned is True
        assert warm_pool._pool == {}

    asyncio.run(scenario())


def test_wrapped_or_credential_carrying_launches_stay_one_shot(tmp_path) -> None:
    request = SimpleNamespace(
        command=("codex", "app-server"),
        provider_profile=None,
        tool_free=False,
        host_tools_only=False,
        dynamic_tool_handler=object(),
    )
    context = SimpleNamespace(
        codex_home=tmp_path / "codex-home",
        workspace=tmp_path / "workspace",
        sandbox_mode="workspace-write",
        approval_reviewer="user",
        selected_app_ids=(),
        locked_off_features=("apps",),
        host_skills_isolated=True,
    )
    key = warm_pool.key_for(request, context, wrapped=False)
    assert key and key == warm_pool.key_for(request, context, wrapped=False)
    assert warm_pool.key_for(request, context, wrapped=True) is None
    credentialed = SimpleNamespace(
        **{**vars(request), "provider_profile": SimpleNamespace(scoped_bearer_token="turn-only")}
    )
    assert warm_pool.key_for(credentialed, context, wrapped=False) is None
    chat = SimpleNamespace(**{**vars(request), "tool_free": True})
    assert warm_pool.key_for(chat, context, wrapped=False) != key

    login = tmp_path / "login"
    login.mkdir()
    (login / "auth.json").write_text('{"account": "a"}', encoding="utf-8")
    signed_in = SimpleNamespace(**{**vars(request), "source_codex_home": login})
    before = warm_pool.key_for(signed_in, context, wrapped=False)
    (login / "auth.json").write_text('{"account": "b"}', encoding="utf-8")
    assert warm_pool.key_for(signed_in, context, wrapped=False) != before
