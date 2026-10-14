"""P1-15: turn-scoped file-edit journal (before/after per file, per turn).

Covers the honesty rules the module exists to enforce: ``before`` is only ever
known or derived (never guessed), a truncated diff refuses to yield a before
state, and degenerate path fragments (``D`` / ``D:`` / a bare backslash) are
dropped rather than journalled.
"""

from __future__ import annotations

import json

from runtime.core.cerebrum.file_edit_journal import (
    MAX_CONTENT_BYTES,
    FileEditEntry,
    FileEditJournal,
    entries_from_file_change_item,
    journal_path_key,
    make_entry,
    normalize_journal_path,
    read_text_bounded,
    same_journal_path,
)
from runtime.protocol import FileEditSummary

# A complete, reverse-appliable diff that turns "old/same" into "new/same";
# the journal derives ``before`` from exactly this shape.
_UPDATE_DIFF = "--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-old\n+new\n same\n"


# --- path normalisation -------------------------------------------------


def test_windows_absolute_path_normalises_separators() -> None:
    assert normalize_journal_path(r"D:\a\b.txt") == "D:/a/b.txt"


def test_windows_path_case_folds_but_posix_does_not() -> None:
    assert same_journal_path(r"D:\a\b.txt", "d:/a/b.txt") is True
    # POSIX-ish shapes keep their case: two files, not one.
    assert same_journal_path("a/b.txt", "A/b.txt") is False


def test_degenerate_fragments_are_rejected() -> None:
    for fragment in ("D", "D:", "\\", "", "/", "///", "c:/", "  "):
        assert normalize_journal_path(fragment) == "", fragment


def test_unc_paths_are_not_mis_folded() -> None:
    assert normalize_journal_path("//server/share/x") == "//server/share/x"
    # Extra leading slashes collapse to the canonical UNC shape.
    assert normalize_journal_path("///server/share/x") == "//server/share/x"
    assert journal_path_key("//server/share/x") == "//server/share/x".casefold()


def test_root_absolutises_and_unifies_both_spellings() -> None:
    assert normalize_journal_path("sub/b.txt", root=r"D:\proj") == "D:/proj/sub/b.txt"
    assert normalize_journal_path(r"D:\proj\sub\b.txt") == "D:/proj/sub/b.txt"
    # An absolute child ignores the root rather than being double-prefixed.
    assert normalize_journal_path("D:/other/x", root=r"D:\proj") == "D:/other/x"


def test_normalise_resolves_dot_segments() -> None:
    assert normalize_journal_path("a/./b/../c.txt") == "a/c.txt"


# --- make_entry ---------------------------------------------------------


def test_create_records_empty_before() -> None:
    entry = make_entry(path="a.txt", op="create", after="hello\n")
    assert entry is not None
    assert entry.before == ""
    assert entry.before_source == "recorded"
    assert entry.reversible is True


def test_update_derives_before_from_complete_diff() -> None:
    entry = make_entry(
        path="a.txt",
        op="update",
        after="new\nsame\n",
        diff=_UPDATE_DIFF,
    )
    assert entry is not None
    assert entry.before == "old\nsame\n"
    assert entry.before_source == "derived"
    assert entry.reversible is True


def test_truncated_diff_refuses_to_yield_before() -> None:
    truncated = _UPDATE_DIFF + "\n... (truncated 4096 bytes)\n"
    entry = make_entry(path="a.txt", op="update", after="new\nsame\n", diff=truncated)
    assert entry is not None
    assert entry.before is None
    assert entry.before_source == "unknown"
    assert "before_not_recoverable" in entry.reason
    assert entry.reversible is False


def test_diff_that_no_longer_matches_is_not_reversible() -> None:
    entry = make_entry(
        path="a.txt",
        op="update",
        after="totally different\n",
        diff=_UPDATE_DIFF,
    )
    assert entry is not None
    assert entry.before is None
    assert entry.before_source == "unknown"
    assert "before_not_recoverable" in entry.reason


def test_incomplete_diff_without_truncation_marker_is_not_reversible() -> None:
    entry = make_entry(
        path="a.txt",
        op="update",
        after="new1\nnew2\n",
        diff="@@ -1,2 +1,2 @@\n-old1\n+new1\n",
    )
    assert entry is not None
    assert entry.before is None
    assert entry.before_source == "unknown"
    assert not entry.reversible
    assert "before_not_recoverable" in entry.reason


def test_oversized_after_is_dropped_with_reason() -> None:
    entry = make_entry(
        path="a.txt",
        op="update",
        after="x" * (MAX_CONTENT_BYTES + 1),
        diff=_UPDATE_DIFF,
    )
    assert entry is not None
    assert entry.after is None
    assert entry.reason == "after_too_large"


def test_missing_after_is_not_captured() -> None:
    entry = make_entry(path="a.txt", op="update", after=None, diff=None)
    assert entry is not None
    assert entry.after is None
    assert entry.before is None
    assert entry.reason == "after_not_captured"


def test_delete_has_no_recoverable_before() -> None:
    entry = make_entry(path="a.txt", op="delete")
    assert entry is not None
    assert entry.before is None
    assert entry.reason == "deleted_content_not_captured"
    assert entry.reversible is False


