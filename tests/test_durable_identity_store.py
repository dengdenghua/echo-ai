"""DurableIdentityStore: authenticated actors must survive restarts.

An in-memory store made every backend restart invalidate every outstanding
JWT (verify_jwt requires the subject to be registered), which left open
clients stuck in an endless realtime reconnect loop. These tests pin the
disk-mirror contract: mutations persist, reload restores, corruption and
duplicate rows never take startup down.
"""

from __future__ import annotations

import json
from pathlib import Path

from runtime.safety.auth.identity import DurableIdentityStore, Identity


def test_roundtrip_preserves_roles_metadata_and_api_keys(tmp_path: Path) -> None:
    path = tmp_path / "identities.json"
    store = DurableIdentityStore(path)
    store.add(
        Identity("local:admin", ("user", "local", "admin"), {"provider": "local"}),
        api_key_plaintext="sk-live-123",
    )
    assert path.exists()

    reloaded = DurableIdentityStore(path)
    identity = reloaded.get("local:admin")
    assert identity is not None
    assert identity.roles == ("user", "local", "admin")
    assert identity.metadata["provider"] == "local"
    assert reloaded.verify_api_key("sk-live-123") is not None
    # The plaintext key must never be written to disk.
    assert "sk-live-123" not in path.read_text(encoding="utf-8")


def test_set_roles_and_remove_are_persisted(tmp_path: Path) -> None:
    path = tmp_path / "identities.json"
    store = DurableIdentityStore(path)
    store.add(Identity("local:a", ("user",)))
    store.add(Identity("local:b", ("user",)))

    assert store.set_roles("local:a", ("admin", "operator")) is True
    assert store.remove("local:b") is True

    reloaded = DurableIdentityStore(path)
    assert reloaded.get("local:a").roles == ("admin", "operator")  # type: ignore[union-attr]
    assert reloaded.get("local:b") is None


def test_corrupt_file_starts_empty_instead_of_crashing(tmp_path: Path) -> None:
    path = tmp_path / "identities.json"
    path.write_text("{not json", encoding="utf-8")
    store = DurableIdentityStore(path)
    assert len(store) == 0
    # And the store keeps working — the next mutation rewrites the file.
    store.add(Identity("local:x", ("user",)))
    assert DurableIdentityStore(path).get("local:x") is not None


def test_duplicate_rows_are_skipped_not_fatal(tmp_path: Path) -> None:
    path = tmp_path / "identities.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "identities": [
                    {"actor_id": "local:a", "roles": ["user"]},
                    {"actor_id": "local:a", "roles": ["admin"]},
                    {"actor_id": "", "roles": []},
                    {"roles": ["user"]},
                ],
            }
        ),
        encoding="utf-8",
    )
    store = DurableIdentityStore(path)
    assert len(store) == 1
    assert store.get("local:a") is not None


def test_missing_file_behaves_like_empty_store(tmp_path: Path) -> None:
    store = DurableIdentityStore(tmp_path / "does-not-exist.json")
    assert len(store) == 0
    store.add(Identity("local:late", ("user",)))
    assert (tmp_path / "does-not-exist.json").exists()


def test_corrupt_file_is_kept_aside_not_overwritten(tmp_path: Path) -> None:
    path = tmp_path / "identities.json"
    path.write_text("{not json", encoding="utf-8")

    store = DurableIdentityStore(path)
    store.add(Identity("local:x", ("user",)))

    kept = list(tmp_path.glob("identities.json.corrupt-*"))
    assert len(kept) == 1 and kept[0].read_text(encoding="utf-8") == "{not json"


def test_corrupt_file_falls_back_to_the_last_good_copy(tmp_path: Path) -> None:
    path = tmp_path / "identities.json"
    store = DurableIdentityStore(path)
    store.add(Identity("local:a", ("user",)), api_key_plaintext="sk-a")
    store.add(Identity("local:b", ("admin",)))  # rotates the 1-identity file to .bak
    path.write_text('{"identities": "truncated', encoding="utf-8")

    restored = DurableIdentityStore(path)

    assert restored.get("local:a") is not None
    assert restored.verify_api_key("sk-a") is not None


def test_unreadable_file_is_never_overwritten(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "identities.json"
    DurableIdentityStore(path).add(Identity("local:keep", ("admin",)))
    before = path.read_bytes()
    real_read_text = Path.read_text

    def locked(self: Path, *args, **kwargs):
        if self == path:
            raise PermissionError("locked by another process")
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", locked)
    store = DurableIdentityStore(path)
    store.add(Identity("local:new", ("user",)))

    assert store.get("local:new") is not None  # still works in memory
    assert path.read_bytes() == before
