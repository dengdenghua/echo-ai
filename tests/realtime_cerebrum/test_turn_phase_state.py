from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle
from runtime.sensing.gateway.realtime_cerebrum import CerebrumRuntime
from tests.realtime_cerebrum._helpers import drive as _drive


def test_snapshot_failure_after_intent_build_keeps_the_current_intent(
    gateway: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_snapshot = CerebrumRuntime._snapshot_to_thread_store
    snapshots: list[Any] = []
    proposals: list[dict[str, Any]] = []

    def snapshot(self: Any, thread_id: str, log: Any, intent: Any = None) -> None:
        if intent is not None:
            snapshots.append(intent)
            if len(snapshots) == 1:
                raise RuntimeError("snapshot failed after intent assignment")
        original_snapshot(self, thread_id, log, intent)

    def proposal(self: Any, turn: Any, **kwargs: Any) -> None:
        proposals.append(kwargs)

    monkeypatch.setattr(CerebrumRuntime, "_snapshot_to_thread_store", snapshot)
    monkeypatch.setattr(CerebrumRuntime, "_record_failed_turn_proposal", proposal)
    client, _ = gateway
    with client.websocket_connect("/api/realtime") as ws:
        result = _drive(
            ws,
            params={
                "threadId": "phase-snapshot-failure",
                "input": [{"type": "text", "text": "hi"}],
                "approvalPolicy": "never",
            },
        )

    completed = [n.params["turn"] for n in result["notifications"] if n.method == "turn/completed"]
    assert completed[-1]["status"] == "failed"
    assert completed[-1]["completedAt"]
    assert result["response"].error is not None
    assert len(snapshots) == 2
    assert snapshots[0] is snapshots[1]
    assert proposals[-1]["intent"] is snapshots[0]
    assert proposals[-1]["failure_source"] == "turn_lifecycle_exception"


def test_binding_failure_keeps_the_external_model_intent_and_driver(
    gateway: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    proposals: list[dict[str, Any]] = []

    async def select_route(**kwargs: Any) -> tuple[bool, Any]:
        return False, SimpleNamespace(engine="codex", driver="codex_app_server")

    def fail_binding(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("driver binding failed after model ownership handoff")

    def proposal(self: Any, turn: Any, **kwargs: Any) -> None:
        proposals.append(kwargs)

    monkeypatch.setattr(lifecycle, "_select_turn_route", select_route)
    monkeypatch.setattr(lifecycle, "bind_turn_execution", fail_binding)
    monkeypatch.setattr(CerebrumRuntime, "_record_failed_turn_proposal", proposal)
    client, _ = gateway
    with client.websocket_connect("/api/realtime") as ws:
        result = _drive(
            ws,
            params={
                "threadId": "phase-driver-binding-failure",
                "input": [{"type": "text", "text": "hi"}],
                "model": "requested-external-model",
                "approvalPolicy": "never",
            },
        )

    completed = [n.params["turn"] for n in result["notifications"] if n.method == "turn/completed"]
    assert completed[-1]["status"] == "failed"
    assert completed[-1]["completedAt"]
    assert result["response"].error is None
    assert proposals[-1]["intent"].user_context["model_name"] == "requested-external-model"
    assert proposals[-1]["failure_source"] == "codex_app_server_exception"
