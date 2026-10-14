"""Bind a decision to the pending request without binding to lease heartbeats."""

import hashlib
import json
from typing import Any


def approval_request_version(task: Any) -> str:
    metadata = getattr(task, "metadata", None)
    metadata = metadata if isinstance(metadata, dict) else {}
    hold = metadata.get("approval_hold")
    hold = hold if isinstance(hold, dict) else {}
    decisions = metadata.get("approval_decisions")
    payload = [
        "echo.approval_request.v1",
        str(getattr(task, "id", "")),
        str(getattr(task, "latest_checkpoint_id", "") or ""),
        str(metadata.get("approval_tool_name") or ""),
        str(metadata.get("approval_action") or ""),
        str(metadata.get("approval_reason") or getattr(task, "terminal_reason", "") or ""),
        len(decisions) if isinstance(decisions, list) else 0,
        str(hold.get("tool_call_id") or ""),
        str(hold.get("turn_id") or ""),
        str(hold.get("args_preview") or ""),
    ]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode("utf-8")).hexdigest()
