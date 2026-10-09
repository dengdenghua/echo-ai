"""Tests for deterministic deliverable rendering (Kimi teardown §3 P1-9).

The contract lives in ``react_prompt_contracts`` (what the model was told);
this module owns the other half — the runtime *producing* the section, so the
format cannot drift with model behaviour.
"""

from __future__ import annotations

from pathlib import Path

from runtime.core.cerebrum.deliverable_rendering import (
    deliverable_label,
    deliverable_line,
    deliverable_target,
    finalize_deliverables,
    render_deliverables_section,
    strip_deliverables_section,
    unique_paths,
)
from runtime.core.cerebrum.react_prompt_contracts import (
    DELIVERABLE_HEADING,
    deliverable_label_is_canonical,
    extract_deliverables,
)

# ── labels and links ─────────────────────────────────────────────────


def test_label_is_bare_name_without_extension() -> None:
    assert deliverable_label("D:/echo-ai/docs/report.md") == "report"
    assert deliverable_label("D:\\echo-ai\\docs\\report.md") == "report"
    assert deliverable_label("archive.tar.gz") == "archive"
    assert deliverable_label("no_extension") == "no_extension"


def test_target_is_absolute_with_forward_slashes() -> None:
    target = deliverable_target("D:\\echo-ai\\docs\\report.md")

    assert target == "D:/echo-ai/docs/report.md"
    assert Path(target).is_absolute()


def test_rendered_line_satisfies_the_prompt_contract_validator() -> None:
    line = deliverable_line("D:/echo-ai/docs/audit notes.md")

    assert line == "- [audit notes](D:/echo-ai/docs/audit notes.md)"
    label = line.split("](")[0].removeprefix("- [")
    assert deliverable_label_is_canonical(label)
    # Round-trips through the contract's own reader.
    assert extract_deliverables(f"{DELIVERABLE_HEADING}\n\n{line}") == [
        ("audit notes", "D:/echo-ai/docs/audit notes.md")
    ]


# ── section rendering ────────────────────────────────────────────────


def test_section_is_empty_when_nothing_was_produced() -> None:
    assert render_deliverables_section([]) == ""
    assert render_deliverables_section(["", "   "]) == ""


def test_section_keeps_first_touch_order_and_dedupes() -> None:
    section = render_deliverables_section(
        [
            "D:/echo-ai/b.md",
            "D:/echo-ai/a.md",
            "d:/ECHO-AI/B.md",  # same file, different case + separator
            "D:/echo-ai/a.md",
        ]
    )

    assert section.splitlines()[0] == DELIVERABLE_HEADING
    assert [line for line in section.splitlines() if line.startswith("- ")] == [
        "- [b](D:/echo-ai/b.md)",
        "- [a](D:/echo-ai/a.md)",
    ]


def test_unique_paths_keeps_case_on_posix_paths() -> None:
    assert unique_paths(["/tmp/a.md", "/tmp/A.md"]) == ["/tmp/a.md", "/tmp/A.md"]


def test_section_summarises_beyond_the_limit() -> None:
    paths = [f"D:/echo-ai/file{i}.md" for i in range(5)]

    section = render_deliverables_section(paths, limit=2)

    bullets = [line for line in section.splitlines() if line.startswith("- ")]
    assert len(bullets) == 3
    assert bullets[-1] == "- …另有 3 个文件未列出"


# ── strip / finalize ─────────────────────────────────────────────────


def test_strip_removes_only_a_trailing_section() -> None:
    text = f"正文。\n\n{DELIVERABLE_HEADING}\n\n- [a](D:/a.md)"

    assert strip_deliverables_section(text) == "正文。"


def test_strip_leaves_prose_that_merely_mentions_the_heading() -> None:
    text = f"我按 {DELIVERABLE_HEADING} 这个标题写，但后面还有正文。"

    assert strip_deliverables_section(text) == text


def test_finalize_replaces_a_hand_written_section_with_the_canonical_one() -> None:
    text = f"完成了。\n\n{DELIVERABLE_HEADING}\n\n- [wrong](D:/wrong.md)"

    result = finalize_deliverables(text, ["D:/echo-ai/real.md"])

    assert "D:/wrong.md" not in result
    assert result == "完成了。\n\n" + render_deliverables_section(["D:/echo-ai/real.md"])


def test_finalize_is_idempotent() -> None:
    once = finalize_deliverables("完成了。", ["D:/echo-ai/real.md"])

    assert finalize_deliverables(once, ["D:/echo-ai/real.md"]) == once


def test_finalize_without_paths_only_normalises() -> None:
    text = f"完成了。\n\n{DELIVERABLE_HEADING}\n\n- [a](D:/a.md)"

    assert finalize_deliverables(text, []) == "完成了。"
    assert finalize_deliverables("完成了。", []) == "完成了。"
    assert finalize_deliverables("", []) == ""
