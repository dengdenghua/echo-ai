"""Project claim lease policy using the shared native process identity."""

from __future__ import annotations

import math
from typing import Any

from runtime.platform.process.process_identity import (
    _process_namespace,
    _process_stamp,
)
from runtime.platform.process.process_identity import claim_owner_alive as _owner_alive
from runtime.platform.process.process_identity import current_claim_owner as _current_owner

DEFAULT_CLAIM_LEASE_SECONDS = 60 * 60


def current_claim_owner() -> str:
    return _current_owner(stamp_probe=_process_stamp, namespace_probe=_process_namespace)


def claim_owner_alive(owner: str) -> bool | None:
    return _owner_alive(owner, stamp_probe=_process_stamp, namespace_probe=_process_namespace)


def claim_lease_seconds(value: Any) -> float:
    if isinstance(value, bool):
        raise ValueError("claim lease must be finite and positive")
    seconds = float(value)
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("claim lease must be finite and positive")
    return seconds


def abandoned_on_restart(owner: str, claimed_at: float, lease: float, cutoff: float) -> bool:
    # Expiry remains authoritative even when the process is alive but stopped
    # renewing. Unexpired foreign/legacy/unsupported records are preserved.
    return claimed_at <= cutoff and (
        claimed_at + claim_lease_seconds(lease) <= cutoff or claim_owner_alive(owner) is False
    )
