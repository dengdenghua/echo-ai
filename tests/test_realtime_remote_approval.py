"""The channel leg only opens after the UI is genuinely unreachable.

``tests/test_remote_approval.py`` covers the provider's own degradation. This
file covers the wiring: who gets asked first, how long a vanished client keeps
its claim, and what happens in the deployment that has nobody to notify.
"""

from __future__ import annotations

from typing import Any

import pytest

from runtime.safety.approval.approval_gate import (
    ApprovalDecision,
    ApprovalProvider,
    ApprovalRequest,
)
from runtime.safety.approval.remote_approval_transport import (
    remote_approval_transport,
    set_remote_approval_transport,
)
from runtime.sensing.gateway.realtime_remote_approval import (
    ReconnectGraceProvider,
    _NobodyConnected,
    client_is_connected,
    wrap_with_remote_notification,
)


def _req(tool_name: str = "mcp_notion_query") -> ApprovalRequest:
    return ApprovalRequest(
        thread_id="th-1",
        tool_name=tool_name,
        tool_call_id="call-1",
        args_preview="",
    )


class _Gateway(ApprovalProvider):
    def __init__(self, decision: ApprovalDecision | None = None) -> None:
        self.decision = decision or ApprovalDecision(approved=True, reason="accept")
        self.calls: list[float] = []

    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        self.calls.append(timeout)
        return self.decision


class _Transport:
    def __init__(self, decision: ApprovalDecision | None = None) -> None:
        self.decision = decision
        self.calls = 0

    def deliver(self, req: ApprovalRequest, *, timeout: float) -> ApprovalDecision | None:
        self.calls += 1
        return self.decision


class _Emitter:
    """Stands in for ``_DetachedTurnEmitter``: live targets or none."""

    def __init__(self, *, live: bool) -> None:
        self.live = live
        self.probes = 0

    def _live_targets(self) -> list[Any]:
        self.probes += 1
        return [object()] if self.live else []


@pytest.fixture(autouse=True)
def _clear_transport() -> Any:
    set_remote_approval_transport(None)
    yield
    set_remote_approval_transport(None)


def test_without_a_transport_the_gateway_provider_is_returned_untouched() -> None:
    """A deployment with no owner contact must behave exactly as before."""

    gateway = _Gateway()

    wrapped = wrap_with_remote_notification(gateway, emitter=_Emitter(live=False))

    assert wrapped is gateway


def test_an_installed_transport_is_picked_up_from_the_process_slot() -> None:
    transport = _Transport()
    set_remote_approval_transport(transport)

    wrapped = wrap_with_remote_notification(_Gateway(), emitter=_Emitter(live=True))

    assert wrapped is not None
    assert remote_approval_transport() is transport


def test_a_connected_client_answers_and_nothing_is_notified() -> None:
    gateway = _Gateway(ApprovalDecision(approved=True, reason="accept"))
    transport = _Transport(ApprovalDecision(approved=True, reason="forged"))

    decision = wrap_with_remote_notification(
        gateway,
        emitter=_Emitter(live=True),
        transport=transport,
    ).request(_req(), timeout=30.0)

    assert decision.approved
    assert decision.reason == "accept"
    assert transport.calls == 0
    # The UI gets the whole budget; the grace window costs an attended turn
    # nothing.
    assert gateway.calls == [30.0]


def test_nobody_connected_falls_through_to_the_channel() -> None:
    gateway = _Gateway()
    transport = _Transport(ApprovalDecision(approved=True, reason="owner replied approve"))

    decision = wrap_with_remote_notification(
        gateway,
        emitter=_Emitter(live=False),
        transport=transport,
        grace_s=0.0,
    ).request(_req(), timeout=30.0)

    assert decision.approved
    assert decision.reason == "owner replied approve"
    assert transport.calls == 1
    assert gateway.calls == [], "the UI must not be asked when nothing is connected"


