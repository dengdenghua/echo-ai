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


def test_a_direct_launch_may_stay_warm_but_a_real_wrapper_may_not() -> None:
    # Windows resolves DirectBackend (no hard backend): identity transform,
    # no enforcement, so the process is the same as an unwrapped one.
    from runtime.execution.codex_backend.backend import _launch_is_wrapped
    from runtime.safety.sandboxing.sandbox import BackendChoice, DirectBackend

    assert _launch_is_wrapped(None) is False
    assert _launch_is_wrapped(BackendChoice(DirectBackend(), "direct", hard=False)) is False
    wrapper = SimpleNamespace(backend=object(), name="bwrap", hard=True)
    assert _launch_is_wrapped(cast(Any, wrapper)) is True


def test_a_prewarm_starts_the_process_a_later_chat_turn_takes(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(warm_pool, "key_for", lambda *_args, **_kwargs: "principal-chat")
    first, security, context, factory, client = _make_session(tmp_path, binding=_binding())
    client.ready = True

    def session(turn_id: str) -> CodexExecutionSession:
        return CodexExecutionSession(
            replace(first.request, outer_turn_id=turn_id),
            security=cast(Any, security),
            approval_provider=AutoDenyProvider(),
            is_interrupted=lambda: False,
            client_factory=cast(Any, factory),
            keep_warm=True,
        )

    async def scenario() -> None:
        warming = session("prewarm")
        assert await warming.prewarm() is True
        await warming.close()
        calls = [call for call, _ in client.calls]
        assert "config/read" in calls  # the effective config was checked before keeping it
        assert "thread/resume" not in calls and "thread/start" not in calls
        assert client.closed is False and context.cleaned is False
        assert warm_pool._pool["principal-chat"].in_use is False

        turn = session("outer-1")
        client.events = [_completed()]
        await turn.start()
        assert [call for call, _ in client.calls].count("initialize") == 1
        async for _ in turn.notifications():
            pass
        await turn.close()
        assert client.closed is False

    asyncio.run(scenario())


def test_a_prewarm_that_can_never_be_kept_closes_its_process(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(warm_pool, "key_for", lambda *_args, **_kwargs: None)
    session, _security, context, _factory, client = _make_session(tmp_path, binding=_binding())

    async def scenario() -> None:
        assert await session.prewarm() is False
        await session.close()
        assert client.closed is True and context.cleaned is True
        assert warm_pool._pool == {}

    asyncio.run(scenario())


def test_chat_turns_sharing_a_home_take_turns_to_start() -> None:
    from runtime.execution.codex_backend import chat_warm

    async def scenario() -> None:
        first = await chat_warm.acquire_startup("home")
        assert await chat_warm.acquire_startup(None) is None
        second = asyncio.ensure_future(chat_warm.acquire_startup("home"))
        await asyncio.sleep(0.05)
        assert not second.done()  # waits while the first writes config and binds
        chat_warm.release_startup(first)
        lock = await asyncio.wait_for(second, timeout=1)
        assert lock is first
        chat_warm.release_startup(lock)

    asyncio.run(scenario())


@pytest.mark.asyncio
async def test_model_switch_releases_idle_writer_before_first_resume(tmp_path):
    closed = []

    class Client:
        ready = True
        _echo_writer_threads = {"same-inner-thread"}

        async def close(self):
            closed.append("closed")

    old = Client()
    new = Client()
    owner = SimpleNamespace(cleanup=lambda: closed.append("cleaned"))
    entry = warm_pool.WarmProcess(
        "old-model",
        cast(Any, old),
        warm_pool.TurnHandlers(),
        owner,
        asyncio.get_running_loop(),
        in_use=False,
    )
    warm_pool._pool["old-model"] = entry

    async def resume():
        assert closed == ["closed", "cleaned"]
        return "same-inner-thread"

    result = await warm_pool.restore_writer(
        new, SimpleNamespace(inner_thread_id="same-inner-thread"), resume
    )
    assert result == "same-inner-thread"
    assert not warm_pool._pool
    assert "same-inner-thread" in new._echo_writer_threads


@pytest.mark.asyncio
async def test_model_switch_never_terminates_an_active_writer(tmp_path):
    closed = []
    old = SimpleNamespace(
        _echo_writer_threads={"same-inner-thread"}, close=lambda: closed.append(True)
    )
    entry = warm_pool.WarmProcess(
        "busy",
        cast(Any, old),
        warm_pool.TurnHandlers(),
        None,
        asyncio.get_running_loop(),
        in_use=True,
    )
    warm_pool._pool["busy"] = entry

    async def resume():
        raise AssertionError("must not start a concurrent turn")

    with pytest.raises(RuntimeError, match="active turn"):
        await warm_pool.restore_writer(
            object(), SimpleNamespace(inner_thread_id="same-inner-thread"), resume
        )
    assert not closed
    assert warm_pool._pool["busy"] is entry


def test_changed_model_or_budget_cannot_reuse_stale_process(tmp_path):
    request = SimpleNamespace(command=("codex", "app-server"), provider_profile=None, tool_free=False, host_tools_only=False, dynamic_tool_handler=None)
    context = SimpleNamespace(codex_home=tmp_path, workspace=tmp_path, sandbox_mode="read-only", approval_reviewer="user", selected_app_ids=(), locked_off_features=(), host_skills_isolated=True)
    original = warm_pool.key_for(request, context, wrapped=False)
    for field, value in (("model", "new-model"), ("model_context_window", 1000000), ("auto_compact_token_limit", 64000)):
        changed = SimpleNamespace(**{**vars(request), field: value})
        assert warm_pool.key_for(changed, context, wrapped=False) != original
