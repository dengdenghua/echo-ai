"""Regression tests for CoordinationService graceful degradation (fix ③).

A 1:1 / non-group thread has no collaboration seat, so read-only
``collaboration`` inspection actions (``list`` / ``inbox``) must return a
readable result instead of surfacing a hard
``member is unavailable or not authorized to execute`` PermissionError.
"""

from __future__ import annotations

from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.coordination_service import CoordinationService
from runtime.platform.process.session import Session, current_session, session_scope


class _FakeGroups:
    """Minimal stand-in for the group store used by CoordinationService."""

    def __init__(self, roster_ids: tuple[str, ...] = ()) -> None:
        self._roster_ids = tuple(roster_ids)

    def state(self, _thread: str):
        roster = self._roster_ids

        class _FakeState:
            def member(self, member_id: str):  # noqa: ANN001 - test stub
                return object() if member_id in roster else None

        return _FakeState()


def _service(tmp_path, roster_ids: tuple[str, ...] = ()) -> CoordinationService:
    store = CollaborationStore(base_dir=tmp_path / "cowork")
    # store/queue are never touched on the degraded path, so dummies suffice.
    return CoordinationService(_FakeGroups(roster_ids), store=store, queue=None, thread_store=None)


def test_collaboration_list_degrades_in_non_group_thread(tmp_path) -> None:
    svc = _service(tmp_path, roster_ids=())  # no seat ⇒ 1:1 / non-group
    with session_scope(Session(actor="local:123", thread_id="tn_1to1")):
        result = svc.tool(action="list")

    assert result["ok"] is True
    assert result["is_collaboration_group"] is False
    assert result["tasks"] == []
    assert "协作" in result["note"]
    # GUIDANCE is surfaced so the agent still learns the collaboration contract.
    assert "协作" in result["guidance"]


def test_collaboration_inbox_degrades_in_non_group_thread(tmp_path) -> None:
    svc = _service(tmp_path, roster_ids=())
    with session_scope(Session(actor="local:123", thread_id="tn_1to1")):
        result = svc.tool(action="inbox")

    assert result["ok"] is True
    assert result["is_collaboration_group"] is False
    assert result["messages"] == []


def test_collaboration_member_seat_detection(tmp_path) -> None:
    svc = _service(tmp_path, roster_ids=("local:123",))
    with session_scope(Session(actor="local:123", thread_id="tn_group")):
        assert svc._is_collaboration_member(current_session()) is True
    # No active session ⇒ not a member.
    assert svc._is_collaboration_member(None) is False


def test_collaboration_list_still_degrades_without_session(tmp_path) -> None:
    # A missing session is also "not a group", so list still degrades rather
    # than raising "requires a bound group execution session".
    svc = _service(tmp_path, roster_ids=())
    result = svc.tool(action="list")
    assert result["ok"] is True
    assert result["is_collaboration_group"] is False
