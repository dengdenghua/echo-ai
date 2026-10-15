"""A new home's first Auto turn: no OpenCode model, no native model, Codex signed in.

Auto used to settle on Echo whenever OpenCode could not take the turn, so a
new user with only a ChatGPT-subscription Codex login got "no LLM model
configured" instead of an answer. Auto now settles on Codex in exactly that
case — before any effect, keeping the host's scheduler — while explicit
engine choices keep failing with their own reason.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.codex_backend.readiness import CodexReadiness
from runtime.execution.engines import EngineId, EngineSelectionError, ExecutionPhase
from runtime.memory.threads.event_log import EventLog
from runtime.platform.config.schema import AgentConfig
from runtime.platform.models import ParsedIntent
from runtime.protocol import Turn, TurnParams
from runtime.sensing.gateway.realtime_execution import native_model_ready, select_turn_execution
from runtime.sensing.model_router.dispatch_router import ModelDispatchRouter
from runtime.sensing.model_router.live_fallback import LiveCustomModelFallback
from runtime.sensing.model_router.models import (
    MockModelRouter,
    UnconfiguredModelRouter,
    router_has_model,
)
from runtime.sensing.model_router.oct_router import OctFallbackRouter

_SCHEDULER = dict(
    project_command=False,
    group_fanout=False,
    topology_id=None,
    codex_partner=False,
    reflection_fast_path=False,
)


def _runtime(fallback):
    """A stack whose native dispatcher falls back to ``fallback``."""
    router = ModelDispatchRouter(fallback=fallback)
    # Registered on every real stack; it serves only ``chatgpt/...`` picks.
    router.register("chatgpt", MockModelRouter(response="subscription"))
    return SimpleNamespace(
        _stack=SimpleNamespace(config=AgentConfig(), planner=SimpleNamespace(router=router))
    )


def _turn(requested: str) -> Turn:
    return Turn(
        threadId="first-chat", params=TurnParams(threadId="first-chat", executionEngine=requested)
    )


def _intent(**fields) -> ParsedIntent:
    return ParsedIntent(raw="你好", normalized_goal="你好", intent_type="chitchat", **fields)


@pytest.fixture()
def codex_probe(monkeypatch):
    probe = Mock(return_value=CodexReadiness(True))
    monkeypatch.setattr(
        "runtime.sensing.gateway.realtime_execution.codex_readiness_for_turn", probe
    )
    return probe


def _opencode(monkeypatch, reason_code: str) -> None:
    if reason_code == "not_installed":
        status = {"available": False, "reason": "OpenCode 还没安装", "reason_code": reason_code}
    else:
        # Installed, but no Zen/Go connection and no picked model.
        status = {"available": True, "reason": None}
    monkeypatch.setattr(
        "runtime.execution.opencode_backend.inspect_readiness", lambda scope: status
    )
    monkeypatch.setattr("runtime.execution.opencode_backend.zen_catalog", lambda: {})


def test_the_native_dispatcher_knows_when_it_has_no_model():
    empty = ModelDispatchRouter(fallback=UnconfiguredModelRouter())
    assert not empty.can_answer(None)
    assert not empty.can_answer("auto")
    empty.register("chatgpt", MockModelRouter())
    assert empty.can_answer("chatgpt/gpt-5.5")
    assert not empty.can_answer("auto")
    assert ModelDispatchRouter(fallback=MockModelRouter()).can_answer("auto")


def test_delegating_fallbacks_report_the_router_they_would_call():
    catalog = {"router": UnconfiguredModelRouter()}
    live = LiveCustomModelFallback(
        build=lambda prefer: catalog["router"], signature=lambda: id(catalog["router"])
    )
    assert not router_has_model(live)
    # A first model added in Settings answers without a restart.
    catalog["router"] = MockModelRouter()
    assert router_has_model(live)
    guest = OctFallbackRouter(
        oct_router=Mock(),
        self_router=LiveCustomModelFallback(build=lambda prefer: UnconfiguredModelRouter()),
        link_store=Mock(),
    )
    assert not router_has_model(guest)
    # Unknown routers and test doubles are never mistaken for "no model".
    assert router_has_model(Mock())


def test_a_stack_without_a_native_dispatcher_keeps_the_echo_assumption():
    turn = _turn("auto")
    assert native_model_ready(SimpleNamespace(_stack=SimpleNamespace(config=AgentConfig())), turn)
    assert not native_model_ready(_runtime(UnconfiguredModelRouter()), turn)
    assert native_model_ready(_runtime(MockModelRouter()), turn)


@pytest.mark.parametrize("reason_code", ["not_installed", "no_model"])
@pytest.mark.parametrize(
    ("signals", "expected_driver"),
    [
        ({}, "codex_app_server"),
        ({"project_command": True}, "project_os"),
        ({"group_fanout": True}, "group_fanout"),
        ({"coordinated": True}, "codex_app_server"),
    ],
)
def test_auto_settles_on_a_ready_codex_when_echo_has_no_model(
    monkeypatch, codex_probe, reason_code, signals, expected_driver
):
    _opencode(monkeypatch, reason_code)
    route = asyncio.run(
        select_turn_execution(
            _runtime(UnconfiguredModelRouter()),
            _turn("auto"),
            object(),
            _intent(),
            **{**_SCHEDULER, **signals},
        )
    )
    assert route.engine is EngineId.CODEX
    assert route.reason == f"opencode_{reason_code}:native_no_model"
    # The host's project/team scheduler survives the engine choice.
    assert route.driver_for(ExecutionPhase.PRIMARY) == expected_driver
    assert route.driver_for(ExecutionPhase.REPAIR) == "codex_app_server"
    codex_probe.assert_called_once()


def test_auto_keeps_echo_when_it_has_a_model(monkeypatch, codex_probe):
    _opencode(monkeypatch, "no_model")
    route = asyncio.run(
        select_turn_execution(
            _runtime(MockModelRouter()), _turn("auto"), object(), _intent(), **_SCHEDULER
        )
    )
    assert (route.engine, route.reason) == (EngineId.ECHO, "opencode_no_model")
    codex_probe.assert_not_called()


def test_auto_keeps_echo_when_codex_is_not_ready_either(monkeypatch, codex_probe):
    _opencode(monkeypatch, "no_model")
    codex_probe.return_value = CodexReadiness(False, "account_required")
    route = asyncio.run(
        select_turn_execution(
            _runtime(UnconfiguredModelRouter()), _turn("auto"), object(), _intent(), **_SCHEDULER
        )
    )
    # Echo then reports the missing model in the user's language, as before.
    assert (route.engine, route.reason) == (EngineId.ECHO, "opencode_no_model")


def test_an_image_turn_on_auto_also_reaches_codex(monkeypatch, codex_probe):
    probe = Mock(side_effect=AssertionError("capability admission precedes OpenCode readiness"))
    monkeypatch.setattr("runtime.execution.opencode_backend.inspect_readiness", probe)
    route = asyncio.run(
        select_turn_execution(
            _runtime(UnconfiguredModelRouter()),
            _turn("auto"),
            object(),
            _intent(modalities=["image"]),
            **_SCHEDULER,
        )
    )
    assert (route.engine, route.reason) == (
        EngineId.CODEX,
        "capability_unmet:vision:native_no_model",
    )
    probe.assert_not_called()


def test_explicit_engines_are_never_rerouted(monkeypatch, codex_probe):
    _opencode(monkeypatch, "not_installed")
    with pytest.raises(EngineSelectionError) as raised:
        asyncio.run(
            select_turn_execution(
                _runtime(UnconfiguredModelRouter()),
                _turn("opencode"),
                object(),
                _intent(),
                **_SCHEDULER,
            )
        )
    assert raised.value.engine is EngineId.OPENCODE
    # An installed OpenCode without a model keeps the explicit pick, which
    # then fails with OpenCode's own reason.
    _opencode(monkeypatch, "no_model")
    route = asyncio.run(
        select_turn_execution(
            _runtime(UnconfiguredModelRouter()),
            _turn("opencode"),
            object(),
            _intent(),
            **_SCHEDULER,
        )
    )
    assert route.engine is EngineId.OPENCODE
    route = asyncio.run(
        select_turn_execution(
            _runtime(UnconfiguredModelRouter()), _turn("echo"), object(), _intent(), **_SCHEDULER
        )
    )
    assert (route.engine, route.reason) == (EngineId.ECHO, "explicit_engine")
    codex_probe.assert_not_called()


def test_api_auto_first_turn_runs_on_codex(tmp_path, monkeypatch, codex_probe):
    from runtime.sensing.gateway.realtime_cerebrum import CerebrumRuntime
    from runtime.sensing.gateway.realtime_gateway import RealtimeGateway
    from tests.test_realtime_cerebrum import _drive

    _opencode(monkeypatch, "no_model")
    runtime = CerebrumRuntime(
        stack=_runtime(UnconfiguredModelRouter())._stack,
        agent=object(),
        logs_root=str(tmp_path / "threads"),
    )
    native = AsyncMock(side_effect=AssertionError("Echo has no model to answer with"))
    calls = []

    async def codex(rt, turn, log, emitter, intent, agent, provider, *, text):
        calls.append(text)
        await rt._emit_agent_message(turn, log, emitter, "Codex 回答")
        return True

    monkeypatch.setattr(runtime, "_drive_react", native)
    monkeypatch.setattr(CerebrumRuntime, "_drive_codex_app_server", codex)
    app = FastAPI()
    app.include_router(RealtimeGateway(runtime=runtime, approval_timeout=5.0).router)
    with TestClient(app) as client, client.websocket_connect("/api/realtime") as ws:
        turn = _drive(
            ws,
            {
                "threadId": "first-chat",
                "model": "auto",
                "executionEngine": "auto",
                "input": [{"type": "text", "text": "你好"}],
                "approvalPolicy": "never",
            },
        )["response"].result["turn"]
    native.assert_not_called()
    assert calls == ["你好"]
    assert turn["status"] == "completed", turn
    restored = EventLog(runtime._log_for("first-chat").path).replay()[-1]
    assert restored.execution.engine == "codex"
    assert restored.execution.reason == "opencode_no_model:native_no_model"
