"""Managed Codex auth files: validation, legacy seeding, quarantine and control config."""

from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path

from ._security_support import _atomic_write_private, _read_owned_private_file
from .types import ConfigurationError


def _quarantine_unusable_auth(home: Path) -> Path | None:
    """Retire an unusable ``auth.json`` without destroying it.

    The rejected file is renamed inside the managed home so an operator can
    still inspect it; the next login writes a fresh ``auth.json``.
    """

    source = home / "auth.json"
    try:
        if not source.is_file():
            return None
    except OSError:
        return None
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    target = home / f"auth.json.revoked-{stamp}"
    suffix = 1
    while target.exists():
        suffix += 1
        target = home / f"auth.json.revoked-{stamp}-{suffix}"
    os.replace(source, target)
    return target


def _control_config() -> str:
    return "\n".join(
        [
            "# Managed by Echo account control plane.",
            "check_for_update_on_startup = false",
            'cli_auth_credentials_store = "file"',
            'file_opener = "none"',
            "notify = []",
            "mcp_servers = {}",
            "plugins = {}",
            "marketplaces = {}",
            "skills = { config = [] }",
            "agents = { enabled = false }",
            "",
        ]
    )


def _has_fresh_chatgpt_access_token(path: Path) -> bool:
    """Use JWT expiry only as a refresh hint; App Server still authenticates.

    This does not verify a JWT or grant access. Missing/malformed expiry takes
    the normal refresh path, and a logged-out App Server is still rejected.
    """
    data = _read_owned_private_file(path, max_bytes=1024 * 1024)
    if data is None:
        return False
    try:
        auth = json.loads(data)
        if not isinstance(auth, dict) or auth.get("auth_mode") != "chatgpt":
            return False
        token = auth["tokens"]["access_token"]
        if not isinstance(token, str) or len(token.split(".")) != 3:
            return False
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        expiry = claims.get("exp") if isinstance(claims, dict) else None
        return type(expiry) in (int, float) and time.time() + 300 < expiry < float("inf")
    except (ValueError, KeyError, TypeError, UnicodeError):
        return False


def _valid_auth_file(path: Path, *, required: bool) -> bool:
    data = _read_owned_private_file(path, max_bytes=1024 * 1024)
    if data is None:
        if required:
            raise ConfigurationError("Codex auth file is missing")
        return False
    try:
        parsed = json.loads(data.decode("utf-8", errors="strict"))
    except (UnicodeError, ValueError) as exc:
        raise ConfigurationError("Codex auth file is invalid") from exc
    if not isinstance(parsed, dict):
        raise ConfigurationError("Codex auth file must contain an object")
    return True


def _quarantined_auth_matches(home: Path, canonical: bytes) -> bool:
    """Whether this exact legacy credential was already rejected and retired.

    Compares content rather than existence so the guard lapses as soon as the
    host performs a genuinely new login.
    """

    try:
        candidates = list(home.glob("auth.json.revoked-*"))
    except OSError:
        return False
    for path in candidates:
        try:
            if path.read_bytes() == canonical:
                return True
        except OSError:
            continue
    return False


def _seed_legacy_auth(target_home: Path, source_home: Path) -> None:
    target = target_home / "auth.json"
    if target.exists():
        _valid_auth_file(target, required=True)
        return
    source = source_home / "auth.json"
    data = _read_owned_private_file(source, max_bytes=1024 * 1024)
    if data is None:
        return
    try:
        parsed = json.loads(data.decode("utf-8", errors="strict"))
    except (UnicodeError, ValueError) as exc:
        raise ConfigurationError("legacy Codex auth file is invalid") from exc
    if not isinstance(parsed, dict):
        raise ConfigurationError("legacy Codex auth file must contain an object")
    canonical = (json.dumps(parsed, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    # A credential the provider already rejected must not be re-seeded on the
    # next child start: doing so recreated the very file we had just
    # quarantined, so every read failed, retired a fresh App Server child and
    # failed again.  The panel could never settle on "not connected" and the
    # churn kept racing the authorization request.  Only the exact rejected
    # bytes are skipped, so a later host login is still inherited.
    if _quarantined_auth_matches(target_home, canonical):
        return
    _atomic_write_private(target, canonical)
