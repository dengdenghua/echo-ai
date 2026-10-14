"""The owner account of a self-hosted install.

A passwordless ``local_auth`` config outside development and the desktop
shell (see :func:`config.owner_account_candidate`) has exactly one local
account: the owner. Nobody can sign in until it exists. On first run the
server prints a one-time setup code to its console and writes it to the
instance data dir; whoever presents that code sets the owner's name and
password. From then on the owner signs in with that password.

Both steps are refused for clients outside this machine and the local
network, including requests a reverse proxy forwards for a public address.
Other people reach a public deployment through email sign-in instead.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import hash_password, owner_account_candidate, verify_password

logger = logging.getLogger(__name__)

_OWNER_FILE = "local-owner.json"
_SETUP_CODE_FILE = "owner-setup-code.txt"
_JWT_SECRET_FILE = "local-auth-jwt-secret"
# No 0/O or 1/I/L: the code is read off a terminal and typed by hand.
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_CODE_GROUPS = 3
_CODE_GROUP_LENGTH = 4
_PASSWORD_MIN_LENGTH = 8
_PASSWORD_MAX_BYTES = 72  # bcrypt's input limit
DUMMY_BCRYPT_HASH = "bcrypt:$2b$12$i97XS4XVBLbe1Ipw01D4C.KRRk3TznyetM5gIwNVmEc5gb8LS2Nzi"

_LOCAL_NETWORKS = tuple(
    ipaddress.ip_network(net)
    for net in (
        "127.0.0.0/8",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",
        # Carrier-grade NAT space, which also carries Tailscale addresses.
        "100.64.0.0/10",
        "::1/128",
        "fc00::/7",
        "fe80::/10",
    )
)


class OwnerSetupError(ValueError):
    """The setup request cannot create the owner; ``detail`` says why."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class OwnerRecord:
    username: str
    display_name: str | None
    password_hash: str


def is_local_network_address(value: str) -> bool:
    """Whether ``value`` is this machine or a private/LAN address."""
    try:
        address = ipaddress.ip_address(value.strip().strip("[]"))
    except ValueError:
        return False
    if address.version == 6 and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return any(
        address.version == network.version and address in network for network in _LOCAL_NETWORKS
    )


def _forwarded_addresses(headers: Any) -> list[str]:
    values: list[str] = []
    for name in ("x-forwarded-for", "x-real-ip"):
        raw = str(headers.get(name) or "")
        values.extend(part.strip() for part in raw.split(",") if part.strip())
    for element in str(headers.get("forwarded") or "").split(","):
        for pair in element.split(";"):
            key, _, value = pair.strip().partition("=")
            if key.strip().lower() == "for" and value:
                host = value.strip().strip('"')
                if host.startswith("["):
                    host = host[1:].split("]", 1)[0]
                elif host.count(":") == 1:
                    host = host.split(":", 1)[0]
                values.append(host)
    return values


def request_from_local_network(request: Any) -> bool:
    """The direct peer and every forwarded-for hop must be local.

    Forwarding headers can only make this stricter: a proxy that relays a
    public client is refused, and a LAN client adding a header refuses
    itself.
    """
    client = getattr(request, "client", None)
    peer = str(getattr(client, "host", "") or "")
    if not is_local_network_address(peer):
        return False
    return all(is_local_network_address(hop) for hop in _forwarded_addresses(request.headers))


def request_from_loopback(request: Any) -> bool:
    client = getattr(request, "client", None)
    try:
        return ipaddress.ip_address(str(getattr(client, "host", "") or "")).is_loopback
    except ValueError:
        return False


def _write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _normalize_code(code: str | None) -> str:
    return "".join(ch for ch in str(code or "").upper() if ch.isalnum())


