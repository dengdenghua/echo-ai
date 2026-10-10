"""Per-field encryption for sensitive ``mount_options`` entries.

Pattern mirrors ``runtime/adapters/mcp_client/oauth.py``: opt-in via env var
``ECHO_WORKSPACE_KEY`` (a urlsafe-base64 32-byte Fernet key from
``cryptography.fernet.Fernet.generate_key()``, or any passphrase which we
derive through PBKDF2). When unset, a key is derived from the host machine
id — enough to keep creds opaque at rest on a single host but not a
substitute for a real secret store in shared deployments.

Sensitive fields are matched by key name at any depth of nested dicts and
lists (see ``is_sensitive_key``): case and separators are ignored, and any
key containing a credential fragment counts — ``password`` / ``passwd`` /
``passphrase`` / ``secret`` / ``token`` / ``credential`` / ``api_key`` /
``access_key`` / ``private_key`` / ``authorization`` / ``cookie``, so
``SMB_Password``, ``apiKey`` and ``client-secret`` all hit. The whole value
under such a key is the secret, whatever its type.

Encrypted strings are written as ``"ENC:<base64_ciphertext>"`` (other types,
e.g. a nested ``credentials`` dict, as ``"ENCJ:<ciphertext of the JSON>"``)
so the rest of the ``mount_options`` dict stays human-readable for debugging,
querying, and schema migrations. ``encrypt_options`` returns the modified
dict serialized as JSON; ``decrypt_options`` is the inverse.

``redact_options`` applies the same key test to blank secrets out of HTTP
responses; server-side code keeps reading the decrypted values.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import platform
import subprocess
import uuid
from pathlib import Path
from typing import Any

_LOG = logging.getLogger("echo.workspace.crypto")

# Credential-like key fragments. Keys are compared with case and separators
# removed (``apiKey`` / ``API-KEY`` / ``api_key`` all become ``apikey``), the
# same normalization as ``codex_backend.security.is_sensitive_env_name``.
SENSITIVE_KEY_FRAGMENTS = (
    "password",
    "passwd",
    "passphrase",
    "secret",
    "token",
    "credential",
    "apikey",
    "accesskey",
    "privatekey",
    "authorization",
    "cookie",
)
# Abbreviations that name a credential only as the whole key.
_SENSITIVE_EXACT_KEYS = frozenset({"pass", "pwd"})
_ENC_PREFIX = "ENC:"
# Non-string secrets are encrypted as JSON so their type survives decryption.
_ENC_JSON_PREFIX = "ENCJ:"

# Fixed salt for the PBKDF2 derivation. We're not protecting against offline
# brute-force on a stolen DB (the host has the key anyway); the derivation
# just gives us key-shape conformance for Fernet (32 urlsafe-base64 bytes).
_KDF_SALT = b"echo-workspace-key-v1"
_KDF_ITERATIONS = 100_000

_MACHINE_ID_CACHE: str | None = None
_CIPHER_CACHE: Any = None
_CIPHER_KEY_CACHE: bytes | None = None


# ─── machine id ────────────────────────────────────────────────────────────


def _read_machine_id() -> str:
    """Cross-platform best-effort stable machine id. Never raises — falls
    back to the host's MAC address via ``uuid.getnode()`` which is always
    available but not stable across hardware changes.
    """
    system = platform.system()
    if system == "Darwin":
        try:
            out = subprocess.check_output(
                ["/usr/sbin/ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                stderr=subprocess.DEVNULL,
                timeout=2.0,
            ).decode("utf-8", "replace")
            for line in out.splitlines():
                if "IOPlatformUUID" in line:
                    parts = line.split('"')
                    if len(parts) >= 4:
                        return parts[-2]
        except (OSError, subprocess.SubprocessError):
            _LOG.debug("macOS platform UUID probe failed; using fallback", exc_info=True)
    if system == "Linux":
        for candidate in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
            try:
                return Path(candidate).read_text(encoding="utf-8").strip()
            except OSError:
                continue
    if system == "Windows":
        try:
            out = subprocess.check_output(
                ["reg", "query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"],
                stderr=subprocess.DEVNULL,
                timeout=2.0,
            ).decode("utf-8", "replace")
            for line in out.splitlines():
                if "MachineGuid" in line:
                    return line.split()[-1]
        except (OSError, subprocess.SubprocessError):
            _LOG.debug("Windows machine GUID probe failed; using fallback", exc_info=True)
    # Last resort: MAC address via uuid.getnode() (always available, stable
    # within a single host's lifetime, not stable across hardware swaps).
    return f"mac:{uuid.getnode():012x}"


def _machine_id() -> str:
    global _MACHINE_ID_CACHE
    if _MACHINE_ID_CACHE is None:
        _MACHINE_ID_CACHE = _read_machine_id()
    return _MACHINE_ID_CACHE


# ─── key derivation ─────────────────────────────────────────────────────────


def _derive_fernet_key(material: str) -> bytes:
    """Derive a urlsafe-base64 32-byte Fernet key from arbitrary text."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_KDF_SALT,
        iterations=_KDF_ITERATIONS,
    )
    raw = kdf.derive(material.encode("utf-8"))
    return base64.urlsafe_b64encode(raw)