def test_unknown_op_and_non_path_are_rejected() -> None:
    assert make_entry(path="a.txt", op="rename") is None
    assert make_entry(path="D:", op="update") is None
    assert make_entry(path="", op="create") is None


# --- FileEditJournal ----------------------------------------------------


def test_first_touch_order_is_stable() -> None:
    journal = FileEditJournal()
    a = make_entry(path="a.txt", op="create", after="a\n")
    b = make_entry(path="b.txt", op="create", after="b\n")
    journal.record(b)
    journal.record(a)
    assert journal.paths == ("b.txt", "a.txt")
    assert len(journal) == 2
    assert bool(journal) is True


def test_repeat_touch_merges_keeping_first_before_and_latest_after() -> None:
    journal = FileEditJournal()
    journal.record(make_entry(path="a.txt", op="create", after="one\n"))
    journal.record(
        make_entry(
            path="a.txt",
            op="update",
            after="two\n",
            diff="--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+two\n",
        )
    )
    assert len(journal) == 1
    (entry,) = journal.entries
    assert entry.before == ""  # first observation owns the before-state
    assert entry.before_source == "recorded"
    assert entry.after == "two\n"
    assert entry.touches == 2


def test_create_then_delete_collapses() -> None:
    journal = FileEditJournal()
    journal.record(make_entry(path="scratch.txt", op="create", after="temp\n"))
    journal.record(make_entry(path="scratch.txt", op="delete"))
    (entry,) = journal.entries
    assert entry.op == "delete"
    assert entry.before is None
    assert entry.after is None
    assert entry.reason == "created_then_deleted"
    assert entry.reversible is False


def test_update_then_delete_never_keeps_the_stale_after_state() -> None:
    journal = FileEditJournal()
    journal.record(make_entry(path="a.txt", op="update", after="new\nsame\n", diff=_UPDATE_DIFF))
    journal.record(make_entry(path="a.txt", op="delete"))
    (entry,) = journal.entries
    # The turn ended with the file gone, so neither the op nor the after-state
    # may still describe the contents the earlier touch left behind.
    assert entry.op == "delete"
    assert entry.after is None
    assert entry.after_sha256 == ""
    # The before-state survives, and it is what undoes the whole turn.
    assert entry.before == "old\nsame\n"
    assert entry.reversible is True
    assert entry.touches == 2


def test_delete_then_write_is_an_update_with_unknown_before() -> None:
    journal = FileEditJournal()
    journal.record(make_entry(path="a.txt", op="delete"))
    journal.record(make_entry(path="a.txt", op="create", after="rebuilt\n"))
    (entry,) = journal.entries
    # The file did exist before the turn, so calling this a create would
    # understate what the turn destroyed.
    assert entry.op == "update"
    assert entry.after == "rebuilt\n"
    assert entry.before is None
    assert entry.before_source == "unknown"
    assert entry.reversible is False


def test_cap_drops_overflow_and_counts_it() -> None:
    journal = FileEditJournal(cap=2)
    for index in range(4):
        journal.record(make_entry(path=f"f{index}.txt", op="create", after="x\n"))
    assert len(journal) == 2
    assert journal.dropped == 2


def test_summary_counts_by_op_and_reversibility() -> None:
    journal = FileEditJournal()
    journal.record(make_entry(path="new.txt", op="create", after="n\n"))
    journal.record(
        make_entry(
            path="edit.txt",
            op="update",
            after="new\nsame\n",
            diff=_UPDATE_DIFF,
        )
    )
    journal.record(make_entry(path="gone.txt", op="delete"))
    summary = journal.summary()
    assert summary["files"] == 3
    assert summary["created"] == 1
    assert summary["updated"] == 1
    assert summary["deleted"] == 1
    assert summary["reversible"] == 2
    assert summary["before_unknown"] == 1


def test_to_dict_from_dict_round_trip() -> None:
    journal = FileEditJournal()
    journal.record(make_entry(path="new.txt", op="create", after="n\n"))
    journal.record(
        make_entry(
            path="edit.txt",
            op="update",
            after="new\nsame\n",
            diff=_UPDATE_DIFF,
        )
    )
    restored = FileEditJournal.from_dict(journal.to_dict())
    assert restored.to_dict() == journal.to_dict()
    assert restored.paths == journal.paths


def test_from_dict_drops_dirty_entries() -> None:
    journal = FileEditJournal.from_dict(
        {
            "entries": [
                {"path": "good.txt", "op": "create", "after": "x\n"},
                {"path": "D:", "op": "update"},  # degenerate path
                {"path": "bad.txt", "op": "rename"},  # unknown op
                "not-a-mapping",
            ]
        }
    )
    assert journal.paths == ("good.txt",)


def test_entry_from_dict_tolerates_bad_fields() -> None:
    assert FileEditEntry.from_dict("nope") is None
    entry = FileEditEntry.from_dict(
        {"path": "a.txt", "op": "update", "beforeSource": "bogus", "touches": "xx"}
    )
    assert entry is not None
    assert entry.before_source == "unknown"
    assert entry.touches == 1


