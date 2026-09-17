"""Ask for approval over a message channel when nobody is at the UI.

Three-step degradation, in order:

1. **A local provider answers** — the UI is connected, so use it. Fastest path
   and unchanged behaviour; the channel is never involved.
2. **Nobody local, request is remotely eligible** — notify and wait for a reply
   within the remaining timeout.
3. **Not eligible, delivery failed, or nothing came back** — deny.

Step 3 is the whole point of the design being safe: an unattended run that
cannot reach its owner must leave the task blocked for a human, never proceed
because no objection arrived. "No answer" is not consent. The wrapped
``AutoDenyProvider`` semantics are preserved: the reason string explains which
step refused, so the planner and the project timeline can show why work stopped.

This provider owns delivery and waiting. It does not decide *what* may be asked
remotely — ``remote_eligibility`` does — and it does not validate the reply's
authenticity, which belongs to the one-time token store the responder checks
before handing a decision back here.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Protocol

from runtime.safety.approval.approval_gate import (
    ApprovalDecision,
    ApprovalProvider,
    ApprovalRequest,
)
from runtime.safety.approval.remote_eligibility import remote_eligibility

_logger = logging.getLogger(__name__)

# Leave room for the reply leg: spending the entire turn budget on delivery
# would guarantee a timeout even when the owner answers immediately.
_MIN_REMOTE_WAIT_S = 5.0


class RemoteApprovalTransport(Protocol):
    """Delivers an approval question and waits for the owner's answer."""

    def deliver(self, req: ApprovalRequest, *, timeout: float) -> ApprovalDecision | None:
        """Return the owner's decision, or ``None`` when nothing arrived.

        ``None`` and an exception are treated identically by the caller: both
        mean no decision was obtained, which degrades to denial. Implementations
        must not return an approval they cannot attribute to the owner.
        """


class NotifyingApprovalProvider(ApprovalProvider):
    """Local provider first, message channel second, denial last."""

    def __init__(
        self,
        *,
        transport: RemoteApprovalTransport,
        local: ApprovalProvider | None = None,
        local_available: Callable[[], bool] | None = None,
        injection_tainted: Callable[[ApprovalRequest], bool] | None = None,
    ) -> None:
        self._transport = transport
        self._local = local
        # Absent a probe, a supplied local provider is assumed reachable — that
        # keeps the existing UI path unchanged for callers that always have one.
        self._local_available = local_available or (lambda: local is not None)
        self._injection_tainted = injection_tainted or (lambda _req: False)

    def request(
        self, req: ApprovalRequest, *, timeout: float = 120.0
    ) -> ApprovalDecision:
        started = time.monotonic()
        local_decision = self._try_local(req, timeout=timeout)
        if local_decision is not None:
            return local_decision

        eligibility = remote_eligibility(
            req,
            injection_tainted=self._injection_tainted(req),
        )
        if eligibility.must_stay_local:
            _logger.info(
                "approval for %s stays local (%s); denying unattended request",
                req.tool_name,
                eligibility.reason,
            )
            return ApprovalDecision(
                approved=False,
                reason=(
                    f"needs approval in the app: {eligibility.reason}. "
                    "Nobody was connected, and this decision cannot be answered "
                    "over a message channel."
                ),
            )

        remaining = timeout - (time.monotonic() - started)
        if remaining < _MIN_REMOTE_WAIT_S:
            return ApprovalDecision(
                approved=False,
                reason="no time left to ask for approval over a message channel",
            )
        return self._ask_remotely(req, timeout=remaining)

    def _try_local(
        self, req: ApprovalRequest, *, timeout: float
    ) -> ApprovalDecision | None:
        """The UI's answer, or ``None`` when there is nobody to ask."""

        if self._local is None:
            return None
        try:
            if not self._local_available():
                return None
        except Exception:  # noqa: BLE001 - an unusable probe means nobody local
            _logger.debug("local approval availability probe failed", exc_info=True)
            return None
        try:
            return self._local.request(req, timeout=timeout)
        except Exception:  # noqa: BLE001 - fall through to the channel
            # The abstract contract says callers may treat a transport failure
            # as denial; here there is still a channel to try first.
            _logger.debug("local approval provider failed", exc_info=True)
            return None

    def _ask_remotely(
        self, req: ApprovalRequest, *, timeout: float
    ) -> ApprovalDecision:
        try:
            decision = self._transport.deliver(req, timeout=timeout)
        except Exception:  # noqa: BLE001 - undelivered means undecided
            _logger.debug("remote approval delivery failed", exc_info=True)
            return ApprovalDecision(
                approved=False,
                reason="could not reach you to ask for approval; task left for review",
            )
        if decision is None:
            return ApprovalDecision(
                approved=False,
                reason="no reply to the approval request; task left for review",
            )
        if not isinstance(decision, ApprovalDecision):
            # A transport that returns something else is broken, not permissive.
            _logger.warning("remote approval transport returned %r", type(decision))
            return ApprovalDecision(
                approved=False,
                reason="malformed approval reply; task left for review",
            )
        return decision
