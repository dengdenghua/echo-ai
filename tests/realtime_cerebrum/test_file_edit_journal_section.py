"""Live-path ``fileEdits`` contract (P1 #15).

The journal module owns the merging and the honesty rules; these tests pin the
websocket half of that split:

* a write turn publishes one entry per file it touched, in first-touch order;
* the hashes describe the bytes really on disk, and ``reversible`` says whether
  the record alone could put the file back;
* touching the same file twice merges into one entry with ``touches`` > 1;
* a file the runtime cannot read journals as ``unknown`` — never guessed;
* nothing that rides the turn frame carries file contents.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from runtime.core.cerebrum.file_edit_journal import normalize_journal_path
from tests.realtime_cerebrum._helpers import (
    drive as _drive,
)
from tests.realtime_cerebrum._helpers import (
    set_script as _set_script,
)

_REL = "notes/journal.md"


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _write_call(
    *,
    call_id: str,
    rel: str = _REL,
    op: str = "create",
    diff: str | None = None,
    iteration: int = 1,
) -> list[dict[str, Any]]:
    """One ``write_text_file`` tool round reporting a single file change."""

    change: dict[str, Any] = {"path": rel, "op": op}
    if diff is not None:
        change["diff"] = diff
    return [
        {
            "type": "tool_start",
            "tool_name": "write_text_file",
            "tool_call_id": call_id,
        },
        {
            "type": "tool_end",
            "tool_name": "write_text_file",
            "tool_call_id": call_id,
            "iteration": iteration,
            "status": "success",
            "output_preview": "ok",
            "duration_ms": 1,
            "file_changes": [change],
        },
    ]


def _run(
    gateway: Any,
    tmp_path: Path,
    script: list[dict[str, Any]],
    *,
    thread_id: str,
) -> dict[str, Any]:
    client, _ = gateway
    _set_script(script)
    with client.websocket_connect("/api/realtime") as ws:
        out = _drive(
            ws,
            {
                "threadId": thread_id,
                "cwd": str(tmp_path),
                "input": [{"type": "text", "text": "write a file"}],
                "approvalPolicy": "never",
            },
        )
    turn = out["response"].result["turn"]
    assert turn["status"] == "completed"
    return turn


def test_create_entry_describes_real_bytes_and_stays_content_free(
    gateway: Any, tmp_path: Path
) -> None:
    target = tmp_path / _REL
    target.parent.mkdir(parents=True)
    target.write_text("hello journal", encoding="utf-8")

    turn = _run(
        gateway,
        tmp_path,
        [*_write_call(call_id="call-1"), {"type": "react_completed"}],
        thread_id="th_journal_create",
    )

    edits = turn["fileEdits"]
    assert len(edits) == 1
    entry = edits[0]
    assert entry["path"] == normalize_journal_path(target)
    assert entry["op"] == "create"
    assert entry["afterSha256"] == _sha("hello journal")
    # A create has no before-state to lose: it is known, not inferred.
    assert entry["beforeSource"] == "recorded"
    assert entry["reversible"] is True
    assert entry["reason"] == ""
    assert entry["touches"] == 1
    # The published frame carries hashes and verdicts, never contents.
    assert "hello journal" not in json.dumps(turn)


def test_update_entry_derives_before_from_the_reported_diff(gateway: Any, tmp_path: Path) -> None:
    target = tmp_path / _REL
    target.parent.mkdir(parents=True)
    target.write_text("value = 1", encoding="utf-8")
    diff = (
        "--- a/notes/journal.md\n+++ b/notes/journal.md\n@@ -1,1 +1,1 @@\n"
        "-value = 0\n\\ No newline at end of file\n"
        "+value = 1\n\\ No newline at end of file\n"
    )

    turn = _run(
        gateway,
        tmp_path,
        [
            *_write_call(call_id="call-1", op="update", diff=diff),
            {"type": "react_completed"},
        ],
        thread_id="th_journal_update",
    )

    entry = turn["fileEdits"][0]
    assert entry["op"] == "update"
    assert entry["afterSha256"] == _sha("value = 1")
    # ``before`` is the diff reversed onto the after-content read from disk.
    assert entry["beforeSource"] == "derived"
    assert entry["beforeSha256"] == _sha("value = 0")
    assert entry["reversible"] is True


def test_repeat_touch_of_one_file_merges_into_a_single_entry(gateway: Any, tmp_path: Path) -> None:
    target = tmp_path / _REL
    target.parent.mkdir(parents=True)
    target.write_text("second", encoding="utf-8")

    turn = _run(
        gateway,
        tmp_path,
        [
            *_write_call(call_id="call-1", op="create"),
            *_write_call(call_id="call-2", op="update", iteration=2),
            {"type": "react_completed"},
        ],
        thread_id="th_journal_merge",
    )

    edits = turn["fileEdits"]
    assert len(edits) == 1
    entry = edits[0]
    assert entry["touches"] == 2
    # The first touch owns ``before``; the last one owns ``after``.
    assert entry["op"] == "create"
    assert entry["beforeSource"] == "recorded"
    assert entry["afterSha256"] == _sha("second")


def test_turn_that_ends_by_deleting_does_not_publish_stale_contents(
    gateway: Any, tmp_path: Path
) -> None:
    target = tmp_path / _REL
    target.parent.mkdir(parents=True)
    target.write_text("value = 1", encoding="utf-8")
    diff = (
        "--- a/notes/journal.md\n+++ b/notes/journal.md\n@@ -1,1 +1,1 @@\n"
        "-value = 0\n\\ No newline at end of file\n"
        "+value = 1\n\\ No newline at end of file\n"
    )

    turn = _run(
        gateway,
        tmp_path,
        [
            *_write_call(call_id="call-1", op="update", diff=diff),
            *_write_call(call_id="call-2", op="delete", iteration=2),
            {"type": "react_completed"},
        ],
        thread_id="th_journal_update_delete",
    )

    edits = turn["fileEdits"]
    assert len(edits) == 1
    entry = edits[0]
    # The file is gone, so neither the op nor the after-hash may still
    # describe the bytes the earlier touch left behind.
    assert entry["op"] == "delete"
    assert entry["afterSha256"] == ""
    assert entry["touches"] == 2
    # Only the derived before-state survives, and it still undoes the turn.
    assert entry["beforeSource"] == "derived"
    assert entry["beforeSha256"] == _sha("value = 0")
    assert entry["reversible"] is True


def test_unreadable_after_content_is_unknown_never_guessed(gateway: Any, tmp_path: Path) -> None:
    # No file on disk: the change is real, the bytes are not locatable.
    turn = _run(
        gateway,
        tmp_path,
        [*_write_call(call_id="call-1", op="update"), {"type": "react_completed"}],
        thread_id="th_journal_unknown",
    )

    entry = turn["fileEdits"][0]
    assert entry["op"] == "update"
    assert entry["afterSha256"] == ""
    assert entry["beforeSha256"] == ""
    assert entry["beforeSource"] == "unknown"
    assert entry["reason"] == "after_not_captured"
    assert entry["reversible"] is False


def test_delete_entry_journals_without_reading_the_file(gateway: Any, tmp_path: Path) -> None:
    # The file is still on disk here: a ``delete`` change must not be turned
    # into an after-content read that would silently resurrect it.
    target = tmp_path / _REL
    target.parent.mkdir(parents=True)
    target.write_text("still here", encoding="utf-8")

    turn = _run(
        gateway,
        tmp_path,
        [*_write_call(call_id="call-1", op="delete"), {"type": "react_completed"}],
        thread_id="th_journal_delete",
    )

    entry = turn["fileEdits"][0]
    assert entry["op"] == "delete"
    assert entry["afterSha256"] == ""
    assert entry["afterSha256"] != _sha("still here")
    assert entry["beforeSource"] == "unknown"
    assert entry["reversible"] is False
    assert "still here" not in json.dumps(turn)


def test_turn_without_writes_publishes_no_entries(gateway: Any, tmp_path: Path) -> None:
    turn = _run(
        gateway,
        tmp_path,
        [
            {"type": "text_delta", "delta": "nothing to write"},
            {"type": "react_completed"},
        ],
        thread_id="th_journal_empty",
    )
    assert turn["fileEdits"] == []
