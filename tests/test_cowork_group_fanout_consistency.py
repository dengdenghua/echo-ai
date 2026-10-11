"""Group fan-out executes the plan, attributes every reply, and sees the thread.

Regression coverage for three group-response defects:

1. The fan-out roster was filtered by member kind only, so a member a person
   had taken over still answered and 数字员工 (``kind="role"``) never did.
2. Every fan-out bubble was projected into the room under the thread's bound
   agent because the message item carried no author id.
3. Ordinary group discussion ran every member with an isolated context, so
   "大家看看上面的迁移方案" reached all members without the plan above it.
"""

from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

from runtime.memory.cowork.context_steward import plan_group_context
from runtime.memory.cowork.group import ContextGrant, GroupState, Member
from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.service import invite_member, set_driver, set_mode
from runtime.memory.cowork.turn_plan import plan_turn
from runtime.memory.threads.event_log import EventLog
from runtime.platform.models import ParsedIntent
from runtime.protocol import AgentMessageItem, ItemStatus, Turn, TurnParams
from runtime.sensing.gateway._realtime_turn_lifecycle_helpers import (
    _inject_cowork_turn_plan,
    _persist_cowork_agent_messages,
)
from runtime.sensing.gateway._team_stream_group_fanout import (
    _drive_group_fanout,
    _select_fanout_members,
)

THREAD = "group-thread"
# The marker only appears in the earlier user message, never in member replies,
# so finding it in a prompt proves the member received that history.
PLAN_MARKER = "灰度窗口四十八小时"
PLAN_TEXT = f"迁移方案：订单库先双写到新集群，再回填历史数据，{PLAN_MARKER}后切换读流量。"
ELIGIBLE = ["alpha", "gamma", "emp"]


def _group(tmp_path, *, mode: str) -> GroupStore:
    store = GroupStore(base_dir=tmp_path / "group")
    invite_member(store, THREAD, actor="u", target_id="alpha", kind="agent")
    invite_member(store, THREAD, actor="u", target_id="beta", kind="agent")
    invite_member(store, THREAD, actor="u", target_id="gamma", kind="agent")
    invite_member(store, THREAD, actor="u", target_id="emp", kind="role", owner="owner-1")
    # A person now holds beta's wheel: no AI may answer as beta.
    set_driver(store, THREAD, actor="u", target_id="beta", driver="human")
    set_mode(store, THREAD, actor="u", mode=mode)
    return store


def _runtime(store: GroupStore, collaboration: Any = None) -> SimpleNamespace:
    return SimpleNamespace(
        _cowork_group_store=store,
        _collaboration_store=collaboration,
        _trace_store=None,
        _wrap_with_policy=lambda provider: provider,
        _drive_react=AsyncMock(side_effect=AssertionError("unexpected single-agent fallback")),
    )


def _fake_member_calls(monkeypatch) -> list[dict[str, str]]:
    calls: list[dict[str, str]] = []

    def fake_call_agent(**kwargs: Any) -> dict[str, Any]:
        agent_id = str(kwargs["agent_id"])
        calls.append({"agent_id": agent_id, "prompt": str(kwargs["prompt"])})
        return {
            "success": True,
            "output": f"结论：{agent_id} 建议先在预发环境演练一次，主要风险是回填期间主库负载升高。",
        }

    monkeypatch.setattr("runtime.execution.suckers.delegation_skills._call_agent", fake_call_agent)
    return calls


def _run_fanout(
    runtime: SimpleNamespace,
    tmp_path,
    text: str,
    context: dict[str, Any] | None = None,
) -> tuple[Turn, ParsedIntent]:
    turn = Turn(threadId=THREAD, params=TurnParams(threadId=THREAD))
    log = EventLog(tmp_path / "events.jsonl")
    log.turn_started(THREAD, turn)
    intent = ParsedIntent(
        raw=text,
        normalized_goal=text,
        intent_type="task",
        user_context=dict(context or {}),
    )
    _inject_cowork_turn_plan(runtime, thread_id=THREAD, text=text, intent=intent)
    asyncio.run(
        _drive_group_fanout(
            runtime,
            turn,
            log,
            SimpleNamespace(notify=AsyncMock(), is_turn_interrupted=lambda _: False),
            intent,
            text=text,
        )
    )
    return turn, intent


