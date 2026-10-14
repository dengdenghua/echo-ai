import json
import sqlite3

import pytest

from runtime.workspace import crypto
from runtime.workspace.store import WorkspaceStore


def _legacy_database(tmp_path):
    path = tmp_path / "workspaces.db"
    store = WorkspaceStore(path)
    workspace = store.create_workspace(
        name="Legacy",
        mount_type="local",
        mount_target=str(tmp_path),
        owner_id="owner",
    )
    protected = json.loads(crypto.encrypt_options({"password": "protected"}))["password"]
    options = {
        "apiKey": "legacy-api-key",
        "password": protected,
        "nested": [{"client-secret": "legacy-secret"}],
        "server": "example.test",
    }
    with sqlite3.connect(path) as connection:
        connection.execute(
            "UPDATE workspaces SET mount_options_json=? WHERE id=?",
            (json.dumps(options), workspace.id),
        )
    return path, workspace.id, options


def _raw(path, identity):
    with sqlite3.connect(path) as connection:
        return connection.execute(
            "SELECT mount_options_json FROM workspaces WHERE id=?", (identity,)
        ).fetchone()[0]


def test_upgrade_encrypts_new_keys_and_preserves_existing_ciphertext(tmp_path):
    path, identity, original = _legacy_database(tmp_path)
    WorkspaceStore(path)
    encoded = _raw(path, identity)
    upgraded = json.loads(encoded)
    assert "legacy-api-key" not in encoded and "legacy-secret" not in encoded
    assert upgraded["password"] == original["password"]
    assert upgraded["server"] == "example.test"
    assert crypto.decrypt_options(encoded)["apiKey"] == "legacy-api-key"
    WorkspaceStore(path)
    assert _raw(path, identity) == encoded


def test_unavailable_crypto_does_not_rewrite_legacy_credentials(tmp_path, monkeypatch):
    path, identity, _ = _legacy_database(tmp_path)
    before = _raw(path, identity)
    monkeypatch.setattr(crypto, "_cipher", lambda: None)
    with pytest.raises(RuntimeError, match="encryption is unavailable"):
        WorkspaceStore(path)
    assert _raw(path, identity) == before
    with pytest.raises(RuntimeError, match="encryption is unavailable"):
        crypto.encrypt_options({"apiKey": "new-key"})


def test_corrupt_row_does_not_partially_upgrade_other_rows(tmp_path):
    path, identity, _ = _legacy_database(tmp_path)
    before = _raw(path, identity)
    with sqlite3.connect(path) as connection:
        connection.execute(
            "INSERT INTO workspaces SELECT 'broken', name, mount_type, mount_target, 'broken-json', owner_id, created_at, tenant_id FROM workspaces WHERE id=?",
            (identity,),
        )
    with pytest.raises(json.JSONDecodeError):
        WorkspaceStore(path)
    assert _raw(path, identity) == before
