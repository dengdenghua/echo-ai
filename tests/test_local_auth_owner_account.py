"""Self-hosted owner account: first-run setup code, then a password, LAN only."""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.adapters.integrations.local_auth import owner as owner_module
from runtime.adapters.integrations.local_auth.config import (
    hash_password,
    local_login_enabled,
    network_bind_authenticated,
    owner_account_candidate,
    owner_account_enabled,
)
from runtime.adapters.integrations.local_auth.owner import (
    OwnerAccountStore,
    is_local_network_address,
    owner_login_provider,
    with_owner_jwt_secret,
)
from runtime.adapters.integrations.local_auth.router import create_local_auth_router
from runtime.platform.config.schema import LocalAuthConfig
from runtime.safety.auth.identity import IdentityStore

_SECRET = "Owner!9AccountJwtSecretWithEnoughLength123"
_PASSWORD = "correct horse battery"
_PUBLIC = "93.184.216.34"


@pytest.fixture
def self_hosted(monkeypatch):
    monkeypatch.delenv("ECHO_ENV", raising=False)
    monkeypatch.delenv("ECHO_DESKTOP", raising=False)
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "local")


def _config(**overrides):
    values = {"enabled": True, "allow_any_username": True, "jwt_secret": _SECRET}
    values.update(overrides)
    return LocalAuthConfig(**values)


def _client(tmp_path, host="127.0.0.1", config=None):
    identities = IdentityStore()
    store = OwnerAccountStore(tmp_path / "auth")
    app = FastAPI()
    app.include_router(
        create_local_auth_router(
            config=config or _config(), identity_store=identities, owner_store=store
        )
    )
    return TestClient(app, client=(host, 50000)), store, identities


def _setup(client, store, **overrides):
    body = {"username": "ada", "password": _PASSWORD, "setup_code": store.setup_code()}
    body.update(overrides)
    return client.post("/api/auth/local/owner/setup", json=body)


def test_passwordless_config_is_an_owner_account_only_when_self_hosted(monkeypatch, self_hosted):
    config = _config()
    assert owner_account_enabled(config)
    assert local_login_enabled(config)
    assert not owner_account_enabled(_config(jwt_secret=None))
    assert not owner_account_candidate(_config(users={"admin": hash_password("pw-for-admin")}))
    assert not owner_account_candidate(_config(enabled=False))
    monkeypatch.setenv("ECHO_ENV", "development")
    assert not owner_account_candidate(config)
    monkeypatch.delenv("ECHO_ENV")
    monkeypatch.setenv("ECHO_DESKTOP", "1")
    assert not owner_account_candidate(config)
    monkeypatch.delenv("ECHO_DESKTOP")
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "shared")
    assert not owner_account_candidate(config)


def test_first_run_setup_signs_the_owner_in_as_admin(tmp_path, self_hosted):
    client, store, identities = _client(tmp_path)
    with client:
        before = client.post(
            "/api/auth/local/login", json={"username": "ada", "password": _PASSWORD}
        )
        assert before.status_code == 409
        assert store.setup_code_path.is_file()

        response = _setup(client, store, display_name="Ada")
        assert response.status_code == 200, response.text
        assert response.json()["access_token"]
        assert response.json()["user"]["display_name"] == "Ada"
        assert "echo_session" in response.headers.get("set-cookie", "")
        assert not store.setup_code_path.exists()
        assert "admin" in identities.get("local:ada").roles

        again = _setup(client, store, username="mallory")
        assert again.status_code == 409
        assert identities.get("local:mallory") is None