def _history(current: str) -> list[dict[str, str]]:
    return [
        {"role": "user", "content": PLAN_TEXT},
        {"role": "assistant", "content": "收到，这个方案先记下。"},
        {"role": "user", "content": current},
    ]


def test_gateway_persists_and_announces_fast_member_before_slow_member_finishes(
    tmp_path, monkeypatch
) -> None:
    release = threading.Event()
    slow_finished = threading.Event()

    def call_agent(**kwargs: Any) -> dict[str, Any]:
        agent_id = str(kwargs["agent_id"])
        if agent_id == "gamma":
            assert release.wait(3)
            slow_finished.set()
        return {
            "success": True,
            "output": f"结论：{agent_id} 建议先在预发环境演练一次，主要风险是回填期间主库负载升高。",
        }

    monkeypatch.setattr("runtime.execution.suckers.delegation_skills._call_agent", call_agent)
    runtime = _runtime(_group(tmp_path, mode="swarm"))
    turn = Turn(threadId=THREAD, params=TurnParams(threadId=THREAD))
    log = EventLog(tmp_path / "live-events.jsonl")
    log.turn_started(THREAD, turn)
    intent = ParsedIntent(
        raw="分头推进上线准备", normalized_goal="上线准备", intent_type="task", user_context={}
    )
    _inject_cowork_turn_plan(runtime, thread_id=THREAD, text=intent.raw, intent=intent)

    async def scenario() -> None:
        fast_visible = asyncio.Event()

        async def notify(method, payload) -> None:
            if method == "item/completed" and payload.get("item", {}).get("agentId") == "alpha":
                fast_visible.set()

        task = asyncio.create_task(
            _drive_group_fanout(
                runtime,
                turn,
                log,
                SimpleNamespace(notify=notify, is_turn_interrupted=lambda _: False),
                intent,
                text=intent.raw,
            )
        )
        try:
            await asyncio.wait_for(fast_visible.wait(), 2)
            assert not slow_finished.is_set()
            assert not task.done()
            assert any(
                isinstance(item, AgentMessageItem) and item.agent_id == "alpha"
                for item in turn.items
            )
        finally:
            release.set()
        await task
        messages = [item for item in turn.items if isinstance(item, AgentMessageItem)]
        for agent_id in ELIGIBLE:
            assert sum(item.agent_id == agent_id for item in messages) == 1

    asyncio.run(scenario())


class _RoomStore:
    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    def append_message(self, session_id: str, **payload: Any) -> int:
        source_id = payload["metadata"]["source_message_id"]
        if any(m["metadata"]["source_message_id"] == source_id for m in self.messages):
            raise ValueError("source_message_id already belongs to a different room message")
        self.messages.append({"session_id": session_id, **payload})
        return len(self.messages)


# ── 1. execution roster == plan ─────────────────────────────────────────────


def test_swarm_fanout_runs_exactly_the_planned_responders(tmp_path, monkeypatch) -> None:
    calls = _fake_member_calls(monkeypatch)
    runtime = _runtime(_group(tmp_path, mode="swarm"))

    _turn, intent = _run_fanout(runtime, tmp_path, "分头推进今天的上线准备")

    context = intent.user_context
    assert context["cowork_responders"] == ELIGIBLE
    assert context["team_pattern"]["execution"] == "fanout"
    assert [item["agent_id"] for item in context["agent_roster"]] == ELIGIBLE
    assert {call["agent_id"] for call in calls} == set(ELIGIBLE)


def test_group_request_fanout_never_answers_for_a_taken_over_member(tmp_path, monkeypatch) -> None:
    calls = _fake_member_calls(monkeypatch)
    runtime = _runtime(_group(tmp_path, mode="chat"))

    _turn, intent = _run_fanout(runtime, tmp_path, "大家看看上面的迁移方案")

    # Ordinary chat waits for a mention; the natural-language group request is
    # what widens this one turn to every member the AI may answer for.
    assert intent.user_context["cowork_responders"] == []
    assert intent.user_context["team_pattern"]["id"] == "parallel_roundtable"
    assert {call["agent_id"] for call in calls} == set(ELIGIBLE)


