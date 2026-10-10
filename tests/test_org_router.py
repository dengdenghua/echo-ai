"""Tests for ``runtime.sensing.gateway.org_router``.

Covers the 阶段一 org API surface:
  1. 创建组织 + owner 自动成为成员
  2. 创建/查询部门、频道
  3. 组织管理员可加成员/建频道,非管理员 403
  4. 频道 ACL:非成员访问频道 403、成员可访问
  5. ``GET /api/orgs/mine``、``GET /api/channels/mine`` 过滤
  6. 删组织/删频道级联
  7. 匿名(无身份)写操作 → 403
  8. 共享模式(require_auth=True)授权:跨组织删部门、非成员读 404、admin 夺权、
     最后一个 owner、移出组织后频道访问失效

Uses a tmp-path SQLite DB + an ``IdentityStore`` (API-key bearer) for isolation.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.org_router import create_org_router
from runtime.workspace import OrgStore


def _identity_store() -> IdentityStore:
    store = IdentityStore()
    store.add(Identity(actor_id="alice"), api_key_plaintext="key-alice")
    store.add(Identity(actor_id="bob"), api_key_plaintext="key-bob")
    store.add(Identity(actor_id="carol"), api_key_plaintext="key-carol")
    store.add(Identity(actor_id="ops", roles=("operator",)), api_key_plaintext="key-ops")
    return store


def _client(
    tmp_path: Path,
    *,
    identity_store: IdentityStore | None = None,
    require_auth: bool = False,
) -> TestClient:
    store = OrgStore(db_path=tmp_path / "org.db")
    app = FastAPI()
    app.include_router(
        create_org_router(
            org_store=store,
            identity_store=identity_store,
            require_auth=require_auth,
        )
    )
    return TestClient(app)


def _shared_client(tmp_path: Path) -> TestClient:
    return _client(tmp_path, identity_store=_identity_store(), require_auth=True)


def _auth(name: str) -> dict[str, str]:
    return {"Authorization": f"Bearer key-{name}"}


def _create_org(client: TestClient, *, name: str = "Acme", owner: str = "alice") -> dict:
    r = client.post(
        "/api/orgs",
        json={"name": name, "owner_id": owner},
        headers=_auth(owner),
    )
    assert r.status_code == 200, r.text
    return r.json()


# ─── 1. 创建组织 + owner 自动成为成员 ───────────────────────────────────────


def test_create_org_and_owner_auto_member(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    org = _create_org(client)

    assert org["name"] == "Acme"
    assert org["owner_id"] == "alice"
    assert org["id"]

    members = client.get(f"/api/orgs/{org['id']}/members", headers=_auth("alice")).json()["members"]
    assert len(members) == 1
    assert members[0]["member_id"] == "alice"
    assert members[0]["role"] == "owner"


def test_create_org_rejects_missing_name(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    r = client.post("/api/orgs", json={"name": "", "owner_id": "alice"}, headers=_auth("alice"))
    assert r.status_code == 400


# ─── 2. 创建/查询部门、频道 ─────────────────────────────────────────────────


def test_create_and_query_department_and_channel(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    org = _create_org(client)

    dept = client.post(
        f"/api/orgs/{org['id']}/departments",
        json={"name": "Eng"},
        headers=_auth("alice"),
    ).json()
    assert dept["name"] == "Eng"
    assert dept["org_id"] == org["id"]

    ch = client.post(
        f"/api/orgs/{org['id']}/channels",
        json={"name": "general", "department_id": dept["id"]},
        headers=_auth("alice"),
    ).json()
    assert ch["name"] == "general"
    assert ch["department_id"] == dept["id"]

    depts = client.get(f"/api/orgs/{org['id']}/departments", headers=_auth("alice")).json()
    assert depts["count"] == 1
    assert depts["departments"][0]["id"] == dept["id"]

    channels = client.get(f"/api/orgs/{org['id']}/channels", headers=_auth("alice")).json()
    assert channels["count"] == 1
    assert channels["channels"][0]["id"] == ch["id"]

    assert client.get(f"/api/orgs/{org['id']}").json()["id"] == org["id"]


# ─── 3. 组织管理员可加成员/建频道,非管理员 403 ──────────────────────────────


def test_org_admin_can_add_member_and_build_channel(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    org = _create_org(client)

    # alice (owner) adds bob as a member.
    r = client.post(
        f"/api/orgs/{org['id']}/members",
        json={"member_id": "bob", "kind": "human", "role": "member"},
        headers=_auth("alice"),
    )
    assert r.status_code == 200
    assert r.json()["member_id"] == "bob"

    # bob (member, not admin) is forbidden from adding a member.
    r2 = client.post(
        f"/api/orgs/{org['id']}/members",
        json={"member_id": "carol", "role": "member"},
        headers=_auth("bob"),
    )
    assert r2.status_code == 403

    # bob (member, not admin) is forbidden from creating a channel.
    r3 = client.post(
        f"/api/orgs/{org['id']}/channels",
        json={"name": "x"},
        headers=_auth("bob"),
    )
    assert r3.status_code == 403

    # bob cannot delete the org or create a department.
    assert client.delete(f"/api/orgs/{org['id']}", headers=_auth("bob")).status_code == 403
    assert (
        client.post(
            f"/api/orgs/{org['id']}/departments",
            json={"name": "X"},
            headers=_auth("bob"),
        ).status_code
        == 403
    )


# ─── 4. 频道 ACL:非成员访问频道 403、成员可访问 ─────────────────────────────


def test_channel_acl_non_member_forbidden_member_allowed(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    org = _create_org(client)
    client.post(
        f"/api/orgs/{org['id']}/members",
        json={"member_id": "bob", "role": "member"},
        headers=_auth("alice"),
    )
    ch = client.post(
        f"/api/orgs/{org['id']}/channels",
        json={"name": "private"},
        headers=_auth("alice"),
    ).json()

    # bob is not in the channel ACL → cannot read it.
    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("bob")).status_code == 403
    # bob cannot list the channel's members either.
    assert client.get(f"/api/channels/{ch['id']}/members", headers=_auth("bob")).status_code == 403

    # alice (channel owner) can read it.
    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("alice")).status_code == 200

    # alice grants bob channel membership.
    r = client.post(
        f"/api/channels/{ch['id']}/members",
        json={"member_id": "bob", "role": "member"},
        headers=_auth("alice"),
    )
    assert r.status_code == 200
    assert r.json()["member_id"] == "bob"

    # bob can now read the channel.
    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("bob")).status_code == 200


def test_channel_acl_member_cannot_manage_acl(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    org = _create_org(client)
    client.post(
        f"/api/orgs/{org['id']}/members",
        json={"member_id": "bob", "role": "member"},
        headers=_auth("alice"),
    )
    ch = client.post(
        f"/api/orgs/{org['id']}/channels",
        json={"name": "private"},
        headers=_auth("alice"),
    ).json()
    client.post(
        f"/api/channels/{ch['id']}/members",
        json={"member_id": "bob", "role": "member"},
        headers=_auth("alice"),
    )

    # bob is a channel member but not admin → cannot add another member.
    r = client.post(
        f"/api/channels/{ch['id']}/members",
        json={"member_id": "carol", "role": "member"},
        headers=_auth("bob"),
    )
    assert r.status_code == 403
    # bob cannot delete the channel.
    assert client.delete(f"/api/channels/{ch['id']}", headers=_auth("bob")).status_code == 403


# ─── 5. /mine 过滤 ─────────────────────────────────────────────────────────


def test_orgs_mine_and_channels_mine_filter(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    org = _create_org(client)
    client.post(
        f"/api/orgs/{org['id']}/members",
        json={"member_id": "bob", "role": "member"},
        headers=_auth("alice"),
    )
    ch = client.post(
        f"/api/orgs/{org['id']}/channels",
        json={"name": "general"},
        headers=_auth("alice"),
    ).json()

    # alice's orgs include Acme.
    mine_alice = client.get("/api/orgs/mine", headers=_auth("alice")).json()
    assert {o["id"] for o in mine_alice["organizations"]} == {org["id"]}

    # bob is a member → also sees Acme.
    mine_bob = client.get("/api/orgs/mine", headers=_auth("bob")).json()
    assert {o["id"] for o in mine_bob["organizations"]} == {org["id"]}

    # alice (channel owner) sees the channel.
    ch_alice = client.get("/api/channels/mine", headers=_auth("alice")).json()
    assert {c["id"] for c in ch_alice["channels"]} == {ch["id"]}

    # bob is not in the channel ACL → sees no channels.
    ch_bob = client.get("/api/channels/mine", headers=_auth("bob")).json()
    assert ch_bob["count"] == 0


# ─── 6. 删组织/删频道级联 ──────────────────────────────────────────────────


def test_delete_channel_cascades_acl(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    org = _create_org(client)
    ch = client.post(
        f"/api/orgs/{org['id']}/channels",
        json={"name": "general"},
        headers=_auth("alice"),
    ).json()

    r = client.delete(f"/api/channels/{ch['id']}", headers=_auth("alice"))
    assert r.status_code == 200
    assert r.json()["deleted"] == ch["id"]
    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("alice")).status_code == 404


def test_delete_org_cascades_departments_and_channels(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    org = _create_org(client)
    dept = client.post(
        f"/api/orgs/{org['id']}/departments",
        json={"name": "Eng"},
        headers=_auth("alice"),
    ).json()
    ch = client.post(
        f"/api/orgs/{org['id']}/channels",
        json={"name": "general", "department_id": dept["id"]},
        headers=_auth("alice"),
    ).json()

    r = client.delete(f"/api/orgs/{org['id']}", headers=_auth("alice"))
    assert r.status_code == 200
    assert r.json()["deleted"] == org["id"]

    assert client.get(f"/api/orgs/{org['id']}").status_code == 404
    assert client.get(f"/api/orgs/{org['id']}/departments").status_code == 404
    assert client.get(f"/api/orgs/{org['id']}/channels").status_code == 404
    # The channel is gone too.
    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("alice")).status_code == 404
    # orgs/mine no longer lists it for alice.
    mine = client.get("/api/orgs/mine", headers=_auth("alice")).json()
    assert mine["count"] == 0


# ─── 7. 匿名(无身份)写操作 → 403 ───────────────────────────────────────────


def test_anonymous_write_forbidden(tmp_path: Path) -> None:
    # No identity_store → actor resolves to None.
    client = _client(tmp_path)
    org = client.post("/api/orgs", json={"name": "Acme", "owner_id": "alice"}).json()

    assert (
        client.post(
            f"/api/orgs/{org['id']}/members",
            json={"member_id": "bob", "role": "member"},
        ).status_code
        == 403
    )
    assert client.post(f"/api/orgs/{org['id']}/channels", json={"name": "x"}).status_code == 403
    assert client.delete(f"/api/orgs/{org['id']}").status_code == 403


def test_org_not_found_404(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    assert client.get("/api/orgs/ghost").status_code == 404
    assert client.delete("/api/orgs/ghost", headers=_auth("alice")).status_code == 404


# ─── 8. 共享模式(require_auth=True)授权 ─────────────────────────────────────


def _add_member(client: TestClient, org_id: str, member: str, role: str, *, by: str) -> int:
    return client.post(
        f"/api/orgs/{org_id}/members",
        json={"member_id": member, "kind": "human", "role": role},
        headers=_auth(by),
    ).status_code


def test_shared_mode_cross_org_department_delete_rejected(tmp_path: Path) -> None:
    client = _shared_client(tmp_path)
    victim = _create_org(client, name="Victim", owner="alice")
    dept = client.post(
        f"/api/orgs/{victim['id']}/departments",
        json={"name": "Eng"},
        headers=_auth("alice"),
    ).json()
    ch = client.post(
        f"/api/orgs/{victim['id']}/channels",
        json={"name": "dev", "department_id": dept["id"]},
        headers=_auth("alice"),
    ).json()

    # bob owns his own org and aims the victim department id at it.
    attacker = _create_org(client, name="Evil", owner="bob")
    r = client.delete(f"/api/orgs/{attacker['id']}/departments/{dept['id']}", headers=_auth("bob"))
    assert r.status_code == 404
    # Going through the victim org directly is a non-member → 404 as well.
    r2 = client.delete(f"/api/orgs/{victim['id']}/departments/{dept['id']}", headers=_auth("bob"))
    assert r2.status_code == 404

    # Department, its channel and ACL survive.
    depts = client.get(f"/api/orgs/{victim['id']}/departments", headers=_auth("alice")).json()
    assert [d["id"] for d in depts["departments"]] == [dept["id"]]
    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("alice")).status_code == 200

    # The legitimate owner can still delete it.
    ok = client.delete(f"/api/orgs/{victim['id']}/departments/{dept['id']}", headers=_auth("alice"))
    assert ok.status_code == 200


def test_shared_mode_non_member_reads_404(tmp_path: Path) -> None:
    client = _shared_client(tmp_path)
    org = _create_org(client, name="Acme", owner="alice")
    own = _create_org(client, name="Bobco", owner="bob")
    oid = org["id"]

    for path in (
        f"/api/orgs/{oid}",
        f"/api/orgs/{oid}/members",
        f"/api/orgs/{oid}/departments",
        f"/api/orgs/{oid}/channels",
    ):
        assert client.get(path, headers=_auth("bob")).status_code == 404, path
        assert client.get(path, headers=_auth("alice")).status_code == 200, path
        # Unauthenticated callers never reach the membership check.
        assert client.get(path).status_code == 401, path

    # Non-member writes also look like a missing org.
    assert _add_member(client, oid, "bob", "member", by="bob") == 404
    assert client.delete(f"/api/orgs/{oid}", headers=_auth("bob")).status_code == 404

    # The org listing only contains the caller's own orgs.
    listed = client.get("/api/orgs", headers=_auth("bob")).json()
    assert {o["id"] for o in listed["organizations"]} == {own["id"]}
    # carol belongs to nothing.
    assert client.get("/api/orgs", headers=_auth("carol")).json()["count"] == 0

    # Once bob joins, the reads open up.
    assert _add_member(client, oid, "bob", "viewer", by="alice") == 200
    assert client.get(f"/api/orgs/{oid}/members", headers=_auth("bob")).status_code == 200


def test_shared_mode_operator_reads_all_but_cannot_write(tmp_path: Path) -> None:
    client = _shared_client(tmp_path)
    a = _create_org(client, name="A", owner="alice")
    b = _create_org(client, name="B", owner="bob")

    listed = client.get("/api/orgs", headers=_auth("ops")).json()
    assert {o["id"] for o in listed["organizations"]} == {a["id"], b["id"]}
    assert client.get(f"/api/orgs/{a['id']}/members", headers=_auth("ops")).status_code == 200
    # A global read role is not org membership.
    assert client.delete(f"/api/orgs/{a['id']}", headers=_auth("ops")).status_code == 404


def test_shared_mode_admin_cannot_seize_ownership(tmp_path: Path) -> None:
    client = _shared_client(tmp_path)
    org = _create_org(client, name="Acme", owner="alice")
    oid = org["id"]
    assert _add_member(client, oid, "bob", "admin", by="alice") == 200

    # Self-promotion, granting owner to others, and touching the owner → 403.
    assert _add_member(client, oid, "bob", "owner", by="bob") == 403
    assert _add_member(client, oid, "carol", "owner", by="bob") == 403
    assert _add_member(client, oid, "alice", "member", by="bob") == 403
    assert client.delete(f"/api/orgs/{oid}/members/alice", headers=_auth("bob")).status_code == 403
    # Deleting the whole org is owner-only.
    assert client.delete(f"/api/orgs/{oid}", headers=_auth("bob")).status_code == 403

    # Ordinary admin work still succeeds.
    assert _add_member(client, oid, "carol", "member", by="bob") == 200
    assert client.delete(f"/api/orgs/{oid}/members/carol", headers=_auth("bob")).status_code == 200

    roles = {
        m["member_id"]: m["role"]
        for m in client.get(f"/api/orgs/{oid}/members", headers=_auth("alice")).json()["members"]
    }
    assert roles == {"alice": "owner", "bob": "admin"}
    assert client.get(f"/api/orgs/{oid}", headers=_auth("alice")).status_code == 200


def test_shared_mode_last_owner_cannot_be_removed_or_demoted(tmp_path: Path) -> None:
    client = _shared_client(tmp_path)
    org = _create_org(client, name="Acme", owner="alice")
    oid = org["id"]

    assert (
        client.delete(f"/api/orgs/{oid}/members/alice", headers=_auth("alice")).status_code == 409
    )
    assert _add_member(client, oid, "alice", "admin", by="alice") == 409

    # Ownership can be handed over: add a second owner, then step down.
    assert _add_member(client, oid, "bob", "owner", by="alice") == 200
    assert _add_member(client, oid, "alice", "member", by="alice") == 200
    assert client.delete(f"/api/orgs/{oid}/members/bob", headers=_auth("bob")).status_code == 409
    # Unknown members are reported as such, not silently "deleted".
    assert client.delete(f"/api/orgs/{oid}/members/ghost", headers=_auth("bob")).status_code == 404
    # The new owner holds owner-level powers.
    assert client.delete(f"/api/orgs/{oid}", headers=_auth("bob")).status_code == 200


def test_shared_mode_removed_member_loses_channel_access(tmp_path: Path) -> None:
    client = _shared_client(tmp_path)
    org = _create_org(client, name="Acme", owner="alice")
    oid = org["id"]
    assert _add_member(client, oid, "bob", "member", by="alice") == 200
    ch = client.post(
        f"/api/orgs/{oid}/channels", json={"name": "private"}, headers=_auth("alice")
    ).json()
    r = client.post(
        f"/api/channels/{ch['id']}/members",
        json={"member_id": "bob", "role": "member"},
        headers=_auth("alice"),
    )
    assert r.status_code == 200
    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("bob")).status_code == 200

    assert client.delete(f"/api/orgs/{oid}/members/bob", headers=_auth("alice")).status_code == 200

    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("bob")).status_code == 403
    assert client.get(f"/api/channels/{ch['id']}/members", headers=_auth("bob")).status_code == 403
    assert client.get("/api/channels/mine", headers=_auth("bob")).json()["count"] == 0
    members = client.get(f"/api/channels/{ch['id']}/members", headers=_auth("alice")).json()
    assert {m["member_id"] for m in members["members"]} == {"alice"}

    # Rejoining the org does not resurrect the old channel grant.
    assert _add_member(client, oid, "bob", "member", by="alice") == 200
    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("bob")).status_code == 403


def test_shared_mode_channel_admin_cannot_seize_channel_ownership(tmp_path: Path) -> None:
    client = _shared_client(tmp_path)
    org = _create_org(client, name="Acme", owner="alice")
    oid = org["id"]
    assert _add_member(client, oid, "bob", "member", by="alice") == 200
    assert _add_member(client, oid, "carol", "member", by="alice") == 200
    ch = client.post(
        f"/api/orgs/{oid}/channels", json={"name": "private"}, headers=_auth("alice")
    ).json()
    cid = ch["id"]

    def grant(member: str, role: str, *, by: str) -> int:
        return client.post(
            f"/api/channels/{cid}/members",
            json={"member_id": member, "role": role},
            headers=_auth(by),
        ).status_code

    def revoke(member: str, *, by: str) -> int:
        return client.delete(f"/api/channels/{cid}/members/{member}", headers=_auth(by)).status_code

    assert grant("bob", "admin", by="alice") == 200

    assert grant("bob", "owner", by="bob") == 403
    assert grant("carol", "owner", by="bob") == 403
    assert grant("alice", "member", by="bob") == 403
    assert revoke("alice", by="bob") == 403
    # Regular ACL management by the channel admin keeps working.
    assert grant("carol", "member", by="bob") == 200
    assert revoke("carol", by="bob") == 200
    assert revoke("carol", by="bob") == 404

    # The channel's only owner can neither leave nor demote themselves.
    assert revoke("alice", by="alice") == 409
    assert grant("alice", "member", by="alice") == 409

    # A channel admin who left the org loses ACL management immediately.
    assert client.delete(f"/api/orgs/{oid}/members/bob", headers=_auth("alice")).status_code == 200
    assert grant("carol", "member", by="bob") == 403


# ─── 9. 本地免认证模式(require_auth=False)仍可用 ───────────────────────────


def test_local_mode_anonymous_reads_stay_open(tmp_path: Path) -> None:
    # Loopback single-user mode: no identity store, every request anonymous.
    client = _client(tmp_path)
    org = client.post("/api/orgs", json={"name": "Acme", "owner_id": "local-user"}).json()

    assert client.get("/api/orgs").json()["count"] == 1
    assert client.get(f"/api/orgs/{org['id']}").status_code == 200
    members = client.get(f"/api/orgs/{org['id']}/members").json()["members"]
    assert [(m["member_id"], m["role"]) for m in members] == [("local-user", "owner")]
    assert client.get(f"/api/orgs/{org['id']}/departments").status_code == 200
    assert client.get(f"/api/orgs/{org['id']}/channels").status_code == 200


def test_local_mode_owner_keeps_full_management(tmp_path: Path) -> None:
    client = _client(tmp_path, identity_store=_identity_store())
    org = _create_org(client, name="Acme", owner="alice")
    oid = org["id"]

    assert _add_member(client, oid, "bob", "owner", by="alice") == 200
    assert _add_member(client, oid, "bob", "admin", by="alice") == 200
    dept = client.post(
        f"/api/orgs/{oid}/departments", json={"name": "Eng"}, headers=_auth("alice")
    ).json()
    ch = client.post(
        f"/api/orgs/{oid}/channels",
        json={"name": "dev", "department_id": dept["id"]},
        headers=_auth("alice"),
    ).json()
    assert client.get(f"/api/channels/{ch['id']}", headers=_auth("alice")).status_code == 200
    r = client.delete(f"/api/orgs/{oid}/departments/{dept['id']}", headers=_auth("alice"))
    assert r.status_code == 200
    assert client.delete(f"/api/orgs/{oid}/members/bob", headers=_auth("alice")).status_code == 200
    assert client.delete(f"/api/orgs/{oid}", headers=_auth("alice")).status_code == 200
