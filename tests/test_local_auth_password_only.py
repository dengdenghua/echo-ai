import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.adapters.integrations.local_auth.config import LocalAuthConfig, hash_password
from runtime.adapters.integrations.local_auth.router import create_local_auth_router


@pytest.mark.parametrize(
    "environment,mode,host,origin,password,status",
    [
        ("development", "local", "127.0.0.1", "http://localhost:4173", "test-pin", 200),
        ("development", "local", "127.0.0.1", "http://localhost:4173", "wrong", 401),
        ("production", "local", "127.0.0.1", None, "test-pin", 503),
        ("development", "shared", "127.0.0.1", None, "test-pin", 503),
        ("development", "local", "192.0.2.1", None, "test-pin", 403),
        ("development", "local", "127.0.0.1", "https://example.com", "test-pin", 403),
    ],
)
def test_password_only_login_boundaries(
    monkeypatch, environment, mode, host, origin, password, status
):
    monkeypatch.setenv("ECHO_ENV", environment)
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", mode)
    config = LocalAuthConfig(
        enabled=True, users={"owner": hash_password("test-pin")}, password_only_username="owner"
    )
    app = FastAPI()
    app.include_router(create_local_auth_router(config=config))
    with TestClient(app, client=(host, 50000)) as client:
        response = client.post(
            "/api/auth/local/login",
            json={"username": "owner", "password": password},
            headers={"Origin": origin} if origin else {},
        )
    assert response.status_code == status


def test_password_only_requires_hashed_account():
    with pytest.raises(ValueError, match="configured password hash"):
        LocalAuthConfig(enabled=True, allow_any_username=True, password_only_username="owner")


@pytest.mark.parametrize("mode", ["production", "shared", "server", "commercial"])
def test_deployed_password_accounts_require_credentials(monkeypatch, mode):
    monkeypatch.setenv("ECHO_ENV", "production")
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", mode)
    config = LocalAuthConfig(
        enabled=True,
        allow_any_username=True,
        users={"admin": hash_password("admin-test-password")},
        jwt_secret="Test!9ProductionAccountsRequireCredentials123",
    )
    app = FastAPI()
    app.include_router(create_local_auth_router(config=config))
    with TestClient(app, client=("192.0.2.1", 50000)) as client:
        for body in [
            {"username": "admin"},
            {"username": "admin", "password": "wrong"},
            {"username": "stranger", "password": "admin-test-password"},
        ]:
            assert client.post("/api/auth/local/login", json=body).status_code == 401
        login = client.post(
            "/api/auth/local/login",
            json={"username": "admin", "password": "admin-test-password"},
        )
    assert login.status_code == 200
    assert login.json()["access_token"]


@pytest.mark.parametrize(
    "users,secret",
    [
        ({}, None),
        ({}, "Strong!9TestJwtSecretWithLength123456"),
        ({"admin": "sha256:" + "a" * 64}, None),
    ],
)
def test_deployed_login_cannot_fall_back_to_passwordless_or_unsigned(monkeypatch, users, secret):
    monkeypatch.setenv("ECHO_ENV", "production")
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "shared")
    app = FastAPI()
    app.include_router(
        create_local_auth_router(
            config=LocalAuthConfig(
                enabled=True,
                allow_any_username=True,
                users=users,
                jwt_secret=secret,
            )
        )
    )
    with TestClient(app) as client:
        assert client.post("/api/auth/local/login", json={"username": "admin"}).status_code == 503


def test_config_loader_preserves_bcrypt_salt(monkeypatch):
    from runtime.platform.config.loader import _interpolate_env

    encoded = "bcrypt:$2b$12$ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyza"
    monkeypatch.setenv("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "must-not-replace")
    assert _interpolate_env(encoded) == encoded


@pytest.mark.parametrize(
    "host,origin,status",
    [
        ("127.0.0.1", "http://localhost:13310", 200),
        ("127.0.0.1", None, 200),
        ("192.168.1.20", None, 403),
        ("127.0.0.1", "http://evil.example", 403),
    ],
)
def test_passwordless_dev_login_stays_on_this_machine(monkeypatch, host, origin, status):
    # Dev mode with no password accounts signs anyone in by name; a server
    # bound to the LAN must not hand those sessions to other machines.
    monkeypatch.setenv("ECHO_ENV", "development")
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "local")
    config = LocalAuthConfig(enabled=True, allow_any_username=True, admin_usernames=["*"])
    app = FastAPI()
    app.include_router(create_local_auth_router(config=config))
    with TestClient(app, client=(host, 50000)) as client:
        response = client.post(
            "/api/auth/local/login",
            json={"username": "guest"},
            headers={"Origin": origin} if origin else {},
        )
    assert response.status_code == status
