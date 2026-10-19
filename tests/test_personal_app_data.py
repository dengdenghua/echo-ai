from __future__ import annotations

import subprocess
import sys
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform.personal_app_data import (
    MAX_DATA_BYTES,
    AppDataConflict,
    AppDataUnavailable,
    PersonalAppData,
)
from runtime.platform.runtime_policy import deployments
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.deployments_router import create_deployments_router


def entry(owner="alice", tenant="team", app_id="customers", deployment_id="v1"):
    return {
        "id": deployment_id,
        "owner_actor_id": owner,
        "tenant_id": tenant,
        "app": {
            "schema": "echo.app.v1",
            "id": app_id,
            "name": "Customers",
            "permissions": ["app.storage", "task.request"],
        },
    }


def test_data_survives_snapshot_update_and_store_restart(tmp_path):
    first = PersonalAppData(entry(), root=tmp_path)
    missing = first.read("state")
    assert missing == {"value": None, "revision": 0, "deleted": True}
    saved = first.write("state", {"customers": ["Ada"]}, expected_revision=0)
    upgraded = PersonalAppData(entry(deployment_id="v2"), root=tmp_path)
    assert upgraded.read("state") == saved
    with pytest.raises(AppDataConflict):
        first.write("state", "stale", expected_revision=0)
    assert upgraded.read("state")["value"] == {"customers": ["Ada"]}
    deleted = upgraded.write("state", None, expected_revision=1, delete=True)
    assert deleted["revision"] == 2 and deleted["deleted"] is True
    with pytest.raises(AppDataConflict):
        first.write("state", "revive stale value", expected_revision=0)
    upgraded.write("state", "new", expected_revision=2)
    assert first.read("state")["revision"] == 3


@pytest.mark.parametrize(
    "other", [entry(owner="bob"), entry(tenant="elsewhere"), entry(app_id="notes")]
)
def test_data_isolated_by_owner_tenant_and_app(tmp_path, other):
    PersonalAppData(entry(), root=tmp_path).write("state", "private", expected_revision=0)
    assert PersonalAppData(other, root=tmp_path).read("state")["revision"] == 0


def test_invalid_or_oversize_writes_do_not_replace_saved_data(tmp_path):
    store = PersonalAppData(entry(), root=tmp_path)
    saved = store.write("state", "safe", expected_revision=0)
    for value in ("x" * MAX_DATA_BYTES, float("nan")):
        with pytest.raises(ValueError):
            store.write("state", value, expected_revision=1)
        assert store.read("state") == saved
    with pytest.raises(ValueError):
        store.write("../outside", "x", expected_revision=0)


def test_corrupted_store_is_not_silently_reset(tmp_path):
    store = PersonalAppData(entry(), root=tmp_path)
    store.path.write_text(
        '{"schema":"echo.app_data.v1","documents":{"state":42}}', encoding="utf-8"
    )
    before = store.path.read_bytes()
    with pytest.raises(AppDataUnavailable):
        store.write("state", "replacement", expected_revision=0)
    assert store.path.read_bytes() == before


def test_cross_process_compare_and_swap_does_not_deadlock_or_lose_updates(tmp_path):
    code = """
import sys
from pathlib import Path
from runtime.platform.personal_app_data import PersonalAppData, AppDataConflict
entry = {'owner_actor_id': 'alice', 'tenant_id': 'team', 'app': {'schema': 'echo.app.v1', 'id': 'customers'}}
try:
    PersonalAppData(entry, root=Path(sys.argv[1])).write('state', sys.argv[2], expected_revision=0)
except AppDataConflict:
    sys.exit(3)
"""
    processes = [
        subprocess.Popen(
            [sys.executable, "-c", code, str(tmp_path), value],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        for value in ("first", "second")
    ]
    try:
        for process in processes:
            _, stderr = process.communicate(timeout=30)
            assert process.returncode in {0, 3}, stderr.decode(errors="replace")
        assert sorted(process.returncode for process in processes) == [0, 3]
        assert PersonalAppData(entry(), root=tmp_path).read("state")["value"] in {"first", "second"}
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.communicate()


@pytest.fixture
def client(tmp_path, monkeypatch):
    from runtime.platform.process import paths

    monkeypatch.setattr(paths, "app_paths", lambda: SimpleNamespace(data_dir=tmp_path / "data"))
    root = tmp_path / "deployments"
    monkeypatch.setattr(deployments, "deployments_root", lambda: root)
    entries = [entry(), entry(deployment_id="v2"), entry(owner="bob", deployment_id="b1")]
    no_permission = entry(deployment_id="no-permission")
    no_permission["app"]["permissions"] = []
    entries += [no_permission, {"id": "site", "owner_actor_id": "alice", "tenant_id": "team"}]
    deployments._save_manifest({"deployments": entries})
    identities = IdentityStore()
    for actor in ("alice", "bob", "outsider"):
        identities.add(
            Identity(
                actor_id=actor, metadata={"tenant_id": "team" if actor != "outsider" else "other"}
            ),
            api_key_plaintext=actor,
        )
    app = FastAPI()
    app.include_router(create_deployments_router(identity_store=identities, require_auth=True))
    return TestClient(app)


def headers(actor="alice"):
    return {"Authorization": f"Bearer {actor}", "X-Echo-App-Bridge": "1"}


def test_app_data_api_requires_identity_ownership_permission_and_revision(client):
    url = "/api/personal-apps/v1/data/state"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=headers("bob")).status_code == 404
    assert (
        client.put(
            url, headers=headers("outsider"), json={"value": "x", "expected_revision": 0}
        ).status_code
        == 404
    )
    assert (
        client.get("/api/personal-apps/no-permission/data/state", headers=headers()).status_code
        == 403
    )
    assert client.get("/api/personal-apps/site/data/state", headers=headers()).status_code == 404
    assert (
        client.put(
            url,
            headers={"Authorization": "Bearer alice"},
            json={"value": "x", "expected_revision": 0},
        ).status_code
        == 403
    )
    assert client.put(url, headers=headers(), json={"value": "x"}).status_code == 400
    assert (
        client.put(
            url, headers=headers(), json={"value": "x", "expected_revision": True}
        ).status_code
        == 400
    )
    saved = client.put(url, headers=headers(), json={"value": {"n": 7}, "expected_revision": 0})
    assert saved.status_code == 200
    assert client.get("/api/personal-apps/v2/data/state", headers=headers()).json() == saved.json()
    assert (
        client.put(
            url, headers=headers(), json={"value": "stale", "expected_revision": 0}
        ).status_code
        == 409
    )
    assert (
        client.get("/api/personal-apps/b1/data/state", headers=headers("bob")).json()["revision"]
        == 0
    )
    deleted = client.put(url, headers=headers(), json={"delete": True, "expected_revision": 1})
    assert deleted.json() == {"value": None, "revision": 2, "deleted": True}
    assert (
        client.put(
            url, headers=headers(), json={"value": "x" * MAX_DATA_BYTES, "expected_revision": 2}
        ).status_code
        == 413
    )


def test_independent_catalog_filters_ordinary_sites_and_other_users(client):
    assert client.get("/api/personal-apps").status_code == 401
    apps = client.get("/api/personal-apps", headers=headers()).json()["apps"]
    assert {item["id"] for item in apps} == {"v1", "v2", "no-permission"}
    assert all("owner_actor_id" not in item and "path" not in item for item in apps)
