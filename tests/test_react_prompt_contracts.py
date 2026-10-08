"""Prompt-contract tests for the four contracts adopted from the
Kimi-desktop teardown (``docs/audits/kimi-desktop-unpack-2026-09-22.md``):

  1. a machine-readable ``## 交付文件`` deliverable section,
  2. one citation-placement rule plus the ``"citation"`` link title,
  3. two-turn confirmation before irreversible actions.

They also pin the cache invariant: the static contracts live in the stable
system prefix, while the per-turn irreversible-status note must ride in the
volatile prelude (a prepended user message), never in the system prompt.
"""

from __future__ import annotations

from runtime.core.cerebrum.react_prompt_contracts import (
    CITATION_LABEL_PREFIX,
    CITATION_PLACEMENT_CONTRACT,
    DELIVERABLE_CONTRACT,
    DELIVERABLE_HEADING,
    IRREVERSIBLE_ACTION_CONTRACT,
    IRREVERSIBLE_TURN_NOTE,
    SKILL_SELECTION_CONTRACT,
    STATIC_TURN_CONTRACTS,
    VISUAL_EXPRESSION_CONTRACT,
    citation_display_text,
    deliverable_label_is_canonical,
    explicit_confirmation_given,
    extract_deliverables,
    find_bare_urls,
    goal_is_explanatory,
    has_deliverables_section,
    irreversible_request_detected,
    irreversible_turn_note_for,
    requires_confirmation_before_execution,
)
from runtime.core.cerebrum.react_types import REACT_SYSTEM_PROMPT_BASE


def _run_texts(goal: str) -> tuple[str, str]:
    """Return ``(system_text, non_system_text)`` for a real assembled turn."""
    from tests.test_react_loop import (  # type: ignore[import-not-found]
        _CapturingRouter,
        _FakeStack,
        _intent,
        run_react_loop,
    )

    router = _CapturingRouter(["Final Answer: done"])
    run_react_loop(_FakeStack(router), _intent(goal), agent=None)
    messages = router.requests[0].messages
    system_text = str(messages[0].content or "")
    rest = "\n\n".join(str(message.content or "") for message in messages[1:])
    return system_text, rest


# ── static contracts reach the real system prompt ────────────────


def test_static_output_contracts_are_in_the_system_prompt() -> None:
    system_text, _ = _run_texts("列出当前目录")
    assert "<deliverable-contract>" in system_text
    assert DELIVERABLE_HEADING in system_text
    assert "<citation-placement>" in system_text
    assert "<irreversible-action>" in system_text


def test_base_prompt_points_at_the_irreversible_contract() -> None:
    assert "<irreversible-action>" in REACT_SYSTEM_PROMPT_BASE
    assert "未获下一条回复许可前不得执行" in REACT_SYSTEM_PROMPT_BASE


# ── cache invariant: per-turn status is volatile ─────────────────


def test_irreversible_status_note_stays_out_of_the_system_prompt() -> None:
    system_text, rest = _run_texts("把 build 目录里的临时文件全部删掉")
    assert "<irreversible-action-status>" not in system_text
    assert "<irreversible-action-status>" in rest


def test_explanatory_goal_gets_no_confirmation_note() -> None:
    _, rest = _run_texts("解释一下 rm -rf 会对仓库造成什么影响")
    assert "<irreversible-action-status>" not in rest


def test_tool_free_turn_gets_no_confirmation_note() -> None:
    # A turn that is explicitly forbidden from calling tools can never execute
    # the destructive action, so the turn-A note would only add noise.
    system_text, rest = _run_texts("不要使用任何工具，直接回答：删除 build 目录会有什么影响")
    assert "<direct-answer-contract>" in system_text
    assert "<irreversible-action-status>" not in rest


# ── deliverable contract ─────────────────────────────────────────