class OwnerAccountStore:
    """The owner record and its first-run setup code, under ``directory``."""

    def __init__(self, directory: Path) -> None:
        self.directory = Path(directory)
        self._lock = threading.Lock()

    @property
    def setup_code_path(self) -> Path:
        return self.directory / _SETUP_CODE_FILE

    def owner(self) -> OwnerRecord | None:
        path = self.directory / _OWNER_FILE
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            # A damaged record must never reopen first-run setup.
            logger.error("owner account record is unreadable: %s", path)
            return OwnerRecord(username="", display_name=None, password_hash="")
        return OwnerRecord(
            username=str(data.get("username") or ""),
            display_name=data.get("display_name") or None,
            password_hash=str(data.get("password_hash") or ""),
        )

    def setup_required(self) -> bool:
        return self.owner() is None

    def setup_code(self) -> str:
        """The pending setup code, created once and kept across restarts."""
        with self._lock:
            try:
                existing = _normalize_code(self.setup_code_path.read_text(encoding="utf-8"))
            except OSError:
                existing = ""
            if len(existing) == _CODE_GROUPS * _CODE_GROUP_LENGTH:
                raw = existing
            else:
                raw = "".join(
                    secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_GROUPS * _CODE_GROUP_LENGTH)
                )
            code = "-".join(
                raw[index : index + _CODE_GROUP_LENGTH]
                for index in range(0, len(raw), _CODE_GROUP_LENGTH)
            )
            if raw != existing:
                _write_private(self.setup_code_path, code + "\n")
            return code

    def setup_code_matches(self, code: str | None) -> bool:
        expected = _normalize_code(self.setup_code())
        return hmac.compare_digest(_normalize_code(code).encode(), expected.encode())

    def create(self, username: str, password: str, display_name: str | None) -> OwnerRecord:
        if len(password) < _PASSWORD_MIN_LENGTH:
            raise OwnerSetupError(400, f"密码至少需要 {_PASSWORD_MIN_LENGTH} 个字符")
        if len(password.encode("utf-8")) > _PASSWORD_MAX_BYTES:
            raise OwnerSetupError(400, "密码太长，请控制在 72 个英文字符以内")
        record = OwnerRecord(
            username=username,
            display_name=(display_name or "").strip() or None,
            password_hash=hash_password(password),
        )
        with self._lock:
            if self.owner() is not None:
                raise OwnerSetupError(409, "本机账户已经设置，请直接登录")
            payload = {
                "username": record.username,
                "display_name": record.display_name,
                "password_hash": record.password_hash,
                "created_at": time.time(),
            }
            _write_private(self.directory / _OWNER_FILE, json.dumps(payload, ensure_ascii=False))
            self.setup_code_path.unlink(missing_ok=True)
        return record

    def verify(self, username: str, password: str | None) -> bool:
        owner = self.owner()
        if owner is None or not owner.password_hash or password is None:
            # Same bcrypt cost as a real check: no fast "no such user" path.
            verify_password("unused-owner-check", DUMMY_BCRYPT_HASH)
            return False
        try:
            matches = verify_password(password, owner.password_hash)
        except (TypeError, ValueError):
            return False
        return matches and username.strip().casefold() == owner.username.casefold()


def owner_directory() -> Path:
    from runtime.platform.process.paths import app_paths

    return app_paths().data_dir / "auth"


@lru_cache(maxsize=8)
def _store_for(directory: str) -> OwnerAccountStore:
    return OwnerAccountStore(Path(directory))


def owner_account_store() -> OwnerAccountStore:
    """The store for the current instance data dir (one per directory)."""
    return _store_for(str(owner_directory()))


def announce_setup_code(store: OwnerAccountStore) -> None:
    """Print the pending setup code where whoever started the server sees it."""
    if not store.setup_required():
        return
    code = store.setup_code()
    logger.warning(
        "本机账户尚未设置。打开 ECHO AI 登录页，输入设置码 %s 创建本机账户（设置码也保存在 %s）。",
        code,
        store.setup_code_path,
    )


def with_owner_jwt_secret(cfg: Any) -> Any:
    """Give an owner-account install a per-instance session signing key.

    Only when the config has none (an enabled ``oct`` block lends its own),
    so a self-hosted config does not need a hand-generated secret.
    """
    local_auth = getattr(cfg, "local_auth", None)
    oct_config = getattr(cfg, "oct", None)
    if (
        not owner_account_candidate(local_auth)
        or getattr(local_auth, "jwt_secret", None)
        or (getattr(oct_config, "enabled", False) and getattr(oct_config, "jwt_secret", None))
    ):
        return cfg
    path = owner_directory() / _JWT_SECRET_FILE
    try:
        secret = path.read_text(encoding="utf-8").strip()
    except OSError:
        secret = ""
    if len(secret) < 32:
        # The prefix guarantees the validator's character classes.
        secret = "Ek9!" + secrets.token_urlsafe(48)
        _write_private(path, secret)
    return cfg.model_copy(
        update={"local_auth": local_auth.model_copy(update={"jwt_secret": secret})}
    )


def owner_login_provider(request: Any, store: OwnerAccountStore | None = None) -> dict | None:
    """The login page's ``local`` provider entry for an owner-account install.

    Hidden from clients outside this machine and the local network, which
    could not use it. Only a loopback client learns where the setup code is.
    """
    if not request_from_local_network(request):
        return None
    store = store or owner_account_store()
    owner = store.owner()
    entry: dict[str, Any] = {
        "id": "local",
        "label": "本机账户",
        "owner_account": True,
        "owner_setup_required": owner is None,
        "owner_username": owner.username if owner else None,
        "allow_any_username": False,
        "password_required": True,
        "password_only_username": None,
        "endpoint": "/api/auth/local/login",
        "endpoint_setup": "/api/auth/local/owner/setup",
    }
    if owner is None and request_from_loopback(request):
        entry["setup_code_path"] = str(store.setup_code_path)
    return entry