def test_owner_signs_in_with_password_only(tmp_path, self_hosted):
    client, store, identities = _client(tmp_path)
    with client:
        assert _setup(client, store).status_code == 200
        wrong = client.post(
            "/api/auth/local/login", json={"username": "ada", "password": "not it at all"}
        )
        assert wrong.status_code == 401
        nobody = client.post("/api/auth/local/login", json={"username": "ada"})
        assert nobody.status_code == 401
        other = client.post(
            "/api/auth/local/login", json={"username": "guest", "password": _PASSWORD}
        )
        assert other.status_code == 401
        ok = client.post("/api/auth/local/login", json={"username": "ADA", "password": _PASSWORD})
        assert ok.status_code == 200
        assert ok.json()["actor_id"] == "local:ada"
    assert identities.get("local:guest") is None


def test_wrong_setup_code_is_refused_and_rate_limited(tmp_path, self_hosted):
    client, store, _ = _client(tmp_path, config=_config(login_max_failures=3))
    with client:
        statuses = [
            _setup(client, store, setup_code="AAAA-BBBB-CCCC").status_code for _ in range(4)
        ]
        assert statuses[:2] == [401, 401]
        assert statuses[-1] == 429
    assert store.setup_required()


def test_setup_code_survives_a_restart_and_is_announced(tmp_path, self_hosted, caplog):
    first = OwnerAccountStore(tmp_path / "auth").setup_code()
    assert len(first) == 14 and first.count("-") == 2
    assert OwnerAccountStore(tmp_path / "auth").setup_code() == first
    assert OwnerAccountStore(tmp_path / "auth").setup_code_matches(first.lower().replace("-", " "))
    with caplog.at_level(logging.WARNING):
        _client(tmp_path)
    assert first in caplog.text


def test_short_password_keeps_the_code_valid(tmp_path, self_hosted):
    client, store, _ = _client(tmp_path)
    with client:
        assert _setup(client, store, password="short").status_code == 400
        assert store.setup_required()
        assert _setup(client, store).status_code == 200


@pytest.mark.parametrize(
    "host,headers,status",
    [
        ("192.168.1.20", {}, 200),
        ("10.0.0.7", {}, 200),
        ("100.101.102.103", {}, 200),
        (_PUBLIC, {}, 403),
        ("127.0.0.1", {"X-Forwarded-For": _PUBLIC}, 403),
        ("127.0.0.1", {"Forwarded": f"for={_PUBLIC};proto=https"}, 403),
        ("127.0.0.1", {"X-Forwarded-For": "192.168.1.5"}, 200),
    ],
)
def test_owner_account_stays_on_this_machine_and_the_lan(
    tmp_path, self_hosted, host, headers, status
):
    client, store, _ = _client(tmp_path, host=host)
    code = store.setup_code()
    with client:
        setup = client.post(
            "/api/auth/local/owner/setup",
            json={"username": "ada", "password": _PASSWORD, "setup_code": code},
            headers=headers,
        )
        assert setup.status_code == status, setup.text
        login = client.post(
            "/api/auth/local/login",
            json={"username": "ada", "password": _PASSWORD},
            headers=headers,
        )
        assert login.status_code == status
    assert store.setup_required() is (status != 200)


def test_setup_route_is_closed_outside_owner_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("ECHO_ENV", "development")
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "local")
    client, store, identities = _client(tmp_path)
    with client:
        assert _setup(client, store).status_code == 404
    assert identities.get("local:ada") is None


def test_local_network_addresses():
    for value in ("127.0.0.1", "::1", "10.1.2.3", "172.20.0.1", "192.168.0.9", "fe80::1"):
        assert is_local_network_address(value), value
    for value in (_PUBLIC, "8.8.8.8", "2001:4860:4860::8888", "unknown", ""):
        assert not is_local_network_address(value), value
    assert is_local_network_address("::ffff:192.168.1.4")


def _request(host, headers=None):
    return SimpleNamespace(client=SimpleNamespace(host=host), headers=headers or {})