# --- from_turn / entries_from_file_change_item --------------------------


def test_entries_from_file_change_item_object_and_dict() -> None:
    from runtime.protocol.items import FileChange, FileChangeItem

    item = FileChangeItem(
        changes=[
            FileChange(path="a.txt", op="update", diff=_UPDATE_DIFF),
        ]
    )
    contents = {"a.txt": "new\nsame\n"}
    (object_entry,) = entries_from_file_change_item(item, contents=contents)
    assert object_entry.before == "old\nsame\n"
    assert object_entry.after == "new\nsame\n"

    dict_item = {
        "type": "fileChange",
        "changes": [{"path": "a.txt", "op": "update", "diff": _UPDATE_DIFF}],
    }
    (dict_entry,) = entries_from_file_change_item(dict_item, contents=contents)
    assert dict_entry == object_entry


def test_without_contents_after_is_uncaptured_so_before_stays_unknown() -> None:
    from runtime.protocol.items import FileChange, FileChangeItem

    item = FileChangeItem(changes=[FileChange(path="a.txt", op="update", diff=_UPDATE_DIFF)])
    (entry,) = entries_from_file_change_item(item)
    # A diff alone cannot rebuild the before-state: reversing it needs the
    # after-state to apply against, so the journal refuses to guess.
    assert entry.before is None
    assert entry.before_source == "unknown"
    assert entry.reason == "after_not_captured"
    assert entry.after is None


def test_from_turn_rebuilds_from_file_change_items() -> None:
    from runtime.protocol.items import FileChange, FileChangeItem, UserMessageItem

    turn = {
        "items": [
            {"type": "userMessage", "text": "hi"},
            {
                "type": "fileChange",
                "changes": [{"path": "a.txt", "op": "update", "diff": _UPDATE_DIFF}],
            },
            {
                "type": "fileChange",
                "changes": [{"path": "b.txt", "op": "create", "diff": ""}],
            },
        ]
    }
    journal = FileEditJournal.from_turn(turn, contents={"a.txt": "new\nsame\n"})
    assert journal.paths == ("a.txt", "b.txt")
    first, second = journal.entries
    assert first.before == "old\nsame\n"
    assert first.origin == "replay"
    assert second.op == "create"

    # A non-file-change item is ignored; an object Turn works the same way.
    assert UserMessageItem is not None
    assert FileChangeItem(changes=[FileChange(path="a.txt", op="update", diff=_UPDATE_DIFF)])


def test_from_turn_ignores_non_list_items() -> None:
    assert len(FileEditJournal.from_turn({"items": None})) == 0
    assert len(FileEditJournal.from_turn("nope")) == 0


# --- read_text_bounded --------------------------------------------------


def test_read_text_bounded_reads_utf8(tmp_path) -> None:
    path = tmp_path / "f.txt"
    # Write bytes so the platform newline translation cannot rewrite the
    # fixture out from under the assertion.
    path.write_bytes(b"caf\xc3\xa9\n")  # UTF-8 for "café\n"
    assert read_text_bounded(path) == "café\n"


def test_read_text_bounded_returns_none_for_missing(tmp_path) -> None:
    assert read_text_bounded(tmp_path / "absent.txt") is None
    assert read_text_bounded("") is None


def test_read_text_bounded_rejects_oversized(tmp_path) -> None:
    path = tmp_path / "big.txt"
    path.write_text("x" * 50, encoding="utf-8")
    assert read_text_bounded(path, limit=10) is None


def test_read_text_bounded_rejects_binary(tmp_path) -> None:
    path = tmp_path / "blob.bin"
    path.write_bytes(b"\xff\xfe\x00\x01")
    assert read_text_bounded(path) is None


# --- wire projection (FileEditSummary) ----------------------------------


def test_to_summaries_aligns_with_the_wire_model() -> None:
    """The turn frame's ``fileEdits`` must accept the projection unchanged.

    ``to_summary`` is the same record minus the contents, so a renamed or
    dropped key has to fail here rather than at runtime inside the bridge.
    """

    journal = FileEditJournal()
    journal.record(make_entry(path="a.txt", op="update", after="new\nsame\n", diff=_UPDATE_DIFF))
    summary = journal.to_summaries()[0]
    aliases = {field.alias or name for name, field in FileEditSummary.model_fields.items()}
    assert set(summary) == aliases
    parsed = FileEditSummary.model_validate(summary)
    assert parsed.path == "a.txt"
    assert parsed.op == "update"
    assert parsed.before_source == "derived"
    assert parsed.reversible is True
    # Round-trips both ways: nothing is added, defaulted away, or renamed.
    assert parsed.model_dump(by_alias=True) == summary


def test_summary_is_content_free_but_the_durable_form_is_not() -> None:
    journal = FileEditJournal()
    journal.record(make_entry(path="a.txt", op="create", after="secret"))
    summary = journal.to_summaries()[0]
    assert "secret" not in json.dumps(summary)
    # The durable projection is the one that keeps contents; the wire one
    # only ever carries the hash that stands in for them.
    assert journal.to_dict()["entries"][0]["after"] == "secret"