def test_chat_broadcast_reaches_digital_employees_but_not_takeovers(tmp_path, monkeypatch) -> None:
    calls = _fake_member_calls(monkeypatch)
    runtime = _runtime(_group(tmp_path, mode="chat"))

    _turn, intent = _run_fanout(runtime, tmp_path, "@所有人 各自说一句今天的进展")

    assert intent.user_context["cowork_responders"] == ELIGIBLE
    assert {call["agent_id"] for call in calls} == set(ELIGIBLE)


def test_plan_broadcast_counts_role_members_as_ai_participants() -> None:
    state = GroupState(
        roster=[
            Member("alpha", "agent", "participant", 0, ContextGrant()),
            Member("emp", "role", "participant", 0, ContextGrant(), accountable_owner="o"),
            Member("held", "role", "participant", 0, ContextGrant(), accountable_owner="o"),
        ],
        mode="chat",
    )
    state.roster[2].driver = "human"

    plan = plan_turn(state, "@all 说说看法")

    assert plan.responders == ["alpha", "emp"]


def test_planned_multi_responders_bound_execution_without_mentions() -> None:
    members = [{"name": name, "display_name": name} for name in ("alpha", "beta", "gamma")]

    selected, audit = _select_fanout_members(
        {
            "cowork_plan": {"addressed": [], "is_multi": True, "responders": ["alpha", "gamma"]},
            "cowork_responders": ["alpha", "gamma"],
        },
        members,
    )

    assert [member["name"] for member in selected] == ["alpha", "gamma"]
    assert audit["reason"] == "planned_responders"
    assert audit["excluded_agent_ids"] == ["beta"]


# ── 2. reply attribution ────────────────────────────────────────────────────


def test_each_fanout_reply_is_projected_under_its_own_member(tmp_path, monkeypatch) -> None:
    _fake_member_calls(monkeypatch)
    store = _group(tmp_path, mode="swarm")
    turn, intent = _run_fanout(
        _runtime(store),
        tmp_path,
        "分头推进今天的上线准备",
        context={"agent": "host-agent"},
    )
    intent.user_context.update(cowork_persistent_group=True, cowork_room_id="room-1")
    room = _RoomStore()

    _persist_cowork_agent_messages(
        SimpleNamespace(_cowork_group_store=store, _collaboration_store=room),
        thread_id=THREAD,
        turns=[turn],
        intent=intent,
    )

    by_participant: dict[str, list[dict[str, Any]]] = {}
    for message in room.messages:
        by_participant.setdefault(message["participant_id"], []).append(message)
    for agent_id in ELIGIBLE:
        replies = by_participant[f"agent:{agent_id}"]
        assert any(f"{agent_id} 建议" in reply["text"] for reply in replies)
        assert all(reply["metadata"]["agent_id"] == agent_id for reply in replies)
    assert "agent:beta" not in by_participant
    alpha = by_participant["agent:alpha"][0]["metadata"]
    emp = by_participant["agent:emp"][0]["metadata"]
    assert (alpha["sender_kind"], alpha["sender_driver"]) == ("agent", "ai")
    assert (emp["sender_kind"], emp["sender_driver"]) == ("role", "ai")