def test_deliverables_are_scoped_to_the_section() -> None:
    answer = (
        "我改好了。\n\n"
        "- [随便一个列表项](https://example.com/x)\n\n"
        f"{DELIVERABLE_HEADING}\n"
        "- [report](D:/out/report.md)\n"
        "- [chart](D:/out/chart.png)\n"
        "\n## 说明\n"
        "- [not_a_deliverable](D:/out/ignored.md)\n"
    )
    assert has_deliverables_section(answer)
    assert extract_deliverables(answer) == [
        ("report", "D:/out/report.md"),
        ("chart", "D:/out/chart.png"),
    ]


def test_missing_section_yields_no_deliverables() -> None:
    answer = "正文里提到 D:/out/report.md，但没有小节。\n- [report](D:/out/report.md)\n"
    assert not has_deliverables_section(answer)
    assert extract_deliverables(answer) == []


def test_deliverable_label_must_be_a_bare_file_name() -> None:
    assert deliverable_label_is_canonical("report")
    assert not deliverable_label_is_canonical("report.md")
    assert not deliverable_label_is_canonical("out/report")
    assert not deliverable_label_is_canonical(r"out\\report")


# ── citation contract ────────────────────────────────────────────


def test_citation_contract_names_both_link_kinds() -> None:
    assert CITATION_LABEL_PREFIX in CITATION_PLACEMENT_CONTRACT
    assert "句末" in CITATION_PLACEMENT_CONTRACT
    assert DELIVERABLE_HEADING in CITATION_PLACEMENT_CONTRACT
    assert "正斜杠" in CITATION_PLACEMENT_CONTRACT


def test_citation_display_text_matches_the_renderer_contract() -> None:
    # The frontend strips exactly this prefix (/^citation:(.+)$/) to decide
    # whether a link is a source badge or a local file reference.
    assert citation_display_text("citation:官方发布说明") == "官方发布说明"
    assert citation_display_text("citation: 发布说明") == "发布说明"
    assert citation_display_text("普通标题") is None
    assert citation_display_text("") is None


def test_bare_url_detection_ignores_markdown_links() -> None:
    linked = '见官方文档 [发布说明](https://example.com/notes "citation")。'
    assert find_bare_urls(linked) == []
    leaked = "见 https://example.com/notes 里的说明。"
    assert find_bare_urls(leaked) == ["https://example.com/notes"]


# ── irreversible-action gate ─────────────────────────────────────


def test_irreversible_intent_detection() -> None:
    assert irreversible_request_detected("rm -rf build/")
    assert irreversible_request_detected("git push --force origin main")
    assert irreversible_request_detected("请把 build 目录删除")
    assert irreversible_request_detected("overwrite the release branch")
    assert not irreversible_request_detected("帮我看看这个函数怎么改")
    assert not irreversible_request_detected("")


def test_confirmation_must_be_a_whole_message_go_ahead() -> None:
    assert explicit_confirmation_given("确认")
    assert explicit_confirmation_given("可以")
    assert explicit_confirmation_given("好")
    assert explicit_confirmation_given("yes")
    assert explicit_confirmation_given("go ahead")
    # Restating the task is not permission.
    assert not explicit_confirmation_given("把 build 目录删掉")
    assert not explicit_confirmation_given("可以帮我把 build 目录删掉吗")
    # A long message that merely contains a confirmation word is not permission.
    assert not explicit_confirmation_given("确认这个方案没问题以后，我们再讨论别的 " + "补" * 40)
    assert not explicit_confirmation_given("")


def test_gate_requires_a_second_turn_for_destructive_requests() -> None:
    # Turn A: the request itself -> must not execute.
    assert requires_confirmation_before_execution("把 build 目录删除")
    # Turn B: the user's next reply is an explicit go-ahead -> may execute.
    assert not requires_confirmation_before_execution("确认")
    # Non-destructive work is never gated.
    assert not requires_confirmation_before_execution("帮我把这个函数重命名一下")


def test_contract_texts_are_non_empty_and_marked() -> None:
    for name, body in (
        ("deliverable", DELIVERABLE_CONTRACT),
        ("citation", CITATION_PLACEMENT_CONTRACT),
        ("irreversible", IRREVERSIBLE_ACTION_CONTRACT),
        ("skill-selection", SKILL_SELECTION_CONTRACT),
    ):
        assert body.startswith("\n<"), name
        assert body.endswith(">"), name
        assert len(body) > 200, name


