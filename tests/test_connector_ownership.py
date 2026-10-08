from types import SimpleNamespace

from runtime.platform.connectors.auth_orchestrator import AuthOrchestrator
from runtime.platform.connectors.ownership import connector_ownership


def test_vendor_specific_routes_are_not_declared_echo_native():
    conn = SimpleNamespace(
        cli={}, mcp_servers={"server": {"headers": {"X-Request-Source": "workbuddy"}}}
    )
    assert connector_ownership(conn)["ownership_state"] == "needs_adapter"


def test_cli_requires_verification_even_when_not_vendor_specific():
    conn = SimpleNamespace(cli={"auth": "dws auth login"}, mcp_servers={})
    assert connector_ownership(conn)["ownership_state"] == "cli_unverified"
    assert not connector_ownership(conn)["native_verified"]


def test_json_status_boolean_and_all_declared_fields():
    conn = SimpleNamespace(
        cli={"statusMatchJson": {"authenticated": "true", "organization": "expected"}}
    )
    assert AuthOrchestrator._match_status(conn, '{"authenticated":true,"organization":"expected"}')
    assert not AuthOrchestrator._match_status(conn, '{"authenticated":true,"organization":"other"}')
    assert not AuthOrchestrator._match_status(
        conn, '{"authenticated":false,"organization":"expected"}'
    )
    conn.cli["statusMatch"] = "authenticated"
    assert not AuthOrchestrator._match_status(conn, '{"authenticated":true,"organization":"other"}')