def test_projection_attributes_ai_text_to_the_ai_and_falls_back_to_thread_agent(
    tmp_path,
) -> None:
    store = GroupStore(base_dir=tmp_path / "group")
    invite_member(store, THREAD, actor="u", target_id="emp", kind="role", owner="owner-1")
    # The owner took the wheel after the AI had already produced its answer.
    set_driver(store, THREAD, actor="u", target_id="emp", driver="human")
    turn = Turn(
        threadId=THREAD,
        items=[
            AgentMessageItem(
                text="数字员工的回答",
                agentId="emp",
                agentDisplayName="Emp",
                status=ItemStatus.COMPLETED,
            ),
            AgentMessageItem(text="宿主的汇总", status=ItemStatus.COMPLETED),
        ],
    )
    intent = SimpleNamespace(
        user_context={
            "cowork_persistent_group": True,
            "cowork_room_id": "room-1",
            "agent": "coder",
        }
    )
    room = _RoomStore()

    projected = _persist_cowork_agent_messages(
        SimpleNamespace(_cowork_group_store=store, _collaboration_store=room),
        thread_id=THREAD,
        turns=[turn],
        intent=intent,
    )

    assert projected == 2
    member, host = room.messages
    assert member["participant_id"] == "agent:emp"
    assert member["display_name"] == "Emp"
    # Model output is never filed as human speech, even mid-takeover.
    assert (member["metadata"]["sender_kind"], member["metadata"]["sender_driver"]) == (
        "role",
        "ai",
    )
    assert host["participant_id"] == "agent:coder"
    assert host["display_name"] == "coder"
    assert host["metadata"]["agent_id"] == "coder"
    # Off-roster speakers stay explicitly unattributed instead of guessed.
    assert (host["metadata"]["sender_kind"], host["metadata"]["sender_driver"]) == (
        "unknown",
        "unknown",
    )


# ── 3. member context during group discussion ──────────────────────────────


def test_ordinary_group_discussion_members_see_the_referenced_history(
    tmp_path, monkeypatch
) -> None:
    calls = _fake_member_calls(monkeypatch)
    runtime = _runtime(_group(tmp_path, mode="chat"))
    text = "大家看看上面的迁移方案"

    _run_fanout(runtime, tmp_path, text, context={"conversation_messages": _history(text)})

    assert calls and all(PLAN_MARKER in call["prompt"] for call in calls)
    assert {call["agent_id"] for call in calls} == set(ELIGIBLE)


def test_swarm_roundtable_members_see_the_referenced_history(tmp_path, monkeypatch) -> None:
    calls = _fake_member_calls(monkeypatch)
    runtime = _runtime(_group(tmp_path, mode="swarm"))
    text = "围绕上面的迁移方案各自补充"

    _run_fanout(runtime, tmp_path, text, context={"conversation_messages": _history(text)})

    assert calls and all(PLAN_MARKER in call["prompt"] for call in calls)


def test_independent_candidate_roles_stay_isolated_in_adversarial_review(
    tmp_path, monkeypatch
) -> None:
    calls = _fake_member_calls(monkeypatch)
    runtime = _runtime(_group(tmp_path, mode="chat"))
    text = "大家评审一下上面的迁移方案有什么风险"

    _turn, intent = _run_fanout(
        runtime, tmp_path, text, context={"conversation_messages": _history(text)}
    )

    assert intent.user_context["team_pattern"]["id"] == "adversarial_review"
    by_agent: dict[str, list[str]] = {}
    for call in calls:
        by_agent.setdefault(call["agent_id"], []).append(call["prompt"])
    # Roster order assigns proposer → critic → verifier. The proposer must
    # produce an unanchored candidate; reviewers keep the shared history.
    assert by_agent["alpha"] and all(PLAN_MARKER not in prompt for prompt in by_agent["alpha"])
    assert all(PLAN_MARKER in prompt for prompt in by_agent["gamma"])
    assert all(PLAN_MARKER in prompt for prompt in by_agent["emp"])


def test_deictic_reference_keeps_the_preceding_shared_exchange_within_budget() -> None:
    history = [
        {"role": "user", "content": "周五团建去哪里吃饭？"},
        {"role": "assistant", "content": "随便，都可以。"},
        {"role": "user", "content": "订单库切到 TiDB：先双写，再回填，最后切读。"},
        {"role": "assistant", "content": "收到。"},
    ]

    plan = plan_group_context(
        "大家看看上面这个怎么样",
        [{"name": "a"}, {"name": "b"}],
        history,
    )

    for agent_id in ("a", "b"):
        brief = plan.for_agent(agent_id).shared_brief
        assert "TiDB" in brief
        # Only the immediately preceding exchange is pulled in, not all history.
        assert "团建" not in brief
