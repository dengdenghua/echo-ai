"""Coverage probe: which real group requests route to a deliverable path.

``select_team_pattern`` decides, without a model call, whether a group message
gets one member's chat bubble, everyone's bubbles, or the coordinator's
decompose → dispatch → merge path. The deliverable detector is a regex, so its
blind spots are wherever a user phrases real work in words the pattern does not
list.

This file measures that rather than asserting a vibe. Each case below is phrased
the way someone actually types in a room, with the routing it *should* get.
Failures here are not necessarily bugs to fix by widening the regex — a miss may
be acceptable — but they must be visible and deliberate rather than discovered
in production, which is why the expected sets are written out explicitly.
"""

from __future__ import annotations

import pytest

from runtime.execution.agents.team_patterns import (
    requires_coordinated_execution,
    select_team_pattern,
)

# Requests that need a real, verifiable deliverable: a bubble lane has no tools,
# so routing these to it produces promises instead of work.
_DELIVERABLE_REQUESTS = [
    "研究一下竞品的定价策略",
    "写一份上季度的复盘报告",
    "帮我修复登录页的报错",
    "调研三家供应商并给出对比",
    "整理成一份可以发给客户的文档",
    "做一个下个月的推广方案",
    "把接口文档导出来",
    "部署到测试环境验证一下",
]

# Requests that are genuinely conversational: opinions, not artifacts.
_CONVERSATIONAL_REQUESTS = [
    "大家觉得这个配色怎么样",
    "你们对这个命名有意见吗",
    "各位看看这个思路顺不顺",
    "大家好",
    "这个方向我觉得可以，你们呢",
    # Why the artifact-noun rule uses 写/做 and not 出/交: these mention an
    # artifact while asking for opinions, and reading them as execution intent
    # would turn a discussion into a task graph.
    "大家觉得他提出的方案怎么样",
    "上次交的报告你们看了吗",
    "这个计划看起来还行吧",
]


@pytest.mark.parametrize("text", _DELIVERABLE_REQUESTS)
def test_deliverable_requests_are_detected(text: str) -> None:
    assert requires_coordinated_execution(text), (
        f"{text!r} needs a real deliverable but the detector missed it, so a "
        "multi-member room would answer it with tool-less chat bubbles"
    )


@pytest.mark.parametrize("text", _CONVERSATIONAL_REQUESTS)
def test_conversational_requests_are_not_forced_into_execution(text: str) -> None:
    assert not requires_coordinated_execution(text), (
        f"{text!r} is a request for opinions; routing it through the coordinator "
        "would turn a quick question into a task graph"
    )


@pytest.mark.parametrize("text", _DELIVERABLE_REQUESTS)
def test_deliverable_requests_reach_the_coordinator_in_a_team_room(text: str) -> None:
    """The routing consequence of the detection above, in cluster mode."""

    decision = select_team_pattern(text, mode="cluster", member_count=3)
    assert decision.spec.execution == "orchestrated", (
        f"{text!r} routed to {decision.spec.execution!r} ({decision.spec.id}) "
        "instead of the coordinator"
    )


def test_a_bare_acceptance_mention_stays_conversational() -> None:
    """Pinned by a comment in the source: "用于界面验收" is not execution intent."""

    assert not requires_coordinated_execution("大家给个简短回复，用于界面验收")


def test_a_greeting_does_not_wake_the_whole_room() -> None:
    decision = select_team_pattern("大家好", mode="chat", member_count=5)
    assert decision.spec.execution == "focused"


def test_review_intent_escalates_to_adversarial_review() -> None:
    decision = select_team_pattern(
        "大家一起评审这个方案的风险",
        mode="swarm",
        member_count=4,
    )
    assert decision.spec.id == "adversarial_review"
    assert decision.spec.debate_rounds >= 2


def test_a_terse_followup_is_recovered_by_the_coordinator() -> None:
    """Broadcasting "???" made each persona invent a different missing context."""

    for text in ("???", "怎么回事", "继续"):
        decision = select_team_pattern(text, mode="swarm", member_count=4)
        assert decision.spec.execution == "focused", text


def test_one_mention_narrows_the_turn_regardless_of_mode() -> None:
    decision = select_team_pattern(
        "研究一下竞品定价",
        mode="swarm",
        member_count=4,
        addressed_count=1,
    )
    assert decision.spec.execution == "focused"


def test_a_single_member_room_never_orchestrates() -> None:
    """With nobody to dispatch to, coordination is overhead."""

    decision = select_team_pattern("写一份复盘报告", mode="cluster", member_count=1)
    assert decision.spec.execution == "focused"
