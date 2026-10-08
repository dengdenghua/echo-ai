from __future__ import annotations

import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.adapters.integrations.local_auth.config import LocalAuthConfig
from runtime.adapters.integrations.local_auth.router import create_local_auth_router
from runtime.safety.auth.identity import (
    DurableIdentityStore,
    Identity,
    IdentityStore,
    encode_jwt_hs256,
)

SECRET = "test-session-revocation-secret-with-entropy-123456!"


def test_all_auth_config_paths_use_eight_hour_defaults():
    from runtime.adapters.integrations.oct.config import OctConfig
    from runtime.platform.config.schema import LocalAuthConfig as SchemaLocalAuthConfig
    from runtime.platform.config.schema import OctConfig as SchemaOctConfig

    for config_class in (LocalAuthConfig, OctConfig, SchemaLocalAuthConfig, SchemaOctConfig):
        assert config_class().jwt_expire_seconds == 28_800
        assert config_class(jwt_expire_seconds=3600).jwt_expire_seconds == 3600


def test_logout_revokes_only_presented_token_across_restart_and_workers(tmp_path):
    path = tmp_path / "identities.json"
    store = DurableIdentityStore(path)
    store.add(Identity("alice"))
    other_worker = DurableIdentityStore(path)
    claims = {"sub": "alice", "exp": int(time.time()) + 3600}
    first = encode_jwt_hs256(claims, secret=SECRET)
    replacement = encode_jwt_hs256(claims, secret=SECRET)
    assert first != replacement
    assert store.revoke_jwt(first, secret=SECRET)
    for verifier in (store, other_worker, DurableIdentityStore(path)):
        assert verifier.verify_jwt(first, secret=SECRET) is None
        assert verifier.verify_jwt(replacement, secret=SECRET) is not None
    assert first.encode() not in path.with_suffix(".revocations.db").read_bytes()


def test_local_logout_cookie_and_bearer_are_revoked(monkeypatch):
    monkeypatch.setenv("ECHO_ENV", "development")
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "local")
    store = IdentityStore()
    app = FastAPI()
    app.include_router(
        create_local_auth_router(
            config=LocalAuthConfig(enabled=True, allow_any_username=True, jwt_secret=SECRET),
            identity_store=store,
        )
    )
    with TestClient(app) as client:
        for use_header in (False, True):
            login = client.post("/api/auth/local/login", json={"username": "alice"})
            assert login.status_code == 200
            token = login.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            if use_header:
                client.cookies.clear()
            assert (
                client.post(
                    "/api/auth/local/logout", headers=headers if use_header else {}
                ).status_code
                == 204
            )
            assert client.get("/api/auth/local/whoami", headers=headers).status_code == 401


def test_corrupt_revocation_store_fails_closed(tmp_path):
    path = tmp_path / "identities.json"
    store = DurableIdentityStore(path)
    store.add(Identity("alice"))
    token = encode_jwt_hs256({"sub": "alice", "exp": time.time() + 3600}, secret=SECRET)
    path.with_suffix(".revocations.db").write_bytes(b"corrupted")
    assert store.verify_jwt(token, secret=SECRET) is None


def test_generic_logout_revokes_bearer_and_cookie_sessions():
    from runtime.execution.suckers.registry import SkillRegistry
    from runtime.sensing.gateway.meta_router import create_meta_router

    store = IdentityStore()
    store.add(Identity("alice"))
    app = FastAPI()
    app.include_router(
        create_meta_router(
            registry=SkillRegistry(), identity_store=store, jwt_secret=SECRET, require_auth=True
        )
    )
    with TestClient(app) as client:
        for use_cookie in (False, True):
            token = encode_jwt_hs256({"sub": "alice", "exp": time.time() + 3600}, secret=SECRET)
            headers = {"Authorization": f"Bearer {token}"}
            if use_cookie:
                client.cookies.set("echo_session", token)
            assert client.get("/api/auth/me", headers=headers).status_code == 200
            assert client.post("/api/auth/logout", headers={} if use_cookie else headers).is_success
            assert client.get("/api/auth/me", headers=headers).status_code == 401
