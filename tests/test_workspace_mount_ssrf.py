"""SSRF guard for remote workspace mounts (webdav / sftp / smb / s3).

Ordinary authenticated users must not make the runtime probe or connect to
loopback, link-local (cloud metadata), private, unspecified or multicast
addresses. Admins/operators keep full access; an allowlist can open specific
internal hosts. DNS is faked so no test touches the network.
"""

from __future__ import annotations

import ipaddress
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform import feature_flags as ff
from runtime.platform.io.lease import LeaseStore
from runtime.safety.auth import Identity, IdentityStore, url_guard
from runtime.sensing.gateway import workspace_api_router as router_module
from runtime.sensing.gateway.workspace_api_router import create_workspace_api_router
from runtime.sensing.server.mount_backend import LocalMountBackend, MountBackendRegistry
from runtime.workspace import WorkspaceStore

USER = {"Authorization": "Bearer sk-bob"}
ADMIN = {"Authorization": "Bearer sk-ops"}

_DNS: dict[str, list[str]] = {
    "public.example": ["93.184.216.34"],
    "mixed.example": ["93.184.216.34", "10.1.2.3"],
    "meta.example": ["169.254.169.254"],
    "nas.corp.example": ["192.168.1.20"],
}


@pytest.fixture(autouse=True)
def _flag_and_dns(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    original = (dict(ff._SPECS), ff._SNAPSHOT, ff._FILE_PATH)
    monkeypatch.setenv("ECHO_FF_UI_REMOTE_WORKSPACE", "1")
    monkeypatch.delenv(router_module.MOUNT_HOST_ALLOWLIST_ENV, raising=False)
    ff.reload()
    monkeypatch.setattr(
        url_guard,
        "_resolve_all",
        lambda host: [ipaddress.ip_address(a) for a in _DNS.get(host.lower(), [])],
    )
    yield
    ff._SPECS.clear()
    ff._SPECS.update(original[0])
    ff._SNAPSHOT, ff._FILE_PATH = original[1], original[2]


class _Probes:
    root: Path
    calls: list[str] = []


class _ProbeBackend(LocalMountBackend):
    def __init__(self, *_args: Any, **_options: Any) -> None:
        super().__init__(_Probes.root)

    async def test_connection(self) -> bool:
        _Probes.calls.append("probe")
        return True


def _client(tmp_path: Path, **router_kwargs: Any) -> tuple[TestClient, WorkspaceStore]:
    _Probes.root = tmp_path
    _Probes.calls = []
    identities = IdentityStore()
    identities.add(Identity(actor_id="bob"), api_key_plaintext="sk-bob")
    identities.add(Identity(actor_id="ops", roles=("admin",)), api_key_plaintext="sk-ops")
    registry = MountBackendRegistry()
    for mount_type in ("webdav", "sftp", "smb", "s3"):
        registry.register(mount_type, _ProbeBackend)
    store = WorkspaceStore(db_path=tmp_path / "workspaces.db")
    app = FastAPI()
    app.include_router(
        create_workspace_api_router(
            workspace_store=store,
            lease_store=LeaseStore(db_path=tmp_path / "leases.db"),
            registry=registry,
            identity_store=identities,
            require_auth=True,
            **router_kwargs,
        )
    )
    return TestClient(app), store


def _create(
    client: TestClient,
    headers: dict[str, str],
    mount_type: str,
    target: str,
    options: dict[str, Any] | None = None,
):
    owner = "ops" if headers is ADMIN else "bob"
    return client.post(
        "/api/workspaces",
        headers=headers,
        json={
            "name": "remote",
            "mount_type": mount_type,
            "mount_target": target,
            "mount_options": options or {},
            "owner_id": owner,
        },
    )


_BLOCKED = [
    ("webdav", "https://127.0.0.1/dav", None),
    ("webdav", "http://169.254.169.254/latest/meta-data", None),
    ("webdav", "https://meta.example/dav", None),
    ("webdav", "https://mixed.example/dav", None),  # one internal record is enough
    ("webdav", "https://unresolvable.example/dav", None),
    ("webdav", "https://public.example/dav", {"base_url": "http://10.0.0.8/dav"}),
    ("sftp", "sftp://192.168.0.10/data", None),
    ("sftp", "sftp://public.example/data", {"host": "localhost"}),
    ("smb", "smb://[::1]/share", None),
    ("smb", "smb://[fd00::1]/share", None),
    ("smb", "smb://0.0.0.0/share", None),
    ("smb", "smb://224.0.0.1/share", None),
    ("s3", "s3://bucket/prefix", {"endpoint_url": "http://172.16.0.9:9000"}),
    ("s3", "http://[fe80::1]:9000/bucket", None),
]


@pytest.mark.parametrize(("mount_type", "target", "options"), _BLOCKED)
def test_ordinary_user_cannot_mount_internal_hosts(
    tmp_path: Path, mount_type: str, target: str, options: dict[str, Any] | None
) -> None:
    client, store = _client(tmp_path)
    response = _create(client, USER, mount_type, target, options)
    assert response.status_code == 403, response.text
    detail = response.json()["detail"]
    assert detail["error"] == "mount_host_blocked"
    assert detail["reason"] and "admin" in detail["hint"]
    # Rejected before any probe or persistence.
    assert _Probes.calls == []
    assert store.list_workspaces() == []


def test_ordinary_user_can_mount_public_hosts(tmp_path: Path) -> None:
    client, _ = _client(tmp_path)
    assert _create(client, USER, "webdav", "https://public.example/dav").status_code == 200
    # An AWS ``s3://bucket`` target names a bucket, not a host.
    assert _create(client, USER, "s3", "s3://my-bucket/prefix").status_code == 200
    assert _Probes.calls == ["probe", "probe"]


def test_admin_keeps_full_access(tmp_path: Path) -> None:
    client, _ = _client(tmp_path)
    for mount_type, target, options in _BLOCKED[:3]:
        assert _create(client, ADMIN, mount_type, target, options).status_code == 200


def test_allowlist_opens_specific_internal_hosts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = _client(tmp_path, mount_host_allowlist=["nas.corp.example", "10.0.0.0/8"])
    assert _create(client, USER, "smb", "smb://nas.corp.example/share").status_code == 200
    assert _create(client, USER, "sftp", "sftp://10.2.3.4/data").status_code == 200
    assert _create(client, USER, "sftp", "sftp://192.168.0.10/data").status_code == 403

    monkeypatch.setenv(router_module.MOUNT_HOST_ALLOWLIST_ENV, " 192.168.0.10 , other ")
    env_client, _ = _client(tmp_path / "env")
    assert _create(env_client, USER, "sftp", "sftp://192.168.0.10/data").status_code == 200


def test_health_revalidates_against_dns_rebinding(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = _client(tmp_path)
    created = _create(client, USER, "webdav", "https://public.example/dav")
    assert created.status_code == 200
    workspace_id = created.json()["workspace"]["id"]
    probes_after_create = list(_Probes.calls)

    monkeypatch.setitem(_DNS, "public.example", ["169.254.169.254"])
    rebound = client.post(f"/api/workspaces/{workspace_id}/health", headers=USER)
    assert rebound.status_code == 403
    assert rebound.json()["detail"]["error"] == "mount_host_blocked"
    assert _Probes.calls == probes_after_create


def test_ordinary_user_cannot_relax_ssh_host_key_checking(tmp_path: Path) -> None:
    client, _ = _client(tmp_path)
    for options in ({"trust_on_first_use": True}, {"strict_host_key_checking": False}):
        response = _create(client, USER, "sftp", "sftp://public.example/data", options)
        assert response.status_code == 403, options
    # Pinning a fingerprint only tightens verification and stays allowed.
    pinned = _create(
        client, USER, "sftp", "sftp://public.example/data", {"host_key_fingerprint": "SHA256:x"}
    )
    assert pinned.status_code == 200
    assert (
        _create(
            client, ADMIN, "sftp", "sftp://public.example/d", {"trust_on_first_use": True}
        ).status_code
        == 200
    )
