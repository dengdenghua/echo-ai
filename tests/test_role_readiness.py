from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.agents.readiness import inspect_role_registration
from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.sensing.gateway.agent_world_router import create_agent_world_router


def _handler(*args, **kwargs):
    raise AssertionError("readiness must never execute tools")


def _catalog():
    registry = SkillRegistry()
    for name in ["call_agent", "web_search", "ad-creative"]:
        registry.register(
            Skill(name=name, trusted_source="test://readiness", handler=_handler),
            verify_tests=False,
        )
    registry.disable("web_search")
    registry.disable("ad-creative")
    return registry


def test_reports_registration_without_claiming_execution_or_changing_state():
    skills = _catalog()
    agent = SimpleNamespace(
        agent_id="test", extra_skills=["call_agent", "web_search", "missing", "call_agent", "*"]
    )
    result = inspect_role_registration(agent, skills)
    assert result["status"] == "needs_attention"
    assert result["checks"] == [
        {"name": "call_agent", "status": "registered"},
        {"name": "web_search", "status": "disabled"},
        {"name": "missing", "status": "missing"},
    ]
    assert "execution" in result["unchecked"]
    assert "connector_auth" in result["unchecked"]
    assert not skills.is_enabled("web_search")
    assert not skills.has("missing")


def test_disabled_canonical_skill_cannot_appear_ready_through_alias():
    result = inspect_role_registration(
        SimpleNamespace(agent_id="test", extra_skills=["ad-copywriter"]), _catalog()
    )
    assert result["checks"] == [{"name": "ad-copywriter", "status": "disabled"}]


def test_tenant_owned_skill_is_not_disclosed_in_shared_catalog():
    skills = SkillRegistry()
    skills.register(
        Skill(name="private", tenant_id="other", trusted_source="test://private", handler=_handler),
        verify_tests=False,
    )
    result = inspect_role_registration(
        SimpleNamespace(agent_id="test", extra_skills=["private"]), skills
    )
    assert result["status"] == "unknown"
    assert result["checks"] == [{"name": "private", "status": "unknown"}]


@pytest.mark.parametrize("names", [[], ["call_agent"]])
def test_missing_registry_is_unknown_even_without_additional_skills(names):
    assert (
        inspect_role_registration(SimpleNamespace(agent_id="test", extra_skills=names), None)[
            "status"
        ]
        == "unknown"
    )


def test_readiness_http_contract_and_registry_unavailability():
    class Roles:
        def get(self, name):
            if name != "test":
                raise KeyError(name)
            return SimpleNamespace(agent_id=name, extra_skills=["call_agent"])

    app = FastAPI()
    app.include_router(create_agent_world_router(registry=Roles(), skill_registry=_catalog()))
    client = TestClient(app)
    assert client.get("/api/agent-market/store/test/readiness").json()["status"] == "checked"
    assert client.get("/api/agent-market/store/absent/readiness").status_code == 404
    assert client.get("/api/agent-market/store/bad.id/readiness").status_code == 400
    unavailable = FastAPI()
    unavailable.include_router(create_agent_world_router())
    assert TestClient(unavailable).get("/api/agent-market/store/test/readiness").status_code == 503


def test_readiness_requires_authentication_when_enabled():
    app = FastAPI()
    app.include_router(create_agent_world_router(require_auth=True))
    assert TestClient(app).get("/api/agent-market/store/test/readiness").status_code == 401
