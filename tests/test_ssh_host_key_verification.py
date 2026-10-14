"""SSH host-key verification for the Paramiko SSH and SFTP adapters.

Uses a fake ``paramiko`` module (no network, no real crypto): the fake client
invokes the installed missing-host-key policy exactly where Paramiko would,
before authentication.
"""

from __future__ import annotations

import base64
import hashlib
import sys
import types
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from runtime.sensing.server import _ssh_host_keys
from runtime.sensing.server._mount_backend_sftp import SftpMountBackend
from runtime.sensing.server._ssh_host_keys import (
    configure_host_key_verification,
    host_key_fingerprint,
    normalize_fingerprint,
)
from runtime.sensing.server.ssh import SshBackend


class FakeKey:
    def __init__(self, blob: bytes = b"server-key-1", name: str = "ssh-ed25519") -> None:
        self._blob = blob
        self._name = name

    def get_name(self) -> str:
        return self._name

    def get_base64(self) -> str:
        return base64.b64encode(self._blob).decode("ascii")

    def asbytes(self) -> bytes:
        return self._blob


class FakeHostKeys:
    def __init__(self) -> None:
        self.added: list[tuple[str, str, Any]] = []

    def add(self, hostname: str, keytype: str, key: Any) -> None:
        self.added.append((hostname, keytype, key))


def _fake_paramiko(server_key: FakeKey, *, known_files: set[str] | None = None):
    """Build a fake ``paramiko`` whose client consults the installed policy."""
    mod = types.ModuleType("paramiko")

    class SSHException(Exception):
        pass

    class BadHostKeyException(SSHException):
        pass

    class MissingHostKeyPolicy:
        def missing_host_key(self, client, hostname, key):  # pragma: no cover
            raise NotImplementedError

    class _Forbidden(MissingHostKeyPolicy):
        def __init__(self) -> None:
            raise AssertionError("permissive host-key policy must never be used")

    class SSHClient:
        instances: list[SSHClient] = []

        def __init__(self) -> None:
            self.loaded: list[str | None] = []
            self.policy: Any = None
            self.host_keys = FakeHostKeys()
            self.authenticated = False
            self.closed = False
            SSHClient.instances.append(self)

        def load_system_host_keys(self, filename: str | None = None) -> None:
            self.loaded.append(filename)

        def load_host_keys(self, filename: str) -> None:  # pragma: no cover
            raise AssertionError("writable host-key file must not be loaded")

        def set_missing_host_key_policy(self, policy: Any) -> None:
            self.policy = policy

        def get_host_keys(self) -> FakeHostKeys:
            return self.host_keys

        def connect(self, *, hostname: str, port: int = 22, **_kw: Any) -> None:
            entry = hostname if port == 22 else f"[{hostname}]:{port}"
            trusted = known_files is not None and any(
                f is not None and f in known_files for f in self.loaded
            )
            if not trusted:
                self.policy.missing_host_key(self, entry, server_key)
            self.authenticated = True

        def open_sftp(self) -> Any:
            sftp = MagicMock()
            sftp.stat.return_value = MagicMock(st_mode=0o040755)
            return sftp

        def close(self) -> None:
            self.closed = True

    mod.SSHException = SSHException
    mod.BadHostKeyException = BadHostKeyException
    mod.MissingHostKeyPolicy = MissingHostKeyPolicy
    mod.AutoAddPolicy = _Forbidden
    mod.WarningPolicy = _Forbidden
    mod.RejectPolicy = MissingHostKeyPolicy
    mod.SSHClient = SSHClient
    return mod


@pytest.fixture
def managed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "data" / "ssh" / "known_hosts"
    monkeypatch.setattr(_ssh_host_keys, "default_managed_known_hosts_path", lambda: path)
    return path


def _configure(client: Any, mod: Any, **kw: Any) -> None:
    configure_host_key_verification(client, mod, host="h.example", port=2222, **kw)


def test_default_rejects_unknown_host_with_actionable_message(managed: Path) -> None:
    key = FakeKey()
    mod = _fake_paramiko(key)
    client = mod.SSHClient()
    _configure(client, mod)
    with pytest.raises(mod.SSHException) as exc:
        client.connect(hostname="h.example", port=2222)
    message = str(exc.value)
    assert "not trusted" in message
    assert host_key_fingerprint(key) in message
    assert "ssh-keyscan -p 2222 h.example" in message
    assert "trust_on_first_use" in message and "host_key_fingerprint" in message
    assert client.authenticated is False
    assert client.loaded == [None]  # system known_hosts only (managed file absent)
    assert not managed.exists()


def test_loads_system_configured_and_managed_known_hosts(tmp_path: Path, managed: Path) -> None:
    configured = tmp_path / "configured_known_hosts"
    configured.write_text("", encoding="ascii")
    managed.parent.mkdir(parents=True)
    managed.write_text("", encoding="ascii")
    mod = _fake_paramiko(FakeKey(), known_files={str(configured)})
    client = mod.SSHClient()
    _configure(client, mod, known_hosts_file=configured)
    assert client.loaded == [None, str(configured), str(managed)]
    client.connect(hostname="h.example", port=2222)
    assert client.authenticated is True


def test_missing_configured_known_hosts_is_actionable(tmp_path: Path, managed: Path) -> None:
    mod = _fake_paramiko(FakeKey())
    missing = tmp_path / "nope"
    with pytest.raises(mod.SSHException, match="does not exist.*ssh-keyscan"):
        _configure(mod.SSHClient(), mod, known_hosts_file=missing)