def _resolve_key() -> bytes:
    """Return the active Fernet key bytes. Prefers ``ECHO_WORKSPACE_KEY``,
    falls back to a machine-derived key. Caches the result for the process.
    """
    global _CIPHER_KEY_CACHE
    if _CIPHER_KEY_CACHE is not None:
        return _CIPHER_KEY_CACHE
    env_key = os.environ.get("ECHO_WORKSPACE_KEY")
    if env_key:
        # Accept either a ready-made Fernet key (urlsafe base64 32 bytes)
        # or any passphrase (derive via PBKDF2). We detect a "raw Fernet
        # key" by checking it decodes to exactly 32 bytes.
        try:
            decoded = base64.urlsafe_b64decode(env_key.encode("utf-8"))
            if len(decoded) == 32:
                _CIPHER_KEY_CACHE = env_key.encode("utf-8")
                return _CIPHER_KEY_CACHE
        except (ValueError, base64.binascii.Error):
            _LOG.debug("workspace key is a passphrase rather than a Fernet key")
        _CIPHER_KEY_CACHE = _derive_fernet_key(env_key)
        return _CIPHER_KEY_CACHE
    _CIPHER_KEY_CACHE = _derive_fernet_key(_machine_id())
    return _CIPHER_KEY_CACHE


def _cipher() -> Any:
    """Return a cached Fernet instance, or None if cryptography is missing
    or the configured key is invalid. A None cipher means ``encrypt_options``
    degrades to plaintext JSON — callers still work, just without at-rest
    protection. We log once on the first failure so the operator notices.
    """
    global _CIPHER_CACHE
    if _CIPHER_CACHE is not None:
        return _CIPHER_CACHE
    try:
        from cryptography.fernet import Fernet
    except ImportError:
        _LOG.warning(
            "cryptography package unavailable; workspace mount_option "
            "credentials will be stored in plaintext"
        )
        return None
    try:
        _CIPHER_CACHE = Fernet(_resolve_key())
    except Exception as exc:  # noqa: BLE001 — bad key shape shouldn't crash callers
        _LOG.warning("workspace crypto key invalid (%s); falling back to plaintext", exc)
        _CIPHER_CACHE = None
    return _CIPHER_CACHE


# ─── tree walkers ──────────────────────────────────────────────────────────


def is_sensitive_key(key: object) -> bool:
    """Whether a ``mount_options`` key names a credential.

    The single test behind both at-rest encryption and HTTP redaction, so
    the two can never disagree about what is secret.
    """
    if not isinstance(key, str):
        return False
    compact = "".join(char for char in key.lower() if char.isalnum())
    return compact in _SENSITIVE_EXACT_KEYS or any(
        fragment in compact for fragment in SENSITIVE_KEY_FRAGMENTS
    )


def _holds_secret(key: object, value: Any) -> bool:
    """A sensitive key that carries data. ``None``, empty values and booleans
    (flags such as ``use_token``) reveal nothing and are left alone.
    """
    if not is_sensitive_key(key) or value is None or isinstance(value, bool):
        return False
    return not (isinstance(value, (str, list, dict)) and not value)


def _is_encrypted(value: Any) -> bool:
    return isinstance(value, str) and value.startswith((_ENC_PREFIX, _ENC_JSON_PREFIX))


