"""SSH host-key verification shared by the Paramiko-backed SSH and SFTP adapters.

Default policy is *reject unknown hosts*: the client trusts only keys found in
the system ``known_hosts`` files, an operator-configured ``known_hosts_file``
and the runtime-managed ``known_hosts`` file (keys persisted by an earlier,
explicitly enabled trust-on-first-use connection).

Two explicit, per-connection opt-ins exist:

* ``host_key_fingerprint`` pins the server key (``SHA256:<base64>`` as printed
  by ``ssh-keygen -lf``, or an MD5 hex fingerprint). The pin is checked before
  any authentication is attempted; known_hosts entries are not consulted.
* ``trust_on_first_use`` accepts the key of a host that has *no* known entry
  and appends it to the runtime-managed ``known_hosts`` file, so every later
  connection is strictly verified against it. A changed key is still rejected.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import hmac
import logging
import os
import threading
from pathlib import Path
from typing import Any

_logger = logging.getLogger(__name__)

_MANAGED_WRITE_LOCK = threading.Lock()


def default_managed_known_hosts_path() -> Path:
    """``<data>/ssh/known_hosts`` — where trust-on-first-use keys are persisted."""
    from runtime.platform.process.paths import app_paths

    return app_paths().data_dir / "ssh" / "known_hosts"


def host_key_fingerprint(key: Any) -> str:
    """OpenSSH-style ``SHA256:<base64, unpadded>`` fingerprint of ``key``."""
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode("ascii").rstrip("=")


def _md5_fingerprint(key: Any) -> str:
    digest = hashlib.md5(key.asbytes(), usedforsecurity=False).hexdigest()  # nosec B324
    return ":".join(digest[i : i + 2] for i in range(0, len(digest), 2))


def normalize_fingerprint(value: str) -> str:
    """Canonicalise a configured pin; raise ``ValueError`` when malformed."""
    text = str(value or "").strip()
    if text.upper().startswith("SHA256:"):
        body = text[7:].rstrip("=")
        if not body:
            raise ValueError("host_key_fingerprint 'SHA256:' value is empty")
        return "SHA256:" + body
    if text.upper().startswith("MD5:"):
        text = text[4:]
    hex_only = text.replace(":", "").lower()
    if len(hex_only) == 32 and all(c in "0123456789abcdef" for c in hex_only):
        return "MD5:" + ":".join(hex_only[i : i + 2] for i in range(0, 32, 2))
    raise ValueError(
        "host_key_fingerprint must look like 'SHA256:<base64>' "
        "(see `ssh-keygen -lf <key.pub>`) or an MD5 hex fingerprint"
    )


def _fingerprint_matches(key: Any, expected: str) -> bool:
    if expected.startswith("MD5:"):
        actual = "MD5:" + _md5_fingerprint(key)
    else:
        actual = host_key_fingerprint(key)
    return hmac.compare_digest(actual.encode("ascii"), expected.encode("ascii"))


def _known_hosts_entry(hostname: str, port: int) -> str:
    return hostname if port == 22 else f"[{hostname}]:{port}"


def _keyscan_hint(host: str, port: int, target: Path | str) -> str:
    port_flag = f"-p {port} " if port != 22 else ""
    return f"ssh-keyscan {port_flag}{host} >> {target}"


def _append_known_host(path: Path, hostname: str, key: Any) -> None:
    line = f"{hostname} {key.get_name()} {key.get_base64()}\n"
    with _MANAGED_WRITE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with contextlib.suppress(OSError):
            os.chmod(path.parent, 0o700)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="ascii") as handle:
            handle.write(line)


def configure_host_key_verification(
    client: Any,
    paramiko_mod: Any,
    *,
    host: str,
    port: int,
    known_hosts_file: str | Path | None = None,
    trust_on_first_use: bool = False,
    fingerprint: str | None = None,
    managed_known_hosts_file: str | Path | None = None,
) -> None:
    """Load trusted keys into ``client`` and install a non-permissive policy.

    Never installs ``AutoAddPolicy``/``WarningPolicy``. Raises
    ``paramiko.SSHException`` with an actionable message when a configured
    known_hosts file is missing.
    """
    managed = (
        Path(managed_known_hosts_file)
        if managed_known_hosts_file is not None
        else default_managed_known_hosts_path()
    )
    base_policy = getattr(paramiko_mod, "MissingHostKeyPolicy", object)
    ssh_exception = paramiko_mod.SSHException

    if fingerprint:
        expected = normalize_fingerprint(fingerprint)

        class _PinnedFingerprintPolicy(base_policy):  # type: ignore[misc, valid-type]
            def missing_host_key(self, client_: Any, hostname: str, key: Any) -> None:
                if not _fingerprint_matches(key, expected):
                    raise ssh_exception(
                        f"SSH host key for {hostname} does not match the pinned "
                        f"host_key_fingerprint (expected {expected}, server presented "
                        f"{host_key_fingerprint(key)}). Refusing to connect: verify the "
                        "server key out-of-band and update host_key_fingerprint if it "
                        "was legitimately rotated."
                    )
                client_.get_host_keys().add(hostname, key.get_name(), key)

        # Pinning replaces known_hosts lookups so the policy always runs and
        # the pin is enforced before authentication.
        client.set_missing_host_key_policy(_PinnedFingerprintPolicy())
        return

    client.load_system_host_keys()
    if known_hosts_file is not None:
        path = Path(known_hosts_file)
        if not path.is_file():
            raise ssh_exception(
                f"known_hosts_file {path} does not exist. Create it with "
                f"`{_keyscan_hint(host, port, path)}` and verify the fingerprint "
                "out-of-band, or omit known_hosts_file to use the system known_hosts."
            )
        # Loaded as read-only "system" keys: Paramiko never rewrites them.
        client.load_system_host_keys(str(path))
    if managed.is_file():
        client.load_system_host_keys(str(managed))

    if trust_on_first_use:

        class _TrustOnFirstUsePolicy(base_policy):  # type: ignore[misc, valid-type]
            def missing_host_key(self, client_: Any, hostname: str, key: Any) -> None:
                _logger.warning(
                    "ssh host %s · trust_on_first_use accepted unknown host key %s %s; "
                    "persisted to %s (later key changes will be rejected)",
                    hostname,
                    key.get_name(),
                    host_key_fingerprint(key),
                    managed,
                )
                _append_known_host(managed, hostname, key)
                client_.get_host_keys().add(hostname, key.get_name(), key)

        client.set_missing_host_key_policy(_TrustOnFirstUsePolicy())
        return

    hint_file = known_hosts_file or managed

    class _ActionableRejectPolicy(base_policy):  # type: ignore[misc, valid-type]
        def missing_host_key(self, client_: Any, hostname: str, key: Any) -> None:
            raise ssh_exception(
                f"SSH host key for {hostname} is not trusted (server presented "
                f"{key.get_name()} {host_key_fingerprint(key)}). Verify the fingerprint "
                f"out-of-band, then either add it to known_hosts (e.g. "
                f"`{_keyscan_hint(host, port, hint_file)}`), set "
                "host_key_fingerprint to pin it, or explicitly enable "
                "trust_on_first_use for this connection."
            )

    client.set_missing_host_key_policy(_ActionableRejectPolicy())


def host_key_error_hint(exc: BaseException, *, host: str, port: int) -> str | None:
    """Actionable text for Paramiko's ``BadHostKeyException`` (changed key)."""
    if type(exc).__name__ != "BadHostKeyException":
        return None
    return (
        f"SSH host key for {_known_hosts_entry(host, port)} CHANGED since it was "
        "trusted — possible man-in-the-middle. If the server key was legitimately "
        "rotated, remove the stale entry (`ssh-keygen -R "
        f"{_known_hosts_entry(host, port)}`, also from the runtime-managed "
        "known_hosts) and verify the new fingerprint out-of-band."
    )


__all__ = [
    "configure_host_key_verification",
    "default_managed_known_hosts_path",
    "host_key_error_hint",
    "host_key_fingerprint",
    "normalize_fingerprint",
]
