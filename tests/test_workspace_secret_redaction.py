"""Workspace credentials never leave the server in an HTTP response.

Regression for a viewer reading a workspace's plaintext SMB password through
``GET /api/workspaces``: the store decrypts ``mount_options`` on read (the
mount backends need the real values), so redaction happens at the response
layer via ``Workspace.to_public_dict``. Encryption and redaction share
``crypto.is_sensitive_key``, so anything encrypted at rest is also blanked.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform import feature_flags as ff
from runtime.platform.io.lease import LeaseStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.workspace_api_router import create_workspace_api_router
from runtime.sensing.server.mount_backend import LocalMountBackend, MountBackendRegistry
from runtime.workspace import WorkspaceStore, decrypt_options, encrypt_options
from runtime.workspace import crypto as crypto_mod
from runtime.workspace.crypto import is_sensitive_key, redact_options

SMB_PASSWORD = "Sm8-pl4intext-PW"
NESTED_TOKEN = "nested-tok-7781"
API_KEY = "ak-live-5512"

OPTIONS: dict[str, Any] = {
    "username": "alice",
    "domain": "CORP",
    "password": SMB_PASSWORD,
    "auth": {"apiKey": API_KEY, "region": "eu-1"},
    "profiles": [{"name": "backup", "Session_TOKEN": NESTED_TOKEN}],
}
SECRET_PATHS = ["password", "auth.apiKey", "profiles.0.Session_TOKEN"]
SECRET_VALUES = (SMB_PASSWORD, NESTED_TOKEN, API_KEY)

# ─── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _crypto_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    pytest.importorskip("cryptography")
    from cryptography.fernet import Fernet

    def reset() -> None:
        crypto_mod._CIPHER_CACHE = None
        crypto_mod._CIPHER_KEY_CACHE = None
        crypto_mod._MACHINE_ID_CACHE = None

    reset()
    monkeypatch.setenv("ECHO_WORKSPACE_KEY", Fernet.generate_key().decode("ascii"))
    yield
    reset()


@pytest.fixture(autouse=True)
def _flag_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    original = (dict(ff._SPECS), ff._SNAPSHOT, ff._FILE_PATH)
    monkeypatch.setenv("ECHO_FF_UI_REMOTE_WORKSPACE", "1")
    ff.reload()
    yield
    ff._SPECS.clear()
    ff._SPECS.update(original[0])
    ff._SNAPSHOT, ff._FILE_PATH = original[1], original[2]


class _RecordingBackend(LocalMountBackend):
    """Accepts any mount and records the options the server handed it."""

    root: Path
    received: list[dict[str, Any]] = []

    def __init__(self, *_args: Any, **options: Any) -> None:
        super().__init__(_RecordingBackend.root)
        _RecordingBackend.received.append(options)

    async def test_connection(self) -> bool:
        return True


HEADERS = {
    actor: {"Authorization": f"Bearer sk-{actor}"} for actor in ("owner", "editor", "viewer", "ops")
}


def _client(tmp_path: Path, *, require_auth: bool = True) -> tuple[TestClient, WorkspaceStore]:
    _RecordingBackend.root = tmp_path
    _RecordingBackend.received = []
    identities = IdentityStore()
    tenant = {"tenant_id": "acme"}
    for actor in ("owner", "editor", "viewer"):
        identities.add(Identity(actor_id=actor, metadata=tenant), api_key_plaintext=f"sk-{actor}")
    identities.add(
        Identity(actor_id="ops", roles=("operator",), metadata=tenant), api_key_plaintext="sk-ops"
    )
    registry = MountBackendRegistry()
    registry.register("smb", _RecordingBackend)
    store = WorkspaceStore(db_path=tmp_path / "workspaces.db")
    app = FastAPI()
    app.include_router(
        create_workspace_api_router(
            workspace_store=store,
            lease_store=LeaseStore(db_path=tmp_path / "leases.db"),
            registry=registry,
            identity_store=identities,
            require_auth=require_auth,
            # Lets ordinary members probe the mount without a real DNS lookup.
            mount_host_allowlist=["nas.example"],
        )
    )
    return TestClient(app), store


def _smb_workspace(store: WorkspaceStore, options: dict[str, Any] | None = None) -> str:
    ws = store.create_workspace(
        name="nas",
        mount_type="smb",
        mount_target="smb://nas.example/share",
        mount_options=dict(OPTIONS if options is None else options),
        owner_id="owner",
        tenant_id="acme",
    )
    store.add_member(ws.id, "editor", role="editor")
    store.add_member(ws.id, "viewer", role="viewer")
    return ws.id


def _assert_redacted(payload: dict[str, Any], body_text: str) -> None:
    for secret in SECRET_VALUES:
        assert secret not in body_text
    opts = payload["mount_options"]
    assert opts["password"] is None
    assert opts["auth"] == {"apiKey": None, "region": "eu-1"}
    assert opts["profiles"] == [{"name": "backup", "Session_TOKEN": None}]
    # Non-secret settings stay visible.
    assert opts["username"] == "alice"
    assert opts["domain"] == "CORP"
    assert sorted(payload["secrets_set"]) == sorted(SECRET_PATHS)


# ─── HTTP responses ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("actor", ["owner", "editor", "viewer"])
def test_members_never_receive_plaintext_credentials(tmp_path: Path, actor: str) -> None:
    client, store = _client(tmp_path)
    workspace_id = _smb_workspace(store)

    detail = client.get(f"/api/workspaces/{workspace_id}", headers=HEADERS[actor])
    assert detail.status_code == 200
    _assert_redacted(detail.json()["workspace"], detail.text)

    listing = client.get("/api/workspaces", headers=HEADERS[actor])
    assert listing.status_code == 200
    [listed] = listing.json()["workspaces"]
    _assert_redacted(listed, listing.text)


def test_unauthenticated_local_mode_listing_is_redacted(tmp_path: Path) -> None:
    client, store = _client(tmp_path, require_auth=False)
    workspace_id = _smb_workspace(store)
    for url in ("/api/workspaces", "/api/workspaces?user_id=viewer"):
        response = client.get(url)
        [listed] = response.json()["workspaces"]
        _assert_redacted(listed, response.text)
    response = client.get(f"/api/workspaces/{workspace_id}")
    _assert_redacted(response.json()["workspace"], response.text)


def test_create_echo_is_redacted_but_backend_gets_real_credentials(tmp_path: Path) -> None:
    client, store = _client(tmp_path)
    response = client.post(
        "/api/workspaces",
        headers=HEADERS["ops"],
        json={
            "name": "nas",
            "mount_type": "smb",
            "mount_target": "smb://nas.example/share",
            "mount_options": OPTIONS,
            "owner_id": "ops",
        },
    )
    assert response.status_code == 200, response.text
    _assert_redacted(response.json()["workspace"], response.text)
    # The probe and the pre-warmed backend were built with the real values.
    assert _RecordingBackend.received
    assert all(opts["password"] == SMB_PASSWORD for opts in _RecordingBackend.received)
    workspace_id = response.json()["workspace"]["id"]
    assert store.get_workspace(workspace_id).mount_options == OPTIONS


def test_server_internal_reads_still_get_decrypted_credentials(tmp_path: Path) -> None:
    client, store = _client(tmp_path)
    workspace_id = _smb_workspace(store)

    with sqlite3.connect(str(store.db_path)) as conn:
        (raw,) = conn.execute(
            "SELECT mount_options_json FROM workspaces WHERE id=?", (workspace_id,)
        ).fetchone()
    for secret in SECRET_VALUES:
        assert secret not in raw  # nested + case variants are encrypted at rest
    assert store.get_workspace(workspace_id).mount_options == OPTIONS

    health = client.post(f"/api/workspaces/{workspace_id}/health", headers=HEADERS["viewer"])
    assert health.status_code == 200
    assert health.json()["ok"] is True
    for secret in SECRET_VALUES:
        assert secret not in health.text
    [built] = _RecordingBackend.received
    assert built["password"] == SMB_PASSWORD
    assert built["auth"]["apiKey"] == API_KEY


def test_legacy_plaintext_rows_stay_readable_and_are_redacted(tmp_path: Path) -> None:
    """Rows written while crypto was unavailable hold plaintext JSON."""
    client, store = _client(tmp_path)
    workspace_id = _smb_workspace(store, options={})
    with sqlite3.connect(str(store.db_path)) as conn:
        conn.execute(
            "UPDATE workspaces SET mount_options_json=? WHERE id=?",
            (json.dumps(OPTIONS), workspace_id),
        )
    assert store.get_workspace(workspace_id).mount_options == OPTIONS
    response = client.get(f"/api/workspaces/{workspace_id}", headers=HEADERS["viewer"])
    _assert_redacted(response.json()["workspace"], response.text)


def test_no_update_route_can_overwrite_stored_credentials(tmp_path: Path) -> None:
    """Workspaces are create-only, so responses that blank secrets cannot be
    echoed back to clear them. If an update route is added, it must keep the
    stored credential when the field is missing or ``None`` — revisit this
    test then rather than deleting it.
    """
    client, store = _client(tmp_path)
    workspace_id = _smb_workspace(store)
    redacted = client.get(f"/api/workspaces/{workspace_id}", headers=HEADERS["owner"]).json()
    for method in ("put", "patch"):
        response = client.request(
            method,
            f"/api/workspaces/{workspace_id}",
            headers=HEADERS["owner"],
            json=redacted["workspace"],
        )
        assert response.status_code == 405
    assert store.get_workspace(workspace_id).mount_options["password"] == SMB_PASSWORD


# ─── Shared sensitivity rule ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "key",
    [
        "password",
        "Password",
        "SMB_PASSWORD",
        "passwd",
        "ssh-passphrase",
        "secret_key",
        "clientSecret",
        "aws_secret_access_key",
        "access_key",
        "accessKeyId",
        "token",
        "session_token",
        "bearerToken",
        "credential",
        "Credentials",
        "api_key",
        "apiKey",
        "X-API-KEY",
        "private_key",
        "privateKey",
        "Authorization",
        "cookie",
        "pass",
        "PWD",
    ],
)
def test_sensitive_key_variants_are_detected(key: str) -> None:
    assert is_sensitive_key(key)


@pytest.mark.parametrize(
    "key",
    [
        "username",
        "user",
        "domain",
        "host",
        "share",
        "port",
        "root_path",
        "base_url",
        "endpoint_url",
        "bucket",
        "region",
        "filesystem_path",
        "mount_point",
        "identity_file",
        "known_hosts_file",
        "host_key_fingerprint",
        "trust_on_first_use",
        "strict_host_key_checking",
        "passthrough",
    ],
)
def test_ordinary_mount_options_are_not_sensitive(key: str) -> None:
    assert not is_sensitive_key(key)


def test_encryption_and_redaction_cover_the_same_values() -> None:
    options = {
        "Password": "pw-1",
        "nested": {"deeper": {"client-secret": "cs-2"}, "label": "keep-me"},
        "items": [{"apiKey": "ak-3"}, {"note": "keep-too"}],
        "credentials": {"user": "svc-user-4", "pin": 1234},
        "use_token": True,
        "token": "",
    }
    redacted, secrets_set = redact_options(options)
    assert secrets_set == [
        "Password",
        "nested.deeper.client-secret",
        "items.0.apiKey",
        "credentials",
    ]
    assert redacted["credentials"] is None
    assert redacted["use_token"] is True  # flags carry no secret
    assert redacted["token"] == ""
    assert redacted["nested"]["label"] == "keep-me"

    encrypted = encrypt_options(options)
    for value in ("pw-1", "cs-2", "ak-3", "svc-user-4", "1234"):
        assert value not in encrypted
    assert "keep-me" in encrypted and "keep-too" in encrypted
    # A non-string secret keeps its type through the round trip.
    assert decrypt_options(encrypted) == options


def test_legacy_per_field_ciphertext_still_decrypts() -> None:
    """Before the broader key rule, ``credentials`` lists were walked and only
    their inner ``token`` fields encrypted; such rows must keep reading."""
    cipher = crypto_mod._cipher()
    token = "ENC:" + cipher.encrypt(b"old-tok").decode("ascii")
    stored = json.dumps({"credentials": [{"token": token, "label": "first"}]})
    assert decrypt_options(stored) == {"credentials": [{"token": "old-tok", "label": "first"}]}


def test_plaintext_fallback_logs_a_warning_without_values(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(crypto_mod, "_cipher", lambda: None)
    with caplog.at_level(logging.WARNING, logger="echo.workspace.crypto"):
        stored = encrypt_options(OPTIONS)
    assert json.loads(stored) == OPTIONS
    [record] = [r for r in caplog.records if "PLAINTEXT" in r.getMessage()]
    message = record.getMessage()
    for path in SECRET_PATHS:
        assert path in message
    for secret in SECRET_VALUES:
        assert secret not in message

    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="echo.workspace.crypto"):
        encrypt_options({"username": "alice"})
    assert not [r for r in caplog.records if "PLAINTEXT" in r.getMessage()]
