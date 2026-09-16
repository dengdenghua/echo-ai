"""Describe execution ownership without confusing package provenance with OAuth identity."""
from __future__ import annotations

import json
import re
from typing import Any


def connector_ownership(conn: Any) -> dict[str, Any]:
    # Only inspect executable configuration, never descriptions or credentials.
    config = json.dumps({"cli": conn.cli, "mcp": conn.mcp_servers}, ensure_ascii=False)
    vendor_route = bool(re.search(r"workbuddy|codebuddy|(?:[./:]|^)codex(?:[./:]|$)", config, re.I))
    if vendor_route:
        state, label = "needs_adapter", "待 Echo 适配：存在第三方宿主专用配置"
    elif conn.cli:
        state, label = "cli_unverified", "Echo 调用官方 CLI · 登录隔离待验证"
    else:
        state, label = "echo_managed", "Echo 管理连接 · 授权后仍需验证"
    return {"execution_owner": "echo", "ownership_state": state, "ownership_label": label,
            "native_verified": False}
