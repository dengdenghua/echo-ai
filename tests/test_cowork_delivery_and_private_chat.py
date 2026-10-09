import json
from types import SimpleNamespace

import pytest

from runtime.protocol import AgentMessageItem, CommandExecutionItem, ItemStatus, McpToolCallItem
from runtime.sensing.gateway._realtime_turn_lifecycle_helpers import (
    _turn_has_cowork_coordination_evidence,
    _turn_has_cowork_delivery_evidence,
)


def answer():
    return AgentMessageItem(text="汇总结果", message_kind="answer", status=ItemStatus.COMPLETED)


@pytest.mark.parametrize("mcp", [False, True])
def test_queue_acceptance_is_not_delivery_but_observed_results_are(mcp):
    result = {"accepted": True, "status": "pending", "completed": False, "output": ""}
    item = (
        McpToolCallItem(
            server="echo",
            tool="dynamic__call_agent",
            result={"content": [{"type": "text", "text": json.dumps(result)}]},
            status=ItemStatus.COMPLETED,
        )
        if mcp
        else CommandExecutionItem(
            command="call_agent", aggregated_output=json.dumps(result), status=ItemStatus.COMPLETED
        )
    )
    turn = SimpleNamespace(items=[item, answer()])
    assert _turn_has_cowork_coordination_evidence(turn)
    assert not _turn_has_cowork_delivery_evidence(turn)
    observed = McpToolCallItem(
        server="echo",
        tool="dynamic__collaboration",
        status=ItemStatus.COMPLETED,
        result={
            "current_task_id": "leader",
            "tasks": [
                {"id": "child", "parent_task_id": "leader", "status": "done", "result": "交付"},
                {"id": "old", "parent_task_id": "another-turn", "status": "working"},
            ],
        },
    )
    turn.items.extend([observed, answer()])
    assert _turn_has_cowork_delivery_evidence(turn)
    observed.result["tasks"][0]["status"] = "working"
    assert not _turn_has_cowork_delivery_evidence(turn)


def test_historical_deliveries_and_failed_tools_do_not_count():
    turn = SimpleNamespace(
        items=[
            McpToolCallItem(
                server="echo",
                tool="dynamic__collaboration",
                status=ItemStatus.COMPLETED,
                result={
                    "current_task_id": "new",
                    "tasks": [{"parent_task_id": "old", "status": "done", "result": "旧结果"}],
                },
            ),
            answer(),
        ]
    )
    assert not _turn_has_cowork_coordination_evidence(turn)
    assert not _turn_has_cowork_delivery_evidence(turn)
    turn.items[0] = McpToolCallItem(
        server="echo",
        tool="dynamic__call_agent",
        status=ItemStatus.COMPLETED,
        result={"success": False, "error": "unavailable"},
    )
    assert not _turn_has_cowork_coordination_evidence(turn)


def test_private_identity_survives_snapshot_and_followup(tmp_path):
    from runtime.memory.threads.event_log import EventLog
    from runtime.memory.threads.store import ThreadStateStore
    from runtime.sensing.gateway._realtime_cerebrum_thread import _snapshot_to_thread_store
    from runtime.sensing.gateway.turn_session import build_turn_metadata

    store = ThreadStateStore(tmp_path / "threads.jsonl")
    metadata = build_turn_metadata(
        thread_id="private-kane",
        body={"context": {"agent_name": "kane", "private_conversation": True}},
        store=store,
    )
    runtime = SimpleNamespace(_thread_store=store)
    _snapshot_to_thread_store(
        runtime,
        "private-kane",
        EventLog(tmp_path / "events.jsonl"),
        SimpleNamespace(user_context=metadata),
    )
    saved = store.get("private-kane")["metadata"]
    assert saved["private_conversation"] is True and saved["agent"] == "kane"
    next_turn = build_turn_metadata(
        thread_id="private-kane", body={"context": {"agent_name": "eve"}}, store=store
    )
    assert next_turn["private_conversation"] is True and next_turn["agent_name"] == "kane"
    assert not next_turn.get("agent_roster") and not next_turn.get("team_id")
