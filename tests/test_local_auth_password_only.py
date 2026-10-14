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


_DESKTOP_JWT_SECRET = "Desk!9OwnerTokenJwtSecretWithLength1234"
_DESKTOP_OWNER_TOKEN = "Od9-desktop-owner-token-0123456789abcdef"


@pytest.fixture
def desktop_owner(monkeypatch):
    from runtime.adapters.integrations.local_auth import config as local_auth_config

    monkeypatch.delenv("ECHO_ENV", raising=False)
    monkeypatch.setenv("ECHO_DESKTOP", "1")
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "local")
    local_auth_config.configure_desktop_owner_token(_DESKTOP_OWNER_TOKEN)
    yield local_auth_config
    local_auth_config.configure_desktop_owner_token(None)


def _desktop_config(**overrides):
    # Mirrors packaging/desktop/config.desktop.yaml's local_auth block.
    values = {
        "enabled": True,
        "allow_any_username": True,
        "admin_usernames": ["*"],
        "jwt_secret": _DESKTOP_JWT_SECRET,
    }
    values.update(overrides)
    return LocalAuthConfig(**values)


@pytest.mark.parametrize(
    "host,origin,password,status",
    [
        ("127.0.0.1", None, _DESKTOP_OWNER_TOKEN, 200),
        ("127.0.0.1", None, None, 401),
        ("127.0.0.1", None, "wrong-" + _DESKTOP_OWNER_TOKEN, 401),
        ("192.0.2.1", None, _DESKTOP_OWNER_TOKEN, 403),
        ("127.0.0.1", "https://evil.example", _DESKTOP_OWNER_TOKEN, 403),
    ],
)
def test_desktop_owner_login_requires_the_shell_token(
    desktop_owner, host, origin, password, status
):
    app = FastAPI()
    app.include_router(create_local_auth_router(config=_desktop_config()))
    body = {"username": "owner"}
    if password is not None:
        body["password"] = password
    with TestClient(app, client=(host, 50000)) as client:
        response = client.post(
            "/api/auth/local/login",
            json=body,
            headers={"Origin": origin} if origin else {},
        )
    assert response.status_code == status
    if status == 200:
        assert response.json()["access_token"]
        assert response.json()["actor_id"] == "local:owner"


@pytest.mark.parametrize(
    "env,token,overrides",
    [
        ({}, None, {}),
        # Without ECHO_DESKTOP the config is a self-hosted owner account; see
        # test_local_auth_owner_account.py for why the token stays refused.
        ({"ECHO_DEPLOYMENT_MODE": "shared"}, _DESKTOP_OWNER_TOKEN, {}),
        ({}, _DESKTOP_OWNER_TOKEN, {"jwt_secret": None}),
        ({}, "too-short", {}),
    ],
)
def test_desktop_owner_login_stays_closed_outside_the_desktop(
    desktop_owner, monkeypatch, env, token, overrides
):
    for name, value in env.items():
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    desktop_owner.configure_desktop_owner_token(token)
    config = _desktop_config(**overrides)
    assert desktop_owner.local_login_enabled(config) is False
    app = FastAPI()
    app.include_router(create_local_auth_router(config=config))
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        response = client.post(
            "/api/auth/local/login",
            json={"username": "owner", "password": _DESKTOP_OWNER_TOKEN},
        )
    assert response.status_code == 503


def test_desktop_owner_token_does_not_unlock_password_accounts(desktop_owner):
    config = _desktop_config(users={"admin": hash_password("admin-test-password")})
    assert desktop_owner.desktop_owner_login_enabled(config) is False
    app = FastAPI()
    app.include_router(create_local_auth_router(config=config))
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        response = client.post(
            "/api/auth/local/login",
            json={"username": "admin", "password": _DESKTOP_OWNER_TOKEN},
        )
    assert response.status_code == 401


def test_desktop_owner_token_guesses_are_rate_limited(desktop_owner):
    app = FastAPI()
    app.include_router(create_local_auth_router(config=_desktop_config(login_max_failures=3)))
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        statuses = [
            client.post(
                "/api/auth/local/login",
                json={"username": "owner", "password": f"guess-{attempt}"},
            ).status_code
            for attempt in range(3)
        ]
        locked = client.post(
            "/api/auth/local/login",
            json={"username": "owner", "password": _DESKTOP_OWNER_TOKEN},
        )
    assert statuses == [401, 401, 429]
    assert locked.status_code == 429