def _encrypt_value(value: Any, cipher: Any) -> str:
    if isinstance(value, str):
        return _ENC_PREFIX + cipher.encrypt(value.encode("utf-8")).decode("ascii")
    payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
    return _ENC_JSON_PREFIX + cipher.encrypt(payload).decode("ascii")


def _walk_encrypt(value: Any, cipher: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if _holds_secret(k, v) and not _is_encrypted(v):
                out[k] = _encrypt_value(v, cipher)
            else:
                out[k] = _walk_encrypt(v, cipher)
        return out
    if isinstance(value, list):
        return [_walk_encrypt(v, cipher) for v in value]
    return value


def _walk_decrypt(value: Any, cipher: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            out[k] = _walk_decrypt(v, cipher)
        return out
    if _is_encrypted(value):
        is_json = value.startswith(_ENC_JSON_PREFIX)
        token = value[len(_ENC_JSON_PREFIX if is_json else _ENC_PREFIX) :]
        if cipher is None:
            # Best-effort: return the ciphertext minus the marker so the
            # value isn't silently dropped; the caller can decide what to do.
            return token
        try:
            plain = cipher.decrypt(token.encode("ascii")).decode("utf-8")
            # A JSON payload may hold legacy per-field ``ENC:`` values.
            return _walk_decrypt(json.loads(plain), cipher) if is_json else plain
        except Exception as exc:  # noqa: BLE001 — corrupt ciphertext shouldn't crash reads
            _LOG.warning("workspace crypto: failed to decrypt value: %s", exc)
            return value
    if isinstance(value, list):
        return [_walk_decrypt(v, cipher) for v in value]
    return value


# ─── public API ─────────────────────────────────────────────────────────────


def redact_options(options: dict[str, Any] | None) -> tuple[dict[str, Any], list[str]]:
    """Return a copy of ``options`` safe to send to clients, plus the dotted
    paths of the credentials it blanked (e.g. ``["password", "s3.secret_key"]``).

    Every value ``encrypt_options`` would encrypt becomes ``None``, so a
    client can tell a credential is set without seeing it. Server-side code
    that mounts the workspace keeps using the decrypted
    ``Workspace.mount_options``; only HTTP responses go through here.
    """
    secrets_set: list[str] = []

    def walk(value: Any, path: str) -> Any:
        if isinstance(value, dict):
            out: dict[str, Any] = {}
            for k, v in value.items():
                child = f"{path}.{k}" if path else str(k)
                if _holds_secret(k, v):
                    out[k] = None
                    secrets_set.append(child)
                else:
                    out[k] = walk(v, child)
            return out
        if isinstance(value, list):
            return [walk(v, f"{path}.{i}") for i, v in enumerate(value)]
        return value

    return walk(dict(options or {}), ""), secrets_set


def encrypt_options(options: dict[str, Any]) -> str:
    """Walk ``options`` recursively, encrypt every value held by a sensitive
    key (``is_sensitive_key``), then return the result as a JSON string.
    Non-sensitive fields stay human-readable in the SQLite column.
    Returns plain JSON (no encryption) when ``cryptography`` is unavailable
    or the configured key is invalid — see ``_cipher`` — and logs a warning
    naming the credential fields written in plaintext.
    """
    cipher = _cipher()
    if cipher is None:
        _, plaintext = redact_options(options)
        if plaintext:
            _LOG.warning(
                "workspace crypto unavailable: storing credential field(s) %s of "
                "mount_options in PLAINTEXT; install `cryptography` and check "
                "ECHO_WORKSPACE_KEY",
                ", ".join(plaintext),
            )
        return json.dumps(options or {}, ensure_ascii=False)
    redacted = _walk_encrypt(options or {}, cipher)
    return json.dumps(redacted, ensure_ascii=False)


def decrypt_options(encrypted: str) -> dict[str, Any]:
    """Inverse of ``encrypt_options``: parse the JSON string, walk the
    tree, and decrypt any ``ENC:``-prefixed values. Returns an empty
    dict when ``encrypted`` is empty or unparseable.
    """
    if not encrypted:
        return {}
    try:
        raw = json.loads(encrypted)
    except (TypeError, ValueError, json.JSONDecodeError):
        _LOG.warning("workspace crypto: mount_options_json is not valid JSON")
        return {}
    if not isinstance(raw, dict):
        return {}
    return _walk_decrypt(raw, _cipher())
