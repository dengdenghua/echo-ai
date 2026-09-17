"""Server-side project-intent detection, and its parity with the composer.

The same rule now exists in Python and TypeScript. Two copies of a regex drift,
and the failure is silent: the web app would keep suggesting a project while IM
users stopped getting the hint (or vice versa). The parity test reads the
TypeScript source and compares the pattern literals textually, in the
``test_max_tools_matches_the_broker`` style — a structural latch that fails the
moment one side is edited alone.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from runtime.sensing.gateway.project_intent_hint import (
    _PROJECT_INTENT_PATTERN_SOURCES,
    detect_project_intent,
)

_TS_SOURCE = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "core"
    / "threads"
    / "project-intent.ts"
)


@pytest.mark.parametrize(
    "text",
    [
        "开一个智能床笠项目",
        "创建一个新项目做竞品调研",
        "新建项目：客服机器人",
        "start a project for the new landing page",
        "let's kick off a project next week",
    ],
)
def test_proposals_are_detected(text: str) -> None:
    assert detect_project_intent(text) is not None


@pytest.mark.parametrize(
    "text",
    [
        "项目模式怎么用？",
        "帮我看一下这个项目的风险",
        "这个项目上周就交付了",
        "",
        "   ",
        "把项目文档发我",
    ],
)
def test_ordinary_project_talk_is_not_a_proposal(text: str) -> None:
    assert detect_project_intent(text) is None


@pytest.mark.parametrize(
    "text",
    [
        # ``立项`` and ``项目`` are separated by punctuation, and the pattern's
        # character class excludes it, so the trigger cannot reach the noun.
        "我们立项吧，做个内容平台项目",
        # The trigger word appears *after* the noun.
        "内容平台项目，我们立项吧",
    ],
)
def test_known_gap_a_trigger_separated_from_项目_is_missed(text: str) -> None:
    """Documents a real miss rather than asserting the behaviour is right.

    Widening this means editing the pattern in both the composer and the runtime
    (the parity latch enforces that), so it is a deliberate product change, not
    something to slip in while writing tests. Recorded here so the gap is
    visible and the decision stays explicit.
    """

    assert detect_project_intent(text) is None


def test_an_explicit_command_is_already_inside_project_os() -> None:
    """No point suggesting an entrance someone just walked through."""

    assert detect_project_intent("/project run 开一个智能床笠项目") is None
    assert detect_project_intent("/project report") is None


def test_whitespace_is_normalized_like_the_composer() -> None:
    detected = detect_project_intent("开一个\n\n智能床笠\t项目")

    assert detected == "开一个 智能床笠 项目"


def test_a_long_paste_is_bounded() -> None:
    """The scan is truncated so a huge paste cannot make matching unbounded."""

    detected = detect_project_intent("开一个项目" + "补充说明" * 500)

    assert detected is not None
    assert len(detected) <= 400


def test_the_patterns_match_the_composer_verbatim() -> None:
    """Parity latch: one side edited alone must fail here, not in production."""

    source = _TS_SOURCE.read_text(encoding="utf-8")
    # Scope the extraction to the array: the file contains other regex
    # literals (e.g. the whitespace normalizer) that must not be compared.
    # Terminate on ``] as const;`` rather than the first ``]``: the patterns
    # themselves contain a character class (``[^。！？，,;；]``) whose closing
    # bracket would truncate the block.
    block = re.search(
        r"PROJECT_INTENT_PATTERNS\s*=\s*\[(.*?)\]\s*as\s+const;",
        source,
        re.DOTALL,
    )
    assert block is not None, f"PROJECT_INTENT_PATTERNS array not found in {_TS_SOURCE}"
    ts_patterns = re.findall(r"^\s*/(.+?)/[gimsuy]*,\s*$", block.group(1), re.MULTILINE)

    assert ts_patterns, f"no regex literals found in {_TS_SOURCE}"
    assert len(ts_patterns) == len(_PROJECT_INTENT_PATTERN_SOURCES), (
        "the two sides declare a different number of patterns: "
        f"typescript={len(ts_patterns)} python={len(_PROJECT_INTENT_PATTERN_SOURCES)}"
    )
    for index, (ts_pattern, py_pattern) in enumerate(
        zip(ts_patterns, _PROJECT_INTENT_PATTERN_SOURCES, strict=True)
    ):
        assert ts_pattern == py_pattern, (
            f"pattern {index} drifted between the composer and the runtime:\n"
            f"  typescript: {ts_pattern}\n"
            f"  python:     {py_pattern}"
        )


def test_the_composer_still_declares_its_case_insensitive_english_pattern() -> None:
    """The Python side applies IGNORECASE only to the second pattern."""

    source = _TS_SOURCE.read_text(encoding="utf-8")
    english = [line for line in source.splitlines() if "\\bproject\\b" in line]

    assert english, "the English pattern disappeared from the composer"
    assert english[0].rstrip().endswith("/i,"), (
        "the composer's English pattern is no longer case-insensitive, so the "
        "runtime's IGNORECASE flag on that pattern is now wrong"
    )