def test_a_reconnect_inside_the_grace_window_keeps_the_question_local() -> None:
    """The UI is the stronger channel; a lid-close should not route around it."""

    gateway = _Gateway(ApprovalDecision(approved=False, reason="decline"))
    transport = _Transport(ApprovalDecision(approved=True, reason="forged"))

    class _Reconnecting(_Emitter):
        def _live_targets(self) -> list[Any]:
            self.probes += 1
            # Absent on the first probe, back on the second.
            return [] if self.probes < 2 else [object()]

    decision = wrap_with_remote_notification(
        gateway,
        emitter=_Reconnecting(live=False),
        transport=transport,
        grace_s=5.0,
    ).request(_req(), timeout=30.0)

    assert not decision.approved
    assert decision.reason == "decline"
    assert transport.calls == 0
    assert len(gateway.calls) == 1


def test_the_grace_window_never_eats_more_than_half_the_budget() -> None:
    """Delivery plus a human reading it needs time left on the clock."""

    provider = ReconnectGraceProvider(_Gateway(), emitter=_Emitter(live=False), grace_s=600.0)

    import time as _time

    started = _time.monotonic()
    with pytest.raises(_NobodyConnected):
        provider.request(_req(), timeout=1.0)
    assert _time.monotonic() - started < 1.0


def test_the_turn_id_survives_the_wrapper_for_the_trust_gateway_trace() -> None:
    """``_wrap_with_policy`` tags its trace with ``_turn_id`` off what it wraps."""

    gateway = _Gateway()
    gateway._turn_id = "turn-7"

    wrapped = wrap_with_remote_notification(
        gateway,
        emitter=_Emitter(live=True),
        transport=_Transport(),
    )

    assert getattr(wrapped, "_turn_id", None) == "turn-7"


def test_a_dangerous_tool_is_still_never_asked_over_the_channel() -> None:
    transport = _Transport(ApprovalDecision(approved=True, reason="forged approve"))

    decision = wrap_with_remote_notification(
        _Gateway(),
        emitter=_Emitter(live=False),
        transport=transport,
        grace_s=0.0,
    ).request(_req("exec_shell"), timeout=30.0)

    assert not decision.approved
    assert transport.calls == 0


def test_a_tainted_turn_is_not_described_remotely(monkeypatch: Any) -> None:
    transport = _Transport(ApprovalDecision(approved=True, reason="forged approve"))
    # Any taint at all, not just the level that forces approval: the question
    # here is whether attacker-authored text may leave the machine.
    monkeypatch.setattr(
        "runtime.safety.validation.prompt_injection.current_injection_taint",
        lambda: "low",
    )

    decision = wrap_with_remote_notification(
        _Gateway(),
        emitter=_Emitter(live=False),
        transport=transport,
        grace_s=0.0,
    ).request(_req(), timeout=30.0)

    assert not decision.approved
    assert transport.calls == 0


def test_an_unreadable_taint_probe_keeps_the_request_local(monkeypatch: Any) -> None:
    transport = _Transport(ApprovalDecision(approved=True, reason="forged approve"))

    def boom() -> str:
        raise RuntimeError("contextvar lookup failed")

    monkeypatch.setattr(
        "runtime.safety.validation.prompt_injection.current_injection_taint",
        boom,
    )

    decision = wrap_with_remote_notification(
        _Gateway(),
        emitter=_Emitter(live=False),
        transport=transport,
        grace_s=0.0,
    ).request(_req(), timeout=30.0)

    assert not decision.approved
    assert transport.calls == 0


def test_an_unreadable_emitter_is_assumed_attended() -> None:
    """Defaulting to the UI keeps the stronger channel when we cannot tell."""

    class _Broken:
        def _live_targets(self) -> list[Any]:
            raise RuntimeError("connection registry unavailable")

    assert client_is_connected(_Broken()) is True
    assert client_is_connected(object()) is True


def test_a_plain_connection_reports_through_its_closed_flag() -> None:
    class _Conn:
        def __init__(self, closed: bool) -> None:
            self._closed = closed

    assert client_is_connected(_Conn(False)) is True
    assert client_is_connected(_Conn(True)) is False