def test_login_provider_entry(tmp_path, self_hosted):
    store = OwnerAccountStore(tmp_path / "auth")
    assert owner_login_provider(_request(_PUBLIC), store) is None
    loopback = owner_login_provider(_request("127.0.0.1"), store)
    assert loopback["owner_account"] is True
    assert loopback["owner_setup_required"] is True
    assert loopback["setup_code_path"] == str(store.setup_code_path)
    lan = owner_login_provider(_request("192.168.1.4"), store)
    assert "setup_code_path" not in lan
    store.create("ada", _PASSWORD, None)
    after = owner_login_provider(_request("192.168.1.4"), store)
    assert after["owner_setup_required"] is False
    assert after["owner_username"] == "ada"


def test_owner_account_makes_a_lan_bind_safe_but_dev_login_does_not(monkeypatch, self_hosted):
    assert network_bind_authenticated(_config(), "local")
    assert not network_bind_authenticated(_config(), "shared")
    assert not network_bind_authenticated(_config(enabled=False), "local")
    monkeypatch.setenv("ECHO_ENV", "development")
    assert not network_bind_authenticated(_config(), "local")


def test_owner_install_gets_a_persistent_signing_key(tmp_path, monkeypatch, self_hosted):
    monkeypatch.setattr(owner_module, "owner_directory", lambda: tmp_path / "auth")
    cfg = SimpleNamespace(
        local_auth=_config(jwt_secret=None),
        oct=SimpleNamespace(enabled=False, jwt_secret=None),
    )
    cfg.model_copy = lambda update: SimpleNamespace(**{**vars(cfg), **update})
    first = with_owner_jwt_secret(cfg).local_auth.jwt_secret
    second = with_owner_jwt_secret(cfg).local_auth.jwt_secret
    assert first and first == second
    assert owner_account_enabled(with_owner_jwt_secret(cfg).local_auth)

    cfg.oct = SimpleNamespace(enabled=True, jwt_secret=_SECRET)
    assert with_owner_jwt_secret(cfg) is cfg


def test_desktop_token_is_refused_once_the_shell_is_gone(tmp_path, monkeypatch, self_hosted):
    from runtime.adapters.integrations.local_auth import config as local_auth_config

    token = "Od9-desktop-owner-token-0123456789abcdef"
    local_auth_config.configure_desktop_owner_token(token)
    try:
        client, store, _ = _client(tmp_path, config=_config(admin_usernames=["*"]))
        with client:
            body = {"username": "owner", "password": token}
            assert client.post("/api/auth/local/login", json=body).status_code == 409
            assert _setup(client, store).status_code == 200
            assert client.post("/api/auth/local/login", json=body).status_code == 401
    finally:
        local_auth_config.configure_desktop_owner_token(None)


def test_app_offers_the_owner_account_beside_email(tmp_path, monkeypatch, self_hosted):
    from runtime.adapters.integrations.oct.config import OctConfig
    from runtime.platform.ui import create_app

    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    app = create_app(
        cocoloop_require_auth=True,
        oct_config=OctConfig(enabled=True, jwt_secret=_SECRET),
        local_auth_config=_config(admin_usernames=["*"]),
    )
    remote = TestClient(app, client=(_PUBLIC, 50000))
    providers = remote.get("/api/auth/providers").json()["providers"]
    assert [provider["id"] for provider in providers] == ["oct"]

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        providers = client.get("/api/auth/providers").json()["providers"]
        assert [provider["id"] for provider in providers] == ["oct", "local"]
        local = providers[1]
        assert local["owner_account"] is True and local["owner_setup_required"] is True
        code = (tmp_path / "data" / "auth" / "owner-setup-code.txt").read_text().strip()
        setup = client.post(
            "/api/auth/local/owner/setup",
            json={"username": "ada", "password": _PASSWORD, "setup_code": code},
        )
        assert setup.status_code == 200, setup.text
        headers = {"Authorization": f"Bearer {setup.json()['access_token']}"}
        me = client.get("/api/auth/me", headers=headers).json()
        assert me["actor_id"] == "local:ada"
        assert "admin" in me["roles"]
        local = client.get("/api/auth/providers").json()["providers"][1]
        assert local["owner_setup_required"] is False
        assert local["owner_username"] == "ada"
