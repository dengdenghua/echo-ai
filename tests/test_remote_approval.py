"""Remote approval degrades to denial, and never lowers the bar for danger."""

from __future__ import annotations

from typing import Any

from runtime.safety.approval.approval_gate import (
    ApprovalDecision,
    ApprovalProvider,
    ApprovalRequest,
)
from runtime.safety.approval.notifying_provider import NotifyingApprovalProvider
from runtime.safety.approval.remote_eligibility import remote_eligibility


# ``mcp_*`` assesses as medium/external_mcp and matches no dangerous prefix,
# which is what actually remains remotely approvable. Ordinary file writes do
# not: ``write_text_file`` is in DANGEROUS_TOOLS and ``write_`` is a dangerous
# prefix, so they stay local by design.
def _req(tool_name: str = "mcp_notion_query", args_preview: str = "") -> ApprovalRequest:
    return ApprovalRequest(
        thread_id="th-1",
        tool_name=tool_name,
        tool_call_id="call-1",
        args_preview=args_preview,
    )


class _Local(ApprovalProvider):
    def __init__(self, decision: ApprovalDecision | None = None, *, boom: bool = False) -> None:
        self.decision = decision
        self.boom = boom
        self.calls = 0

    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        self.calls += 1
        if self.boom:
            raise RuntimeError("ui transport died")
        assert self.decision is not None
        return self.decision


class _Transport:
    def __init__(self, decision: ApprovalDecision | None = None, *, boom: bool = False) -> None:
        self.decision = decision
        self.boom = boom
        self.calls = 0
        self.seen: list[ApprovalRequest] = []

    def deliver(
        self, req: ApprovalRequest, *, timeout: float
    ) -> ApprovalDecision | None:
        self.calls += 1
        self.seen.append(req)
        if self.boom:
            raise RuntimeError("smtp unreachable")
        return self.decision


def test_a_connected_ui_answers_and_the_channel_is_never_used() -> None:
    local = _Local(ApprovalDecision(approved=True, reason="clicked approve"))
    transport = _Transport()
    provider = NotifyingApprovalProvider(transport=transport, local=local)

    decision = provider.request(_req())

    assert decision.approved
    assert local.calls == 1
    assert transport.calls == 0


def test_no_reply_denies_rather_than_proceeding() -> None:
    """"Nobody objected" is not consent."""

    transport = _Transport(None)
    provider = NotifyingApprovalProvider(transport=transport)

    decision = provider.request(_req())

    assert not decision.approved
    assert "no reply" in (decision.reason or "")
    assert transport.calls == 1


def test_undeliverable_notification_denies() -> None:
    transport = _Transport(boom=True)
    provider = NotifyingApprovalProvider(transport=transport)

    decision = provider.request(_req())

    assert not decision.approved
    assert "could not reach you" in (decision.reason or "")


def test_a_remote_approval_is_honoured_when_it_arrives() -> None:
    transport = _Transport(ApprovalDecision(approved=True, reason="owner replied approve"))
    provider = NotifyingApprovalProvider(transport=transport)

    decision = provider.request(_req())

    assert decision.approved
    assert decision.reason == "owner replied approve"


def test_dangerous_tools_are_never_asked_over_a_channel() -> None:
    transport = _Transport(ApprovalDecision(approved=True, reason="forged approve"))
    provider = NotifyingApprovalProvider(transport=transport)

    decision = provider.request(_req("exec_shell", args_preview="rm -rf /"))

    assert not decision.approved
    assert transport.calls == 0, "a shell approval must not leave the machine"
    assert "needs approval in the app" in (decision.reason or "")


def test_ordinary_file_writes_also_stay_local() -> None:
    """Pins the boundary I initially got wrong.

    A document write inside the task's own directory sounds harmless enough to
    approve by email, but ``write_text_file`` is in ``DANGEROUS_TOOLS`` and
    ``write_`` is a dangerous prefix — so it stays local. Anyone widening this
    has to change the gate deliberately rather than by accident.
    """

    transport = _Transport(ApprovalDecision(approved=True))
    provider = NotifyingApprovalProvider(transport=transport)

    for tool in ("write_text_file", "edit_text_file", "git_push", "delete_file"):
        decision = provider.request(_req(tool))
        assert not decision.approved, tool
    assert transport.calls == 0


def test_injection_tainted_requests_are_not_even_described_remotely() -> None:
    transport = _Transport(ApprovalDecision(approved=True))
    provider = NotifyingApprovalProvider(
        transport=transport,
        injection_tainted=lambda _req: True,
    )

    decision = provider.request(_req())

    assert not decision.approved
    assert transport.calls == 0
    eligibility = remote_eligibility(_req(), injection_tainted=True)
    assert eligibility.must_stay_local
    assert not eligibility.describable


def test_a_broken_ui_provider_falls_through_to_the_channel() -> None:
    local = _Local(boom=True)
    transport = _Transport(ApprovalDecision(approved=True, reason="owner replied"))
    provider = NotifyingApprovalProvider(transport=transport, local=local)

    decision = provider.request(_req())

    assert decision.approved
    assert local.calls == 1
    assert transport.calls == 1


def test_an_unavailable_ui_is_skipped_without_being_called() -> None:
    local = _Local(ApprovalDecision(approved=True))
    transport = _Transport(ApprovalDecision(approved=False, reason="owner declined"))
    provider = NotifyingApprovalProvider(
        transport=transport,
        local=local,
        local_available=lambda: False,
    )

    decision = provider.request(_req())

    assert not decision.approved
    assert local.calls == 0
    assert transport.calls == 1


def test_a_malformed_reply_is_not_treated_as_approval() -> None:
    class _Bad:
        def deliver(self, req: ApprovalRequest, *, timeout: float) -> Any:
            return "approve"

    provider = NotifyingApprovalProvider(transport=_Bad())

    decision = provider.request(_req())

    assert not decision.approved
    assert "malformed" in (decision.reason or "")


def test_no_remaining_timeout_denies_instead_of_asking() -> None:
    transport = _Transport(ApprovalDecision(approved=True))
    provider = NotifyingApprovalProvider(transport=transport)

    decision = provider.request(_req(), timeout=0.0)

    assert not decision.approved
    assert transport.calls == 0
    assert "no time left" in (decision.reason or "")