def test_trust_on_first_use_persists_key_then_enforces_it(managed: Path) -> None:
    key = FakeKey()
    mod = _fake_paramiko(key, known_files={str(managed)})
    first = mod.SSHClient()
    _configure(first, mod, trust_on_first_use=True)
    first.connect(hostname="h.example", port=2222)
    assert first.authenticated is True
    assert first.host_keys.added == [("[h.example]:2222", "ssh-ed25519", key)]
    assert (
        managed.read_text(encoding="ascii") == f"[h.example]:2222 ssh-ed25519 {key.get_base64()}\n"
    )

    # The next connection, even without TOFU, trusts the persisted key file.
    second = mod.SSHClient()
    _configure(second, mod)
    assert str(managed) in second.loaded
    second.connect(hostname="h.example", port=2222)
    assert second.authenticated is True


def test_pinned_fingerprint_accepts_match_and_rejects_mismatch(managed: Path) -> None:
    key = FakeKey()
    mod = _fake_paramiko(key)
    ok = mod.SSHClient()
    _configure(ok, mod, fingerprint=host_key_fingerprint(key))
    assert ok.loaded == []  # the pin replaces known_hosts lookups
    ok.connect(hostname="h.example", port=2222)
    assert ok.authenticated is True

    md5 = hashlib.md5(key.asbytes(), usedforsecurity=False).hexdigest()
    md5_client = mod.SSHClient()
    _configure(md5_client, mod, fingerprint=md5)
    md5_client.connect(hostname="h.example", port=2222)
    assert md5_client.authenticated is True

    bad = mod.SSHClient()
    _configure(bad, mod, fingerprint=host_key_fingerprint(FakeKey(b"other")))
    with pytest.raises(mod.SSHException, match="does not match the pinned"):
        bad.connect(hostname="h.example", port=2222)
    assert bad.authenticated is False
    assert not managed.exists()


def test_normalize_fingerprint() -> None:
    assert normalize_fingerprint("SHA256:abc=") == "SHA256:abc"
    assert normalize_fingerprint("AA" * 16).startswith("MD5:aa:aa")
    with pytest.raises(ValueError, match="host_key_fingerprint"):
        normalize_fingerprint("garbage")


def test_ssh_backend_paramiko_rejects_unknown_host(monkeypatch, managed: Path) -> None:
    mod = _fake_paramiko(FakeKey())
    monkeypatch.setitem(sys.modules, "paramiko", mod)
    backend = SshBackend(host="h.example", port=2222, use_paramiko=True)
    with backend.sandbox("arm") as box, pytest.raises(mod.SSHException, match="not trusted"):
        box.run_command(["true"])
    assert mod.SSHClient.instances[-1].closed is True
    assert mod.SSHClient.instances[-1].authenticated is False


def test_ssh_backend_legacy_strict_false_is_trust_on_first_use(monkeypatch, managed) -> None:
    backend = SshBackend(host="h", strict_host_key_checking=False, use_paramiko=True)
    assert backend.trust_on_first_use is True
    assert SshBackend(host="h").trust_on_first_use is False
    with pytest.raises(ValueError, match="use_paramiko=True"):
        SshBackend(host="h", host_key_fingerprint="SHA256:abc")


def test_ssh_backend_bad_host_key_is_actionable(monkeypatch, managed: Path) -> None:
    mod = _fake_paramiko(FakeKey())

    def _changed(self, **_kw):
        raise mod.BadHostKeyException("mismatch")

    mod.SSHClient.connect = _changed
    monkeypatch.setitem(sys.modules, "paramiko", mod)
    backend = SshBackend(host="h.example", use_paramiko=True)
    with (
        backend.sandbox("arm") as box,
        pytest.raises(mod.SSHException, match="CHANGED.*ssh-keygen -R"),
    ):
        box.run_command(["true"])


@pytest.mark.asyncio
async def test_sftp_mount_rejects_unknown_host_by_default(monkeypatch, managed: Path) -> None:
    mod = _fake_paramiko(FakeKey())
    monkeypatch.setitem(sys.modules, "paramiko", mod)
    backend = SftpMountBackend(host="h.example", user="u", password="p")
    assert backend.trust_on_first_use is False
    assert await backend.test_connection() is False
    assert mod.SSHClient.instances[-1].authenticated is False
    assert not managed.exists()


@pytest.mark.asyncio
async def test_sftp_mount_explicit_trust_on_first_use(monkeypatch, managed: Path) -> None:
    key = FakeKey()
    mod = _fake_paramiko(key)
    monkeypatch.setitem(sys.modules, "paramiko", mod)
    backend = SftpMountBackend(host="h.example", user="u", password="p", trust_on_first_use=True)
    assert await backend.test_connection() is True
    assert managed.read_text(encoding="ascii").startswith("h.example ssh-ed25519 ")


@pytest.mark.asyncio
async def test_sftp_mount_pinned_fingerprint(monkeypatch, managed: Path) -> None:
    key = FakeKey()
    mod = _fake_paramiko(key)
    monkeypatch.setitem(sys.modules, "paramiko", mod)
    good = SftpMountBackend(host="h", host_key_fingerprint=host_key_fingerprint(key))
    assert await good.test_connection() is True
    bad = SftpMountBackend(host="h", host_key_fingerprint=host_key_fingerprint(FakeKey(b"x")))
    assert await bad.test_connection() is False


def test_no_permissive_host_key_policy_in_runtime() -> None:
    root = Path(_ssh_host_keys.__file__).resolve().parents[2]
    offenders = [
        str(path.relative_to(root))
        for path in root.rglob("*.py")
        if "AutoAddPolicy(" in path.read_text(encoding="utf-8", errors="ignore")
        or "WarningPolicy(" in path.read_text(encoding="utf-8", errors="ignore")
    ]
    assert offenders == []
