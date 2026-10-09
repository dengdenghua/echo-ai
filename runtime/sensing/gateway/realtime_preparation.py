"""Role preparation before starting an engine; ownership comes from validated TurnParams."""

from __future__ import annotations

import asyncio
from typing import Any

from runtime.execution.agents.dependencies import normalize_role_dependencies
from runtime.execution.agents.preparation import RolePreparationError, inspect_connector
from runtime.safety.auth.scope import TenantScope


async def require_role_connections(turn: Any, agent: Any, *, registry: Any = None) -> None:
    connectors = normalize_role_dependencies(getattr(agent, "dependencies", None))["connectors"]
    if not connectors:
        return
    agent_id = str(agent.agent_id)
    unknown = [{"id": cid, "state": "unknown"} for cid in connectors]
    actor, tenant = turn.params.owner_actor_id, turn.params.tenant_id
    if bool(actor) != bool(tenant):
        raise RolePreparationError(agent_id, connectors, unknown)
    scope = TenantScope(tenant_id=tenant, actor_id=actor) if actor and tenant else None

    def create_registry() -> Any:
        from runtime.platform.capabilities.capability_registry import CapabilityRegistry
        from runtime.platform.capabilities.tenant_context import use_capability_scope

        with use_capability_scope(scope):
            return CapabilityRegistry()

    def inspect(cid: str) -> dict[str, str]:
        from runtime.platform.capabilities.tenant_context import use_capability_scope

        # Scope is explicit even for local mode: never borrow another active session.
        with use_capability_scope(scope):
            return inspect_connector(cid, registry)

    checks: list[dict[str, str]] = []
    try:
        async with asyncio.timeout(15):
            if registry is None:
                registry = await asyncio.to_thread(create_registry)
            for offset in range(0, len(connectors), 4):
                checks.extend(
                    await asyncio.gather(
                        *(
                            asyncio.to_thread(inspect, cid)
                            for cid in connectors[offset : offset + 4]
                        )
                    )
                )
    except Exception:  # noqa: BLE001 - no credential/configuration internals in receipts
        # Preserve any completed checks; pending/failed lookups remain explicitly unknown.
        checks.extend(unknown[len(checks) :])
    if any(item["state"] != "configured" for item in checks):
        raise RolePreparationError(agent_id, connectors, checks)