# ── one shared definition for every assembly path ────────────────


def test_static_turn_contracts_are_the_same_objects_every_path_imports() -> None:
    # The native tool-call loop used to write its own prompt and deliver none
    # of these; it now imports this exact tuple, so the two paths cannot drift.
    assert STATIC_TURN_CONTRACTS == (
        DELIVERABLE_CONTRACT,
        CITATION_PLACEMENT_CONTRACT,
        IRREVERSIBLE_ACTION_CONTRACT,
        SKILL_SELECTION_CONTRACT,
        VISUAL_EXPRESSION_CONTRACT,
    )
    assert len(set(STATIC_TURN_CONTRACTS)) == 5


def test_skill_selection_contract_forbids_batch_loading() -> None:
    assert "search_skills" in SKILL_SELECTION_CONTRACT
    assert "query_skill" in SKILL_SELECTION_CONTRACT
    assert "禁止批量" in SKILL_SELECTION_CONTRACT


def test_skill_selection_contract_reaches_a_tool_active_turn() -> None:
    """The skill-order rule is gated on tools, so assert it on a tool turn.

    ``_FakeStack`` has no executor, which makes every turn tool-free and skips
    the tool-use contract by design. Backing it with a real (if tiny) registry
    is what puts the turn on the tool path.
    """
    from runtime.execution.suckers.registry import Skill, SkillRegistry  # noqa: PLC0415
    from runtime.execution.tool_engine.executor import ToolExecutor  # noqa: PLC0415
    from runtime.safety.auth import TrustEngine  # noqa: PLC0415
    from tests.test_react_loop import (  # type: ignore[import-not-found]  # noqa: PLC0415
        _CapturingRouter,
        _FakeStack,
        _intent,
        run_react_loop,
    )

    router = _CapturingRouter(["Final Answer: done"])
    stack = _FakeStack(router)
    registry = SkillRegistry()
    registry.register(
        Skill(
            name="read_file",
            description="Read a file.",
            affinity=["file"],
            trusted_source="skill://public/read_file",
            handler=lambda **_kwargs: {"ok": True},
        ),
        verify_tests=False,
    )
    stack.executor = ToolExecutor(registry, TrustEngine())

    run_react_loop(stack, _intent("列出当前目录"), agent=None)
    system_text = str(router.requests[0].messages[0].content or "")
    assert "<tool-use-contract>" in system_text
    assert VISUAL_EXPRESSION_CONTRACT in system_text
    assert SKILL_SELECTION_CONTRACT in system_text
    assert "<skill-selection>" in system_text


# ── explanatory goals are questions, not requests ────────────────


def test_goal_is_explanatory_recognises_questions_about_an_action() -> None:
    for goal in (
        "解释一下 rm -rf 的作用",
        "说明一下 drop table 的后果",
        "what does git reset --hard do",
        "rm -rf 和 rm -r 的区别",
    ):
        assert goal_is_explanatory(goal), goal
    for goal in ("把 build 目录删除", "git push --force origin main", ""):
        assert not goal_is_explanatory(goal), goal


def test_irreversible_turn_note_fires_only_for_turn_a() -> None:
    # Turn A: the destructive request itself -> the note is injected.
    assert irreversible_turn_note_for("把 build 目录删除") == IRREVERSIBLE_TURN_NOTE
    # Turn B: an explicit go-ahead -> the note is gone, execution may proceed.
    assert irreversible_turn_note_for("确认") == ""
    # Explanatory goals mention the command without asking for it.
    assert irreversible_turn_note_for("解释一下 rm -rf 的作用") == ""
    # Ordinary non-destructive work is untouched.
    assert irreversible_turn_note_for("帮我重命名这个函数") == ""
    assert IRREVERSIBLE_TURN_NOTE.startswith("<irreversible-action-status>")
