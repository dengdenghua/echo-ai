"""Bounded, process-local browser receipts. Never treat a payload as a rendered UI."""

from __future__ import annotations

import secrets
import threading
import time
from collections import OrderedDict
from typing import Any

from runtime.safety.auth.scope import TenantScope

_LOCK = threading.Lock()
_RECEIPTS: OrderedDict[str, dict[str, Any]] = OrderedDict()
MAX_RECEIPTS = 512
RECEIPT_TTL = 3600


def _owner(scope: TenantScope | None) -> tuple[str, str] | None:
    return (scope.tenant_id, scope.actor_id) if scope else None


def _expire() -> None:
    cutoff = time.monotonic() - RECEIPT_TTL
    for key in list(_RECEIPTS):
        if _RECEIPTS[key]["created"] < cutoff:
            del _RECEIPTS[key]


def create_visual(scope: TenantScope | None, thread_id: str) -> dict[str, Any]:
    visual_id = secrets.token_urlsafe(18)
    token = secrets.token_urlsafe(32)
    with _LOCK:
        _expire()
        while len(_RECEIPTS) >= MAX_RECEIPTS:
            _RECEIPTS.popitem(last=False)
        _RECEIPTS[visual_id] = {
            "owner": _owner(scope),
            "thread_id": thread_id,
            "token": token,
            "created": time.monotonic(),
            "status": "pending",
            "detail": "",
        }
    return {
        "ok": True,
        "kind": "echo.visual.v1",
        "visual_id": visual_id,
        "receipt_token": token,
        "thread_id": thread_id,
        "status": "pending",
        "note": "Payload accepted; browser rendering and content correctness are not verified.",
    }


def report_visual(
    visual_id: str,
    token: str,
    scope: TenantScope | None,
    status: str,
    detail: str = "",
) -> bool:
    if status not in {"rendered", "error"}:
        return False
    with _LOCK:
        _expire()
        row = _RECEIPTS.get(visual_id)
        if not row or row["owner"] != _owner(scope):
            return False
        if not secrets.compare_digest(row["token"], token):
            return False
        # An error is sticky for this immutable payload, even across viewer mounts.
        if row["status"] != "error":
            row.update(status=status, detail=detail[:1000])
        return True


def visual_status(visual_id: str, scope: TenantScope | None, thread_id: str) -> dict[str, Any]:
    with _LOCK:
        _expire()
        row = _RECEIPTS.get(visual_id)
        if not row or row["owner"] != _owner(scope) or row["thread_id"] != thread_id:
            return {"visual_id": visual_id, "status": "unknown"}
        return {
            "visual_id": visual_id,
            "status": row["status"],
            "detail": row["detail"],
            "note": "Browser receipt only; not verification of semantics or visual quality.",
        }
