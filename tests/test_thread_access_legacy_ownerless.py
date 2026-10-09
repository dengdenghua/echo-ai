"""Ownerless tenantless (legacy) threads are admin-only when auth is enabled.

Local/OCT/social identities without tenant metadata all resolve to a
``legacy:<actor>`` tenant, so the historical "legacy tenant may manage an
ownerless legacy thread" grant made those threads manageable by every
logged-in user.  Auth-off runtimes (``allow_anonymous_ownerless``) keep it.
"""

from __future__ import annotations

from runtime.memory.threads.store import ThreadStateStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.thread_access import ThreadAccessResolver


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
    assert not resolver.resolve("t-ownerless", "x", "legacy:x", roles={"operator"}).can_manage


def test_owner_keeps_access_to_own_tenantless_thread() -> None:
    resolver = _resolver()
    assert resolver.resolve("t-alice", "alice", "legacy:alice").can_manage
    assert not resolver.resolve("t-alice", "mallory", "legacy:mallory").can_read


def test_auth_off_compatibility_is_unchanged() -> None:
    resolver = _resolver(allow_anonymous_ownerless=True)
    assert resolver.resolve("t-ownerless", "mallory", "legacy:mallory").can_manage
    assert resolver.resolve("t-ownerless", None).can_manage
