from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from runtime.execution.agents.preparation import RolePreparationError, inspect_connector
from runtime.platform.capabilities.tenant_context import (
    current_capability_scope,
    use_capability_scope,
)
from runtime.safety.auth.scope import TenantScope
from runtime.sensing.gateway.realtime_preparation import require_role_connections


def _turn(actor="alice", tenant="acme"):
    return SimpleNamespace(params=SimpleNamespace(owner_actor_id=actor, tenant_id=tenant))


def _agent(ids=None):
    return SimpleNamespace(agent_id="eve", dependencies={"connectors": ids or ["mail"]})


def _registry(**changes):
    item = {
        "id": "mail",
        "source": "connector",
        "installed": True,
        "enabled": True,
        "auth_mode": "token",
        **changes,
    }
    return Mock(get=Mock(return_value=item), status=Mock(return_value={"connected": True}))


@pytest.mark.parametrize(
    "changes,state",
    [
        ({"installed": False}, "install"),
        ({"enabled": False}, "disabled"),
        ({"permission_review_required": True}, "permissions"),
        ({"permission_active": False}, "permissions"),
        ({"source": "codex_plugin"}, "unknown"),
        ({"id": "mail-extra"}, "unknown"),
        ({"auth_mode": "none"}, "configured"),
    ],
)
def test_configuration_checks_precede_credentials(changes, state):
    registry = _registry(**changes)
    assert inspect_connector("mail", registry)["state"] == state
    registry.status.assert_not_called()


@pytest.mark.asyncio
async def test_legacy_role_does_not_touch_credentials():
    registry = _registry()
    await require_role_connections(_turn(), SimpleNamespace(agent_id="eve"), registry=registry)
    assert registry.mock_calls == []


@pytest.mark.asyncio
async def test_repair_is_rechecked_and_never_performed_by_preparation():
    registry = _registry()
    registry.status.return_value = {"connected": False}
    with pytest.raises(RolePreparationError) as caught:
        await require_role_connections(_turn(), _agent(), registry=registry)
    assert caught.value.info["checks"] == [{"id": "mail", "state": "connect"}]
    registry.status.return_value = {"connected": True}
    await require_role_connections(_turn(), _agent(), registry=registry)
    assert {call[0] for call in registry.mock_calls} == {"get", "status"}


@pytest.mark.asyncio
@pytest.mark.parametrize("actor,tenant", [("alice", "acme"), (None, None)])
async def test_scope_comes_from_turn_and_cannot_inherit_other_session(actor, tenant):
    registry = _registry()
    seen = []

    def status(_cid):
        seen.append(current_capability_scope())
        return {"connected": True}

    registry.status.side_effect = status
    other = TenantScope(tenant_id="other", actor_id="bob")
    with use_capability_scope(other):
        await require_role_connections(_turn(actor, tenant), _agent(), registry=registry)
        assert current_capability_scope() == other
    expected = TenantScope(tenant_id=tenant, actor_id=actor) if actor else None
    assert seen == [expected]


@pytest.mark.asyncio
async def test_partial_identity_blocks_before_catalog_access():
    registry = _registry()
    with pytest.raises(RolePreparationError):
        await require_role_connections(_turn("alice", None), _agent(), registry=registry)
    assert registry.mock_calls == []


@pytest.mark.asyncio
async def test_failure_receipt_contains_no_credentials():
    registry = _registry()
    registry.status.side_effect = RuntimeError("Authorization: Bearer secret-test-value")
    with pytest.raises(RolePreparationError) as caught:
        await require_role_connections(_turn(), _agent(), registry=registry)
    assert caught.value.info["checks"] == [{"id": "mail", "state": "unknown"}]
    assert "secret-test-value" not in str(caught.value.info)
    assert "secret-test-value" not in str(caught.value)
