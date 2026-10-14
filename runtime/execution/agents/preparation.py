"""Required connector preparation, separate from permission enforcement and execution."""

from __future__ import annotations

from typing import Any


class RolePreparationError(RuntimeError):
    def __init__(self, agent_id: str, connectors: list[str], checks: list[dict[str, str]]):
        super().__init__("角色所需的连接尚未准备好。请完成连接后继续当前任务。")
        self.info = {
            "code": "role_connections_unavailable",
            "agent_id": agent_id,
            "connectors": list(connectors),
            "checks": checks,
            "failure_kind": "capability",
            "disposition": "blocked_on_user",
            "scope": "required_connector_configuration",
        }


def inspect_connector(cid: str, registry: Any) -> dict[str, str]:
    """Read current scoped state. Never install, enable, connect or grant access."""
    result = {"id": cid, "state": "unknown"}
    try:
        item = registry.get(cid)
        if item is None:
            return {**result, "state": "missing"}
        if item.get("id") != cid or item.get("source") != "connector":
            return result
        if item.get("installed") is not True:
            return {**result, "state": "install"}
        if item.get("permission_review_required") or item.get("permission_active") is False:
            return {**result, "state": "permissions"}
        if item.get("enabled") is not True:
            return {**result, "state": "disabled"}
        if item.get("auth_mode") == "none":
            return {**result, "state": "configured"}
        connected = registry.status(cid).get("connected")
        if connected is True:
            return {**result, "state": "configured"}
        if connected is False:
            return {**result, "state": "connect"}
    except Exception:  # noqa: BLE001 - public diagnostics must not expose credentials
        pass
    return result
