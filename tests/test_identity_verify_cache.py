"""API-key verification memo: repeated tokens must not re-run PBKDF2.

Invalid bearers previously ran PBKDF2 (200k iterations) against every stored
key on every request.  Outcomes are now memoized by a keyed fingerprint of the
token; cached misses expire when the key set changes and cached hits are
re-checked against the live hash table.
"""

from __future__ import annotations

import pytest

from runtime.safety.auth import identity as identity_mod
from runtime.safety.auth.identity import DurableIdentityStore, Identity, IdentityStore


@pytest.fixture
def counted(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    calls = [0]
    real = identity_mod._verify_plaintext_against_hash

    def _spy(plaintext: str, stored: str) -> bool:
        calls[0] += 1
        return real(plaintext, stored)

    monkeypatch.setattr(identity_mod, "_verify_plaintext_against_hash", _spy)
    return calls


def _store() -> IdentityStore:
    store = IdentityStore()
    store.add(Identity(actor_id="a"), api_key_plaintext="sk-a")
    store.add(Identity(actor_id="b"), api_key_plaintext="sk-b")
    return store


def test_repeated_invalid_token_is_verified_once(counted: list[int]) -> None:
    store = _store()
    counted[0] = 0
    assert store.verify_api_key("nope") is None
    first = counted[0]
    assert first == 2  # one PBKDF2 per stored key
    for _ in range(5):
        assert store.verify_api_key("nope") is None
    assert counted[0] == first


def test_repeated_valid_token_is_verified_once(counted: list[int]) -> None:
    store = _store()
    counted[0] = 0
    assert store.verify_api_key("sk-b").actor_id == "b"
    first = counted[0]
    assert store.verify_api_key("sk-b").actor_id == "b"
    assert counted[0] == first


def test_cached_miss_invalidated_when_key_added() -> None:
    store = _store()
    assert store.verify_api_key("sk-c") is None
    store.add(Identity(actor_id="c"), api_key_plaintext="sk-c")
    assert store.verify_api_key("sk-c").actor_id == "c"


def test_cached_hit_invalidated_when_actor_removed() -> None:
    store = _store()
    assert store.verify_api_key("sk-a").actor_id == "a"
    assert store.remove("a")
    assert store.verify_api_key("sk-a") is None


def test_cached_hit_reflects_role_changes(tmp_path) -> None:
    store = DurableIdentityStore(tmp_path / "ids.json")
    store.add(Identity(actor_id="a"), api_key_plaintext="sk-a")
    assert store.verify_api_key("sk-a").roles == ()
    assert store.set_roles("a", ("admin",))
    assert store.verify_api_key("sk-a").roles == ("admin",)


def test_cache_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(identity_mod, "_VERIFY_CACHE_MAX", 3)
    store = IdentityStore()
    store.add(Identity(actor_id="legacy"), api_key_hash="sha256:" + "0" * 64)
    for i in range(10):
        store.verify_api_key(f"bad-{i}")
    assert len(store._verify_cache) == 3  # noqa: SLF001
