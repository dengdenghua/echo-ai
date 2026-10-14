"""Live-path ``## 交付文件`` ownership contract.

P1 #9 moved the deliverable section from "the model has to remember to write
it" to "the runtime renders it from the files the turn really wrote".  These
tests pin the live websocket half of that split:

* the answer lane gets exactly one canonical section, built from the
  ``file_changes`` the write primitives reported (never from prose);
* a hand-written copy of the section is replaced, not appended to;
* a mid-turn commentary beat stays exactly as the model wrote it;
* a turn that ends unsuccessfully loses the section again, so a failed or
  cancelled turn never claims files it did not deliver.
"""

from __future__ import annotations

from typing import Any

from tests.realtime_cerebrum._helpers import drive as _drive
from tests.realtime_cerebrum._helpers import set_script as _set_script

_DELIVERABLE_PATH = "notes/deliverable.md"


def _write_tool_script(*, text: str | None, **completion: Any) -> list[dict[str, Any]]:
    """A one-write turn: the tool reports a real file change, then prose."""

    script: list[dict[str, Any]] = [
        {
            "type": "tool_start",
            "tool_name": "write_text_file",
            "tool_call_id": "call-write",
        },
        {
            "type": "tool_end",
            "tool_name": "write_text_file",
            "tool_call_id": "call-write",
            "iteration": 1,
            "status": "success",
            "output_preview": "ok",
            "duration_ms": 1,
            "file_changes": [{"path": _DELIVERABLE_PATH, "op": "create"}],
        },
    ]
    if text is not None:
        script.append({"type": "text_delta", "delta": text})
    script.append({"type": "react_completed", **completion})
    return script


def _answer_snapshots(notifications: Any) -> list[dict[str, Any]]:
    """Every published ``agentMessage`` completion, in wire order.

    Item completions replace, so a re-published item appears here twice; that
    is exactly what the withdraw-on-failure path relies on.
    """

    return [
        note.params["item"]
        for note in notifications
        if note.method == "item/completed"
        and (note.params.get("item") or {}).get("type") == "agentMessage"
    ]


def _answer_items(notifications: Any) -> list[dict[str, Any]]:
    """Final published ``agentMessage`` snapshot per item id, in order."""

    seen: dict[str, dict[str, Any]] = {}
    for item in _answer_snapshots(notifications):
        seen[item["id"]] = item
    return list(seen.values())


def test_successful_turn_answer_carries_generated_deliverable_section(gateway: Any) -> None:
    client, _ = gateway
    _set_script(_write_tool_script(text="已按要求生成交付文件。"))
    with client.websocket_connect("/api/realtime") as ws:
        out = _drive(
            ws,
            {
                "threadId": "th_deliverable_ok",
                "input": [{"type": "text", "text": "写个文件"}],
                "approvalPolicy": "never",
            },
        )

    turn = out["response"].result["turn"]
    assert turn["status"] == "completed"
    answers = _answer_items(out["notifications"])
    assert len(answers) == 1
    text = answers[0]["text"]
    assert text.startswith("已按要求生成交付文件。")
    assert text.count("## 交付文件") == 1
    # Label rules live in the renderer's own unit tests; here the point is that
    # the *live item the UI renders* was rewritten by the runtime.
    assert "- [deliverable](" in text
    assert _DELIVERABLE_PATH in text.replace("\\", "/")
    # The item persisted on the turn snapshot is the same rewritten text.
    persisted = [it for it in turn["items"] if it["type"] == "agentMessage"]
    assert [it["text"] for it in persisted] == [text]


def test_hand_written_section_is_replaced_not_appended(gateway: Any) -> None:
    client, _ = gateway
    _set_script(
        _write_tool_script(
            text="完成。\n\n## 交付文件\n\n- [编的](/tmp/never-written.md)\n",
        )
    )
    with client.websocket_connect("/api/realtime") as ws:
        out = _drive(
            ws,
            {
                "threadId": "th_deliverable_replace",
                "input": [{"type": "text", "text": "写个文件"}],
                "approvalPolicy": "never",
            },
        )

    answers = _answer_items(out["notifications"])
    assert len(answers) == 1
    text = answers[0]["text"]
    assert text.count("## 交付文件") == 1
    assert "never-written" not in text
    assert "- [deliverable](" in text


def test_commentary_beat_never_gets_a_deliverable_section(gateway: Any) -> None:
    """Prose followed by another tool call is an in-progress beat."""

    client, _ = gateway
    _set_script(
        [
            {
                "type": "tool_start",
                "tool_name": "write_text_file",
                "tool_call_id": "call-write",
            },
            {
                "type": "tool_end",
                "tool_name": "write_text_file",
                "tool_call_id": "call-write",
                "iteration": 1,
                "status": "success",
                "output_preview": "ok",
                "duration_ms": 1,
                "file_changes": [{"path": _DELIVERABLE_PATH, "op": "create"}],
            },
            {"type": "text_delta", "delta": "我先写文件，再核对一遍。"},
            {"type": "tool_start", "tool_name": "read_text_file", "tool_call_id": "call-read"},
            {
                "type": "tool_end",
                "tool_name": "read_text_file",
                "tool_call_id": "call-read",
                "iteration": 2,
                "status": "success",
                "output_preview": "ok",
                "duration_ms": 1,
            },
            {"type": "react_completed"},
        ]
    )
    with client.websocket_connect("/api/realtime") as ws:
        out = _drive(
            ws,
            {
                "threadId": "th_deliverable_commentary",
                "input": [{"type": "text", "text": "写个文件"}],
                "approvalPolicy": "never",
            },
        )

    assert [n for n in out["notifications"] if n.method == "item/completed"]
    for item in _answer_items(out["notifications"]):
        assert "## 交付文件" not in item["text"], item["text"]


def test_unsuccessful_turn_reverts_an_already_published_section(gateway: Any) -> None:
    """The codex lane closes the answer before the outcome is known.

    A ``react_step_complete`` therefore publishes a section that a later
    ``react_completed(success=False)`` must take back — item completions
    replace, so the re-emitted snapshot wins on the client and on replay.
    """

    client, _ = gateway
    script = _write_tool_script(text="答案正文。")
    script.insert(-1, {"type": "react_step_complete"})
    script[-1] = {"type": "react_completed", "success": False}
    _set_script(script)
    with client.websocket_connect("/api/realtime") as ws:
        out = _drive(
            ws,
            {
                "threadId": "th_deliverable_failed",
                "input": [{"type": "text", "text": "写个文件"}],
                "approvalPolicy": "never",
            },
        )

    turn = out["response"].result["turn"]
    assert turn["status"] == "failed"
    # The publish-then-withdraw shape is real: the mid-turn snapshot really did
    # carry the section, so the assertions below are not vacuous.
    snapshots = _answer_snapshots(out["notifications"])
    assert any("## 交付文件" in snapshot["text"] for snapshot in snapshots)
    assert snapshots[-1]["text"] == "答案正文。"
    assert "## 交付文件" not in snapshots[-1]["text"]
    # And the replace wins: the final snapshot per item is the reverted one.
    answers = _answer_items(out["notifications"])
    assert [answer["text"] for answer in answers] == ["答案正文。"]
    # Nothing survives on the terminal turn snapshot either.
    for item in turn["items"]:
        if item["type"] == "agentMessage":
            assert "## 交付文件" not in item["text"]
