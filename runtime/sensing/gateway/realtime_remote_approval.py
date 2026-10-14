"""Route an approval to a message channel only once nobody is at the UI.

The gateway's approval bridge assumes someone is watching: it asks the
connected client and denies with ``timeout`` / ``connection_lost`` when the
answer never comes. That is right for an attended session and wrong for an
unattended one — a project running overnight stalls on a question its owner
would have answered in seconds, had it reached them.

This module adds the second leg, without loosening the first:

* **A client is connected** → unchanged. The UI is asked with the full budget
  and the channel is never involved.
* **Nobody is connected** → wait a bounded grace for a reconnect (lid-close and
  network-switch recover within seconds), because the UI remains the stronger
  channel whenever it is reachable at all.
* **Still nobody** → hand the request to :class:`NotifyingApprovalProvider`,
  which asks over the transport if — and only if — ``remote_eligibility`` says
  this particular request may be answered from there, and denies otherwise.

Nothing here widens what may be approved remotely; that stays in
``remote_eligibility``. And with no transport installed the wrapper is a no-op
that returns the gateway provider untouched, so a deployment without an owner
contact mapping behaves exactly as it did before.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from runtime.safety.approval.approval_gate import (
    ApprovalDecision,
    ApprovalProvider,
    ApprovalRequest,
)
from runtime.safety.approval.notifying_provider import (
    NotifyingApprovalProvider,
    RemoteApprovalTransport,
)
from runtime.safety.approval.remote_approval_transport import remote_approval_transport

_logger = logging.getLogger(__name__)

# How long a vanished client gets to come back before the question leaves the
# machine. Long enough for a reconnect (lid close, wifi handover, tab reload),
# short enough that an owner who is genuinely away is not kept waiting for the
# full approval budget before being notified.
_RECONNECT_GRACE_S = 60.0

_POLL_INTERVAL_S = 0.25


def client_is_connected(emitter: Any) -> bool:
    """Whether any live client could answer an approval right now.

    ``_DetachedTurnEmitter`` already computes this set (owner, else every live
    watcher of the thread); a plain connection exposes ``_closed``. An emitter
    that is neither is assumed attended — defaulting to the UI keeps the
    stronger channel in play when we cannot tell.
    """

    live_targets = getattr(emitter, "_live_targets", None)
    if callable(live_targets):
        try:
            return bool(live_targets())
        except Exception:  # noqa: BLE001 - an unreadable registry is not proof of absence
            _logger.debug("live-target probe failed; assuming a client is present", exc_info=True)
            return True
    closed = getattr(emitter, "_closed", None)
    if isinstance(closed, bool):
        return not closed
    return True


def _turn_is_injection_tainted(_req: ApprovalRequest) -> bool:
    """Any taint at all, not just the level that forces approval.

    ``injection_taint_gates`` answers "should this go to a human"; here the
    question is "may this text leave the machine", so the bar is lower: a single
    low-severity marker is enough to keep the request local and undescribed.
    """

    try:
        from runtime.safety.validation.prompt_injection import current_injection_taint

        return current_injection_taint() != "none"
    except Exception:  # noqa: BLE001 - unreadable taint state means assume tainted
        _logger.debug("injection taint probe failed; treating turn as tainted", exc_info=True)
        return True


class ReconnectGraceProvider(ApprovalProvider):
    """The gateway provider, but only while somebody can actually answer.

    Raises :class:`_NobodyConnected` instead of burning the whole budget on a
    dead socket, which is what lets the notifying provider fall through to the
    channel with time left to spend.
    """

    def __init__(
        self,
        gateway: ApprovalProvider,
        *,
        emitter: Any,
        grace_s: float = _RECONNECT_GRACE_S,
    ) -> None:
        self._gateway = gateway
        self._emitter = emitter
        self._grace_s = grace_s

    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        if client_is_connected(self._emitter):
            return self._gateway.request(req, timeout=timeout)
        # Never spend more than half the budget waiting for a reconnect: the
        # channel leg needs delivery time plus a human reading it.
        grace = min(self._grace_s, max(timeout, 0.0) / 2.0)
        if self._wait_for_client(grace):
            remaining = max(timeout - grace, 0.0)
            return self._gateway.request(req, timeout=remaining)
        raise _NobodyConnected(req.tool_name)

    def _wait_for_client(self, grace: float) -> bool:
        deadline = time.monotonic() + grace
        while True:
            if client_is_connected(self._emitter):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(min(_POLL_INTERVAL_S, max(deadline - time.monotonic(), 0.0)))


class _NobodyConnected(RuntimeError):
    """No client returned within the grace window; try the channel."""

    def __init__(self, tool_name: str) -> None:
        super().__init__(f"no client connected to approve {tool_name}")


class _TurnTaggedNotifyingProvider(NotifyingApprovalProvider):
    """Carries the gateway provider's turn id across the wrapper.

    ``_wrap_with_policy`` tags the trust-gateway trace with ``_turn_id`` read off
    whatever provider it is handed. Wrapping must not blank the turn id out of
    the audit trail, so the attribute travels with the request.
    """

    _turn_id: str | None = None


def wrap_with_remote_notification(
    gateway_provider: ApprovalProvider,
    *,
    emitter: Any,
    transport: RemoteApprovalTransport | None = None,
    grace_s: float = _RECONNECT_GRACE_S,
) -> ApprovalProvider:
    """Add the channel leg when — and only when — a transport is installed.

    Returns ``gateway_provider`` unchanged otherwise, so the pure-UI path is
    untouched in deployments that have nobody to notify.
    """

    resolved = transport if transport is not None else remote_approval_transport()
    if resolved is None:
        return gateway_provider
    wrapped = _TurnTaggedNotifyingProvider(
        transport=resolved,
        local=ReconnectGraceProvider(gateway_provider, emitter=emitter, grace_s=grace_s),
        # The grace provider owns the "is anyone there" decision, including the
        # reconnect wait; a second probe here would skip that window entirely.
        local_available=lambda: True,
        injection_tainted=_turn_is_injection_tainted,
    )
    turn_id = getattr(gateway_provider, "_turn_id", None)
    if turn_id is not None:
        wrapped._turn_id = str(turn_id)
    return wrapped


__all__ = [
    "ReconnectGraceProvider",
    "client_is_connected",
    "wrap_with_remote_notification",
]
