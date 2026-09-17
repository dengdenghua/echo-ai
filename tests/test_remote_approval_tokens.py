"""A remote approval reply is honoured once, for the request it answers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from runtime.safety.approval.remote_approval_tokens import (
    DEFAULT_TTL_SECONDS,
    RemoteApprovalTokenStore,
)


class _Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


def _store(tmp_path: Path, clock: _Clock | None = None) -> RemoteApprovalTokenStore:
    return RemoteApprovalTokenStore(tmp_path / "approvals.db", clock=clock)


def _issue(store: RemoteApprovalTokenStore, *, call_id: str = "call-1") -> str:
    return store.issue(
        thread_id="th-1",
        tool_name="mcp_notion_query",
        tool_call_id=call_id,
    )


def test_a_fresh_token_redeems_once_and_carries_the_decision(tmp_path: Path) -> None:
    store = _store(tmp_path)
    token = _issue(store)

    reply = store.consume(token, approved=True, replied_by="owner@example.com")

    assert reply is not None
    assert reply.approved
    assert reply.tool_call_id == "call-1"
    assert reply.tool_name == "mcp_notion_query"
    assert reply.replied_by == "owner@example.com"


def test_a_denial_is_as_attributable_as_an_approval(tmp_path: Path) -> None:
    store = _store(tmp_path)
    token = _issue(store)

    reply = store.consume(token, approved=False, replied_by="owner@example.com")

    assert reply is not None
    assert not reply.approved


def test_a_token_cannot_be_replayed(tmp_path: Path) -> None:
    """A captured "approve" must not work a second time."""

    store = _store(tmp_path)
    token = _issue(store)

    assert store.consume(token, approved=True) is not None
    assert store.consume(token, approved=True) is None


def test_a_token_cannot_answer_a_different_call(tmp_path: Path) -> None:
    """Binding is the point: one question, one token."""

    store = _store(tmp_path)
    token = _issue(store, call_id="call-1")

    assert store.consume(token, approved=True, expected_tool_call_id="call-2") is None
    # Still unspent, so the rightful question can still be answered.
    assert store.consume(token, approved=True, expected_tool_call_id="call-1") is not None


def test_an_expired_token_stops_working(tmp_path: Path) -> None:
    clock = _Clock()
    store = _store(tmp_path, clock)
    token = _issue(store)

    clock.advance(DEFAULT_TTL_SECONDS + 1)

    assert store.consume(token, approved=True) is None


def test_an_unknown_or_empty_token_yields_no_decision(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _issue(store)

    assert store.consume("not-a-real-token", approved=True) is None
    assert store.consume("", approved=True) is None
    assert store.consume("   ", approved=True) is None


def test_the_plaintext_token_is_never_stored(tmp_path: Path) -> None:
    """A leaked database must not yield usable approvals."""

    store = _store(tmp_path)
    token = _issue(store)

    raw = (tmp_path / "approvals.db").read_bytes()
    assert token.encode() not in raw


def test_an_unbound_token_cannot_be_minted(tmp_path: Path) -> None:
    store = _store(tmp_path)

    for kwargs in (
        {"thread_id": "", "tool_name": "mcp_x", "tool_call_id": "c"},
        {"thread_id": "th", "tool_name": "", "tool_call_id": "c"},
        {"thread_id": "th", "tool_name": "mcp_x", "tool_call_id": ""},
    ):
        with pytest.raises(ValueError):
            store.issue(**kwargs)  # type: ignore[arg-type]


def test_an_unbounded_ttl_is_refused(tmp_path: Path) -> None:
    store = _store(tmp_path)

    for ttl in (0, -1, 24 * 60 * 60 + 1):
        with pytest.raises(ValueError):
            store.issue(
                thread_id="th-1",
                tool_name="mcp_notion_query",
                tool_call_id="call-1",
                ttl_seconds=ttl,
            )


def test_a_ui_decision_revokes_the_outstanding_emailed_token(tmp_path: Path) -> None:
    """A stale mailbox reply must not contradict what the user already decided."""

    store = _store(tmp_path)
    token = _issue(store)

    assert store.revoke_for_call(thread_id="th-1", tool_call_id="call-1") == 1
    assert store.consume(token, approved=True) is None
    # Idempotent: nothing outstanding the second time.
    assert store.revoke_for_call(thread_id="th-1", tool_call_id="call-1") == 0
