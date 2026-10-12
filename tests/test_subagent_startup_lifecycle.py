"""Startup refusal never looks like a running child on any observation lane."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from runtime.execution.subagents import bridge, event_bus
from runtime.execution.subagents.governance import governance_store
from runtime.memory.journal import InMemoryJournal
from runtime.platform.budget import UsagePricing
from runtime.platform.process.session import Session, session_scope
from runtime.protocol.items import ItemMarker
from tests.test_isolated_subagent import _host
from tests.test_worktree_loop import _worktree_count


@pytest.fixture(autouse=True)
def isolated_lifecycle(monkeypatch):
    event_bus.reset_for_tests()
    monkeypatch.setattr(bridge, "_REGISTRY", None)
    monkeypatch.setattr(UsagePricing, "get", lambda: SimpleNamespace(is_over_budget=lambda: False))
    yield
    event_bus.reset_for_tests()


@pytest.mark.parametrize("gate", ["budget", "slot", "lease_error", "lease_refused", "depth"])
def test_admission_refusal_emits_only_failure_with_the_original_reason(monkeypatch, gate):
    journal = InMemoryJournal()
    received = []
    parent = Session(thread_id=f"startup-{gate}", metadata={"journal": journal})
    calls = []
    if gate == "budget":
        monkeypatch.setattr(
            UsagePricing,
            "get",
            lambda: SimpleNamespace(
                is_over_budget=lambda: True,
                total_cost_usd=2.0,
                config=SimpleNamespace(budget_usd=1.0),
            ),
        )
    elif gate == "slot":
        monkeypatch.setattr(bridge, "MAX_ACTIVE_SUBAGENTS", 0)
    elif gate == "depth":
        parent.metadata["_subagent_depth"] = bridge.MAX_SUBAGENT_DEPTH
    elif gate == "lease_refused":
        monkeypatch.setattr(governance_store(), "acquire", lambda *_args, **_kwargs: None)
    else:

        def unavailable(*_args, **_kwargs):
            raise OSError("governance storage unavailable")

        monkeypatch.setattr(governance_store(), "acquire", unavailable)

    with session_scope(parent):
        result = bridge.call_subagent(
            "custom_researcher",
            "research",
            session=parent,
            runner=lambda *_args, **_kwargs: calls.append("ran") or "done",
            event_emitter=received.append,
        )

    assert not calls and result["success"] is False
    assert [item["type"] for item in received] == ["subagent_finished"]
    assert received[0]["ok"] is False and received[0]["error"] == result["error"]
    wire = event_bus.get_bus(parent.thread_id).replay()
    assert [item["type"] for item in wire] == ["sub_failed"]
    assert wire[0]["payload"]["error"] == result["error"]
    assert [
        getattr(item, "tool_name", None)
        for item in journal.read_all()
        if hasattr(item, "tool_name")
    ] == [ItemMarker.SUBAGENT_FINISHED.value]
    assert bridge.active_subagent_count() == 0


def test_monitored_success_announces_start_on_the_worker_before_the_runner():
    journal = InMemoryJournal()
    received = []
    parent = Session(thread_id="startup-success", metadata={"journal": journal})

    def runner(*_args, **_kwargs):
        assert [item["type"] for item in received] == ["subagent_spawned"]
        assert any(
            item.tool_name == ItemMarker.SUBAGENT_SPAWNED.value for item in journal.read_all()
        )
        assert [item["type"] for item in event_bus.get_bus(parent.thread_id).replay()] == [
            "sub_started"
        ]
        return "usable result"

    with session_scope(parent):
        result = bridge.call_subagent(
            "custom_researcher",
            "research",
            session=parent,
            runner=runner,
            event_emitter=received.append,
            timeout_seconds=5,
        )
    assert result["success"] is True
    assert [item["type"] for item in received] == ["subagent_spawned", "subagent_finished"]
    assert [item["type"] for item in event_bus.get_bus(parent.thread_id).replay()] == [
        "sub_started",
        "sub_concluded",
    ]


def test_child_identity_preparation_failure_has_a_terminal_reason(monkeypatch):
    from runtime.execution.subagents import threading as child_threading

    def unavailable(*_args, **_kwargs):
        raise OSError("child identity storage unavailable")

    monkeypatch.setattr(child_threading, "forge_subagent_thread", unavailable)
    parent = Session(thread_id="startup-identity")
    received = []
    result = bridge.call_subagent(
        "custom_researcher",
        "research",
        session=parent,
        runner=lambda *_args, **_kwargs: pytest.fail("unprepared child must not run"),
        event_emitter=received.append,
    )
    assert result["success"] is False and result["status"] == "startup_failed"
    assert "child identity storage unavailable" in result["error"]
    assert [item["type"] for item in received] == ["subagent_finished"]
    assert received[0]["error"] == result["error"]


def test_real_isolated_workspace_preparation_failure_never_announces_running(tmp_path):
    repo, parent, _log = _host(tmp_path)
    journal = InMemoryJournal()
    parent.metadata["journal"] = journal
    received = []
    with session_scope(parent):
        result = bridge.call_subagent(
            "coder",
            "implement",
            session=parent,
            isolate=True,
            input_files=["missing-input.txt"],
            runner=lambda *_args, **_kwargs: pytest.fail("unprepared workspace must not run"),
            event_emitter=received.append,
            timeout_seconds=5,
        )
    assert result["success"] is False and result["status"] == "isolation_failed"
    assert [item["type"] for item in received] == ["subagent_finished"]
    assert received[0]["error"] == result["error"]
    assert [
        getattr(item, "tool_name", None)
        for item in journal.read_all()
        if hasattr(item, "tool_name")
    ] == [ItemMarker.SUBAGENT_FINISHED.value]
    assert _worktree_count(repo) == 1
