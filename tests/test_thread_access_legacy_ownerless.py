"""Ownerless tenantless (legacy) threads are admin/operator-only when auth is enabled.

Local/OCT/social identities without tenant metadata all resolve to a
``legacy:<actor>`` tenant, so the historical "legacy tenant may manage an
ownerless legacy thread" grant made those threads manageable by every
logged-in user.  Auth-off runtimes (``allow_anonymous_ownerless``) keep it.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.threads.store import ThreadStateStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.thread_access import ThreadAccessResolver
from runtime.sensing.gateway.thread_state_router import create_thread_state_router


def _threads() -> ThreadStateStore:
    threads = ThreadStateStore()
    threads.ensure_thread("t-ownerless", metadata={"mode": "code"})
    threads.ensure_thread("t-alice", metadata={"owner_actor_id": "alice"})
    return threads


def _identities() -> IdentityStore:
    store = IdentityStore()
    store.add(Identity(actor_id="alice"))
    store.add(Identity(actor_id="mallory"))
    store.add(Identity(actor_id="root", roles=("admin",)))
    return store


def _resolver(**kwargs) -> ThreadAccessResolver:
    return ThreadAccessResolver(thread_store=_threads(), identity_store=_identities(), **kwargs)


def test_plain_legacy_user_cannot_manage_ownerless_thread() -> None:
    decision = _resolver().resolve("t-ownerless", "mallory", "legacy:mallory")
    assert decision.thread is not None
    assert not decision.can_manage
    assert not decision.can_read
    assert not decision.can_write


def test_plain_user_denied_even_when_tenant_is_derived_from_identity_store() -> None:
    decision = _resolver().resolve("t-ownerless", "mallory")
    assert not decision.can_manage and not decision.can_read


def test_admin_can_manage_ownerless_legacy_thread() -> None:
    decision = _resolver().resolve("t-ownerless", "root", "legacy:root")
    assert decision.can_manage and decision.can_read and decision.can_write


def test_caller_supplied_roles_take_precedence() -> None:
    resolver = ThreadAccessResolver(thread_store=_threads())  # no identity store
    assert not resolver.resolve("t-ownerless", "x", "legacy:x").can_manage
    assert resolver.resolve("t-ownerless", "x", "legacy:x", roles=frozenset({"admin"})).can_manage
    assert resolver.resolve("t-ownerless", "x", "legacy:x", roles={"operator"}).can_manage
    assert not resolver.resolve("t-ownerless", "x", "legacy:x", roles={"member"}).can_manage


def test_owner_keeps_access_to_own_tenantless_thread() -> None:
    resolver = _resolver()
    assert resolver.resolve("t-alice", "alice", "legacy:alice").can_manage
    assert not resolver.resolve("t-alice", "mallory", "legacy:mallory").can_read


def test_auth_off_compatibility_is_unchanged() -> None:
    resolver = _resolver(allow_anonymous_ownerless=True)
    assert resolver.resolve("t-ownerless", "mallory", "legacy:mallory").can_manage
    assert resolver.resolve("t-ownerless", None).can_manage


# --- API-level regression: the HTTP router must apply the same rule. ---------


def _api_threads() -> ThreadStateStore:
    threads = ThreadStateStore()
    threads.ensure_thread(
        "t-ownerless",
        metadata={"mode": "code"},
        values={"title": "Legacy secret", "messages": [{"type": "human", "content": "needle"}]},
    )
    threads.ensure_thread(
        "t-alice",
        metadata={"owner_actor_id": "alice"},
        values={"title": "Alice own", "messages": [{"type": "human", "content": "needle"}]},
    )
    return threads


def _api_identities() -> IdentityStore:
    store = IdentityStore()
    for actor, roles in (
        ("alice", ()),
        ("mallory", ()),
        ("root", ("admin",)),
        ("ops", ("operator",)),
    ):
        store.add(Identity(actor_id=actor, roles=roles), api_key_plaintext=f"sk-{actor}")
    return store


def _client(*, require_auth: bool) -> TestClient:
    app = FastAPI()
    app.include_router(
        create_thread_state_router(
            store=_api_threads(),
            identity_store=_api_identities() if require_auth else None,
            require_auth=require_auth,
            allow_local_workspace_access=True,
        )
    )
    return TestClient(app)


def _h(actor: str) -> dict[str, str]:
    return {"Authorization": f"Bearer sk-{actor}"}


def _searched(client: TestClient, headers: dict[str, str]) -> set[str]:
    body = client.get("/api/threads/search", params={"q": "needle"}, headers=headers).json()
    return {row["thread_id"] for row in body["threads"]}


def test_api_ordinary_legacy_identity_denied_ownerless_thread() -> None:
    client = _client(require_auth=True)
    headers = _h("mallory")
    assert client.get("/api/threads/t-ownerless", headers=headers).status_code == 404
    assert client.get("/api/threads/t-ownerless/export", headers=headers).status_code == 404
    assert "t-ownerless" not in _searched(client, headers)
    rename = client.post(
        "/api/threads/t-ownerless/title/rename", json={"title": "pwned"}, headers=headers
    )
    assert rename.status_code == 404
    assert client.get("/api/threads/t-ownerless", headers=_h("root")).json()["values"]["title"] == (
        "Legacy secret"
    )


def test_api_admin_and_operator_may_manage_ownerless_thread() -> None:
    client = _client(require_auth=True)
    for actor in ("root", "ops"):
        headers = _h(actor)
        assert client.get("/api/threads/t-ownerless", headers=headers).status_code == 200
        assert client.get("/api/threads/t-ownerless/export", headers=headers).status_code == 200
        assert "t-ownerless" in _searched(client, headers)
        rename = client.post(
            "/api/threads/t-ownerless/title/rename", json={"title": f"by {actor}"}, headers=headers
        )
        assert rename.status_code == 200


def test_api_owned_threads_unchanged() -> None:
    client = _client(require_auth=True)
    assert client.get("/api/threads/t-alice", headers=_h("alice")).status_code == 200
    assert client.get("/api/threads/t-alice/export", headers=_h("alice")).status_code == 200
    assert _searched(client, _h("alice")) == {"t-alice"}
    rename = client.post(
        "/api/threads/t-alice/title/rename", json={"title": "mine"}, headers=_h("alice")
    )
    assert rename.status_code == 200
    assert client.get("/api/threads/t-alice", headers=_h("mallory")).status_code == 404
    assert "t-alice" not in _searched(client, _h("mallory"))


def test_api_auth_disabled_keeps_ownerless_compatibility() -> None:
    client = _client(require_auth=False)
    assert client.get("/api/threads/t-ownerless").status_code == 200
    assert client.get("/api/threads/t-ownerless/export").status_code == 200
    assert "t-ownerless" in _searched(client, {})
    rename = client.post("/api/threads/t-ownerless/title/rename", json={"title": "local"})
    assert rename.status_code == 200
