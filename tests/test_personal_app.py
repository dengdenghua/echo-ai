from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.suckers.kimi_compat_skills import _deploy_website
from runtime.platform.personal_apps import read_personal_app
from runtime.platform.runtime_policy import deployments
from runtime.sensing.gateway.deployments_router import create_deployments_router


def app_source(tmp_path: Path) -> Path:
    source = tmp_path / "calculator"
    source.mkdir()
    (source / "index.html").write_text(
        "<button onclick='this.textContent=2'>Add</button>", encoding="utf-8"
    )
    (source / "app.json").write_text(
        json.dumps(
            {
                "schema": "echo.app.v1",
                "id": "calculator",
                "name": "Calculator",
                "description": "An interactive calculator",
                "entry": "index.html",
                "version": "0.1.0",
                "permissions": [],
            }
        ),
        encoding="utf-8",
    )
    return source


def test_personal_app_install_is_listed_and_served_without_plugin(tmp_path, monkeypatch):
    source = app_source(tmp_path)
    root = tmp_path / "installed"
    monkeypatch.setattr(deployments, "deployments_root", lambda: root)
    monkeypatch.setattr(deployments, "current_tool_principal", lambda: ("alice", "team", "thread"))
    result = _deploy_website(local_dir=str(source), sandbox_dir=str(tmp_path))
    assert result["ok"] is True
    assert result["app"]["id"] == "calculator"
    entry = deployments.deployment_entries()[0]
    assert entry["owner_actor_id"] == "alice"
    assert not deployments.deployment_visible(entry, actor_id="bob", tenant_id="team")
    assert deployments.public_deployment(entry)["app"]["name"] == "Calculator"
    assert "source" not in deployments.public_deployment(entry)
    # Direct file serving preserves the generated-content sandbox.
    from runtime.safety.auth import Identity, IdentityStore

    identities = IdentityStore()
    identities.add(Identity(actor_id="alice"), api_key_plaintext="alice-key")
    identities.add(Identity(actor_id="bob"), api_key_plaintext="bob-key")
    # Use an empty tenant for this actor-only auth fixture.
    entry["tenant_id"] = ""
    deployments._save_manifest({"deployments": [entry]})
    api = FastAPI()
    api.include_router(create_deployments_router(identity_store=identities, require_auth=True))
    client = TestClient(api)
    url = f"/api/deployments/{entry['id']}/index.html"
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"Authorization": "Bearer bob-key"}).status_code == 404
    response = client.get(url, headers={"Authorization": "Bearer alice-key"})
    assert response.status_code == 200
    assert "allow-scripts" in response.headers["content-security-policy"]
    assert "allow-same-origin" not in response.headers["content-security-policy"]
    # Rapid updates must create distinct snapshots, not merge files.
    again = _deploy_website(local_dir=str(source), sandbox_dir=str(tmp_path))
    assert again["ok"] is True
    assert again["deployment"]["id"] != result["deployment"]["id"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", "../escape"),
        ("entry", "../index.html"),
        ("permissions", ["backend.api"]),
        ("version", "latest"),
    ],
)
def test_invalid_personal_app_never_installs(tmp_path, monkeypatch, field, value):
    source = app_source(tmp_path)
    path = source / "app.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest[field] = value
    path.write_text(json.dumps(manifest), encoding="utf-8")
    root = tmp_path / "installed"
    monkeypatch.setattr(deployments, "deployments_root", lambda: root)
    result = _deploy_website(local_dir=str(source), sandbox_dir=str(tmp_path))
    assert "invalid app manifest" in result["error"]
    assert not root.exists()


def test_ordinary_site_manifest_is_not_an_app(tmp_path):
    source = app_source(tmp_path)
    (source / "app.json").write_text('{"framework": "other"}', encoding="utf-8")
    assert read_personal_app(source) is None


def test_three_creators_are_loadable_as_independent_skills():
    from runtime.execution.suckers.market_skills import load_single_market_skill
    from runtime.execution.suckers.registry import SkillRegistry

    registry = SkillRegistry()
    for name in ("skill-creator", "app-creator", "plugin-creator"):
        assert load_single_market_skill(registry, name, verify_tests=False)
        assert registry.has(name)
