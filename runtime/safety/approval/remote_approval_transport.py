"""Process-wide slot for the transport that carries approval questions out.

Empty by default, and deliberately so. Delivering an approval question needs a
real owner contact — an address, a chat id, a room — and this runtime has no
owner→channel mapping yet. Guessing one is worse than the stall it would fix:
the notification either goes nowhere, or it describes a pending tool call to
whoever happens to be in the room.

So the contract is: a deployment that *does* know how to reach the owner
installs a transport here during startup, and every turn from then on picks it
up. Until one does, the slot stays empty and approvals behave exactly as they
did before this module existed — the UI answers, or the request is denied.

Installing a transport is a security decision, not a convenience one. What may
be asked over it is still gated by ``remote_eligibility`` (medium risk, no
dangerous tool, no injection taint), and the reply's authenticity is still the
transport's own problem — see ``RemoteApprovalTokenStore`` for the one-time
tokens a responder is expected to consume before handing a decision back.
"""

from __future__ import annotations

import logging
import threading

from runtime.safety.approval.notifying_provider import RemoteApprovalTransport

_logger = logging.getLogger(__name__)

_lock = threading.Lock()
_transport: RemoteApprovalTransport | None = None


def set_remote_approval_transport(transport: RemoteApprovalTransport | None) -> None:
    """Install (or clear, with ``None``) the process-wide approval transport.

    Called at most once per process by whatever owns the contact mapping.
    Replacing a live transport is allowed — a reconfigured channel should take
    effect on the next turn rather than needing a restart — but it is logged,
    because two components fighting over this slot is a deployment bug.
    """

    global _transport
    with _lock:
        if _transport is not None and transport is not None and transport is not _transport:
            _logger.warning(
                "remote approval transport replaced (%s -> %s)",
                type(_transport).__name__,
                type(transport).__name__,
            )
        _transport = transport


def remote_approval_transport() -> RemoteApprovalTransport | None:
    """The installed transport, or ``None`` when nobody can be reached."""

    with _lock:
        return _transport


__all__ = ["remote_approval_transport", "set_remote_approval_transport"]
