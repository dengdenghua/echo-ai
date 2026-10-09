"""Per-device credentials for the echo-ai Tentacle hub.

The legacy hub authenticates every device with one shared ``ECHO_TENTACLE_TOKEN``.
That proves "someone who saw the join QR" rather than "device X", so the
transport refuses ``device/call`` peer control in that mode.  This module gives
the hub what echo-os's ``appliance/device_link.py`` provides:

* one-time pairing invitations (default 5 minute TTL) rendered as
  ``echo://join?ws=...&token=...``;
* the invitation token becomes the device credential and binds to the first
  ``tentacle_id`` that redeems it, so a paired device cannot claim another id;
* only keyed HMAC-SHA256 digests are persisted (server secret kept in a
  separate 0600 file), never plaintext tokens;
* individual revoke / rotate, which also close the device's live socket.

Shared-token compatibility: with ``allow_shared_token`` the old join token is
still accepted, but such connections are tagged ``shared`` and peer calls from
them stay refused (``-32098``), exactly like the shared-only hub.
"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import quote

from runtime.platform.io.atomic import atomic_write_bytes, atomic_write_json

try:  # module-level so FastAPI can resolve the postponed ``Request`` annotation
    from fastapi import Request as FastAPIRequest
except ImportError:  # pragma: no cover
    FastAPIRequest = Any  # type: ignore[misc,assignment]

logger = logging.getLogger(__name__)

DEVICE_CREDENTIALS_SCHEMA = "echo.tentacle.device-credentials.v1"
DEVICE_CREDENTIALS_FILENAME = "tentacle_device_credentials.json"
DEVICE_CREDENTIALS_SECRET_FILENAME = "tentacle_device_credentials.key"
INVITE_TTL_SECONDS = 5 * 60
MAX_DEVICES = 256
MAX_PENDING_INVITES = 64
# Env flag: "0"/"false"/"off" disables per-device auth (legacy shared-token hub).
PER_DEVICE_AUTH_ENV = "ECHO_TENTACLE_PER_DEVICE_AUTH"
# Env flag: "0" refuses the legacy shared join token once per-device auth is on.
ALLOW_SHARED_TOKEN_ENV = "ECHO_TENTACLE_ALLOW_SHARED_TOKEN"

_DEVICE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_AUTH_MODE_KEY = "_echo_auth_mode"
_FALSEY = frozenset({"0", "false", "no", "off"})


class DeviceCredentialError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in _FALSEY


def _safe_text(value: Any, maximum: int) -> str:
    return str(value or "").strip()[:maximum]


def _load_or_create_secret(path: Path) -> bytes:
    with contextlib.suppress(FileNotFoundError):
        raw = path.read_text(encoding="utf-8").strip()
        if raw:
            secret = bytes.fromhex(raw)
            if len(secret) < 32:
                raise ValueError("device credential secret is too short")
            return secret
    secret = secrets.token_bytes(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_bytes(path, secret.hex().encode("ascii"), keep_backup=False, mode=0o600)
    return secret


class DeviceCredentialStore:
    """Persistent per-device credential registry (digests only)."""

    def __init__(
        self,
        path: str | Path,
        *,
        secret: bytes | str | None = None,
        secret_path: str | Path | None = None,
        invite_ttl_seconds: int = INVITE_TTL_SECONDS,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._path = Path(path)
        if secret is None:
            secret = _load_or_create_secret(
                Path(secret_path)
                if secret_path is not None
                else self._path.with_name(DEVICE_CREDENTIALS_SECRET_FILENAME)
            )
        if isinstance(secret, str):
            secret = secret.encode("utf-8")
        if len(secret) < 16:
            raise ValueError("device credential secret must be at least 16 bytes")
        self._key = hmac.new(
            secret, b"echo-ai/tentacle/device-credential/v1", hashlib.sha256
        ).digest()
        if not 1 <= int(invite_ttl_seconds) <= 24 * 3600:
            raise ValueError("invite TTL must be between 1 second and 24 hours")
        self._ttl = int(invite_ttl_seconds)
        self._clock = clock
        self._lock = threading.RLock()
        self._devices: dict[str, dict[str, Any]] = {}
        self._invites: dict[str, dict[str, Any]] = {}
        self._read()

    @classmethod
    def from_data_dir(
        cls, data_dir: str | Path | None = None, **kwargs: Any
    ) -> DeviceCredentialStore:
        if data_dir is None:
            from runtime.platform.process.paths import app_paths

            data_dir = app_paths().data_dir
        return cls(Path(data_dir) / DEVICE_CREDENTIALS_FILENAME, **kwargs)

    # ── persistence ─────────────────────────────────────────

    def _read(self) -> None:
        if not self._path.exists():
            return
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid tentacle device credential store") from exc
        if not isinstance(payload, dict) or payload.get("schema") != DEVICE_CREDENTIALS_SCHEMA:
            raise ValueError("invalid tentacle device credential store schema")
        for raw in payload.get("devices") or []:
            if (
                not isinstance(raw, dict)
                or not isinstance(raw.get("id"), str)
                or _DEVICE_ID.fullmatch(raw["id"]) is None
                or not isinstance(raw.get("credentialDigest"), str)
                or _DIGEST.fullmatch(raw["credentialDigest"]) is None
            ):
                raise ValueError("invalid tentacle device credential record")
            self._devices[raw["id"]] = {
                "id": raw["id"],
                "credentialDigest": raw["credentialDigest"],
                "label": _safe_text(raw.get("label"), 64),
                "pairedAt": max(0, int(raw.get("pairedAt") or 0)),
                "rotatedAt": max(0, int(raw.get("rotatedAt") or 0)),
                "lastSeenAt": max(0, int(raw.get("lastSeenAt") or 0)),
                "platform": _safe_text(raw.get("platform"), 32),
                "model": _safe_text(raw.get("model"), 96),
            }
        for raw in payload.get("invites") or []:
            if (
                isinstance(raw, dict)
                and isinstance(raw.get("digest"), str)
                and _DIGEST.fullmatch(raw["digest"])
                and isinstance(raw.get("expiresAt"), int | float)
            ):
                device_id = raw.get("deviceId")
                self._invites[raw["digest"]] = {
                    "expiresAt": float(raw["expiresAt"]),
                    "deviceId": device_id if isinstance(device_id, str) else None,
                    "label": _safe_text(raw.get("label"), 64),
                }
        self._prune_locked(self._clock())

    def _write_locked(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # No .bak: a backup could resurrect a revoked credential digest.
        atomic_write_json(
            self._path,
            {
                "schema": DEVICE_CREDENTIALS_SCHEMA,
                "devices": list(self._devices.values()),
                "invites": [
                    {"digest": digest, **invite} for digest, invite in self._invites.items()
                ],
            },
            keep_backup=False,
            mode=0o600,
        )

    def _digest(self, token: str) -> str:
        return hmac.new(self._key, token.encode("utf-8"), hashlib.sha256).hexdigest()

    def _prune_locked(self, now: float) -> bool:
        before = len(self._invites)
        self._invites = {d: i for d, i in self._invites.items() if i["expiresAt"] > now}
        return len(self._invites) != before

    # ── operations ──────────────────────────────────────────

    def create_invite(self, *, label: str = "", device_id: str | None = None) -> dict[str, Any]:
        """Mint a one-time pairing token. Optionally pre-bind it to ``device_id``."""
        if device_id is not None and _DEVICE_ID.fullmatch(device_id) is None:
            raise DeviceCredentialError(422, "invalid device id")
        token = secrets.token_urlsafe(32)
        now = self._clock()
        with self._lock:
            self._prune_locked(now)
            if len(self._invites) >= MAX_PENDING_INVITES:
                raise DeviceCredentialError(429, "too many pending device invitations")
            if len(self._devices) >= MAX_DEVICES:
                raise DeviceCredentialError(409, "device credential limit reached")
            expires_at = now + self._ttl
            self._invites[self._digest(token)] = {
                "expiresAt": expires_at,
                "deviceId": device_id,
                "label": _safe_text(label, 64),
            }
            self._write_locked()
        return {"token": token, "expiresAt": int(expires_at), "deviceId": device_id}

    def verify(self, device_id: str, token: str) -> bool:
        """Check an already-bound credential (never redeems an invitation)."""
        if not self._well_formed(device_id, token):
            return False
        digest = self._digest(token)
        with self._lock:
            record = self._devices.get(device_id)
            return record is not None and hmac.compare_digest(record["credentialDigest"], digest)

    def authenticate(self, device_id: str, token: str, meta: dict[str, Any] | None = None) -> bool:
        """Verify a bound device, or redeem a pending invite and bind it to ``device_id``."""
        if not self._well_formed(device_id, token):
            return False
        digest = self._digest(token)
        now = self._clock()
        meta = meta or {}
        with self._lock:
            record = self._devices.get(device_id)
            if record is not None:
                if not hmac.compare_digest(record["credentialDigest"], digest):
                    return False
                self._touch_locked(record, meta, now)
                return True
            self._prune_locked(now)
            invite = self._invites.get(digest)
            if invite is None or invite["expiresAt"] <= now:
                return False
            if invite["deviceId"] is not None and invite["deviceId"] != device_id:
                return False
            if len(self._devices) >= MAX_DEVICES:
                return False
            del self._invites[digest]
            record = {
                "id": device_id,
                "credentialDigest": digest,
                "label": invite["label"],
                "pairedAt": int(now),
                "rotatedAt": 0,
                "lastSeenAt": int(now),
                "platform": "",
                "model": "",
            }
            self._devices[device_id] = record
            self._touch_locked(record, meta, now, force=True)
            return True

    def _touch_locked(
        self, record: dict[str, Any], meta: dict[str, Any], now: float, *, force: bool = False
    ) -> None:
        platform = _safe_text(meta.get("platform"), 32) or record["platform"]
        model = _safe_text(meta.get("model"), 96) or record["model"]
        changed = platform != record["platform"] or model != record["model"]
        record["platform"], record["model"] = platform, model
        if force or changed or now - record["lastSeenAt"] >= 60:
            record["lastSeenAt"] = int(now)
            self._write_locked()

    @staticmethod
    def _well_formed(device_id: Any, token: Any) -> bool:
        return (
            isinstance(device_id, str)
            and _DEVICE_ID.fullmatch(device_id) is not None
            and isinstance(token, str)
            and 16 <= len(token) <= 512
        )

    def list_devices(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {key: value for key, value in record.items() if key != "credentialDigest"}
                for record in sorted(self._devices.values(), key=lambda item: item["id"])
            ]

    def pending_invites(self) -> int:
        with self._lock:
            self._prune_locked(self._clock())
            return len(self._invites)

    def is_paired(self, device_id: str) -> bool:
        with self._lock:
            return device_id in self._devices

    def revoke(self, device_id: str) -> bool:
        with self._lock:
            removed = self._devices.pop(device_id, None) is not None
            # Also drop invites pre-bound to this id so revoke is final.
            stale = [d for d, i in self._invites.items() if i["deviceId"] == device_id]
            for digest in stale:
                del self._invites[digest]
            if removed or stale:
                self._write_locked()
            return removed

    def rotate(self, device_id: str) -> dict[str, Any]:
        """Replace a bound device's credential; the old token stops working immediately."""
        token = secrets.token_urlsafe(32)
        now = self._clock()
        with self._lock:
            record = self._devices.get(device_id)
            if record is None:
                raise DeviceCredentialError(404, "paired device not found")
            record["credentialDigest"] = self._digest(token)
            record["rotatedAt"] = int(now)
            self._write_locked()
        return {"token": token, "deviceId": device_id}

    def pairing_generation(self, device_id: str) -> str | None:
        """Opaque id of the device's current credential; changes on re-pair/rotate."""
        with self._lock:
            record = self._devices.get(device_id)
            if record is None:
                return None
            return hashlib.sha256(
                b"echo-ai/tentacle/pairing/v1:" + record["credentialDigest"].encode("ascii")
            ).hexdigest()[:32]


def join_link(ws_url: str, token: str) -> str:
    return f"echo://join?ws={quote(ws_url, safe='')}&token={quote(token, safe='')}"


def device_ws_url(server: Any) -> str:
    """WS URL a device should dial: ``ECHO_TENTACLE_PUBLIC_WS_URL`` or ``ws://<LAN IP>:<port>``."""
    configured = (os.environ.get("ECHO_TENTACLE_PUBLIC_WS_URL") or "").strip()
    if configured:
        return configured
    from runtime.platform.lan import lan_ip as _lan_ip

    return f"ws://{_lan_ip()}:{getattr(server, 'port', 8765)}"


class PerDeviceAuth:
    """Install per-device validation on a ``TentacleWebSocketServer`` instance.

    The pinned transport (``ws_server.py``) is not modified: like echo-os we
    replace the instance's ``_check_auth`` hook and set ``is_per_device_auth``.
    ``_handle_hello`` / ``_handle_peer_call`` are wrapped so each live socket
    remembers whether it authenticated per-device or with the shared token,
    and only per-device sockets may issue ``device/call``.
    """

    def __init__(
        self,
        server: Any,
        store: DeviceCredentialStore,
        *,
        allow_shared_token: bool = True,
    ) -> None:
        if not hasattr(server, "_check_auth") or not hasattr(server, "_handle_peer_call"):
            raise TypeError("incompatible tentacle transport")
        self.server = server
        self.store = store
        self.shared_token: str | None = server.auth_token if allow_shared_token else None
        self._revocation_listeners: list[Callable[[str], None]] = []
        # tentacle_id → (socket, "per-device" | "shared")
        self._modes: dict[str, tuple[Any, str]] = {}
        self._orig_handle_hello = server._handle_hello
        self._orig_peer_call = server._handle_peer_call
        if not server.auth_token:
            # Keep the transport in authenticated mode (no loopback pre-auth);
            # an unpredictable fallback can never be presented by a client.
            server.auth_token = secrets.token_urlsafe(32)
        server._check_auth = self.check_auth
        server._handle_hello = self._handle_hello
        server._handle_peer_call = self._handle_peer_call
        server.is_per_device_auth = True
        server.device_credentials = self

    def check_auth(self, msg: dict[str, Any]) -> bool:
        params = msg.get("params")
        if not isinstance(params, dict):
            return False
        device_id = params.get("tentacle_id")
        token = params.get("auth_token") or params.get("token") or ""
        if self.store.authenticate(device_id, token, params):
            msg[_AUTH_MODE_KEY] = "per-device"
            return True
        if (
            self.shared_token
            and isinstance(token, str)
            and hmac.compare_digest(token, self.shared_token)
            # A paired id is owned by its credential; the shared token cannot claim it.
            and not (isinstance(device_id, str) and self.store.is_paired(device_id))
        ):
            msg[_AUTH_MODE_KEY] = "shared"
            return True
        return False

    async def _handle_hello(self, ws: Any, msg: dict[str, Any]) -> str | None:
        mode = msg.pop(_AUTH_MODE_KEY, None)
        tentacle_id = await self._orig_handle_hello(ws, msg)
        if tentacle_id is not None:
            self._modes[tentacle_id] = (ws, mode or "shared")
        return tentacle_id

    def auth_mode(self, tentacle_id: str, ws: Any) -> str | None:
        entry = self._modes.get(tentacle_id)
        return entry[1] if entry is not None and entry[0] is ws else None

    async def _handle_peer_call(self, ws: Any, msg: dict[str, Any], source: str) -> None:
        if self.auth_mode(source, ws) != "per-device" and (
            os.environ.get("ECHO_ALLOW_INSECURE_SHARED_TOKEN_PEER_CALLS") != "1"
        ):
            await self.server._send_error(
                ws,
                msg.get("id"),
                -32098,
                "Peer tool access requires per-device credentials; shared token pairing does not authorize peer control",
            )
            return
        await self._orig_peer_call(ws, msg, source)

    def add_revocation_listener(self, listener: Callable[[str], None]) -> None:
        self._revocation_listeners.append(listener)

    async def _disconnect(self, device_id: str, reason: str) -> bool:
        self._modes.pop(device_id, None)
        connection = self.server._connections.get(device_id)
        if connection is None:
            return False
        with contextlib.suppress(Exception):
            await connection.close(code=1008, reason=reason)
        return True

    async def revoke(self, device_id: str) -> dict[str, Any]:
        if _DEVICE_ID.fullmatch(device_id or "") is None:
            raise DeviceCredentialError(422, "invalid device id")
        if not self.store.revoke(device_id):
            raise DeviceCredentialError(404, "paired device not found")
        for listener in list(self._revocation_listeners):
            try:
                listener(device_id)
            except Exception:  # noqa: BLE001 — a listener must not block revocation
                logger.warning("device revocation listener failed", exc_info=True)
        disconnected = await self._disconnect(device_id, "device credential revoked")
        return {"deviceId": device_id, "revoked": True, "disconnected": disconnected}

    async def rotate(self, device_id: str) -> dict[str, Any]:
        if _DEVICE_ID.fullmatch(device_id or "") is None:
            raise DeviceCredentialError(422, "invalid device id")
        issued = self.store.rotate(device_id)
        issued["disconnected"] = await self._disconnect(device_id, "device credential rotated")
        return issued

    def status(self) -> dict[str, Any]:
        live = self.server._connections
        devices = []
        for record in self.store.list_devices():
            device_id = record["id"]
            ws = live.get(device_id)
            devices.append(
                {
                    **record,
                    "online": ws is not None,
                    "authMode": self.auth_mode(device_id, ws) if ws is not None else None,
                }
            )
        shared_online = sorted(
            device_id for device_id, ws in live.items() if self.auth_mode(device_id, ws) == "shared"
        )
        return {
            "schema": DEVICE_CREDENTIALS_SCHEMA,
            "perDeviceAuth": True,
            "sharedTokenAccepted": self.shared_token is not None,
            "pendingInvites": self.store.pending_invites(),
            "devices": devices,
            "sharedTokenDevicesOnline": shared_online,
        }


def install_per_device_auth(
    server: Any,
    store: DeviceCredentialStore | None = None,
    *,
    allow_shared_token: bool | None = None,
) -> PerDeviceAuth:
    if store is None:
        store = DeviceCredentialStore.from_data_dir()
    if allow_shared_token is None:
        allow_shared_token = env_flag(ALLOW_SHARED_TOKEN_ENV, True)
    return PerDeviceAuth(server, store, allow_shared_token=allow_shared_token)


def create_device_credentials_router(
    auth: PerDeviceAuth,
    *,
    ws_url_resolver: Callable[[Any], str],
    dependencies: list[Any] | None = None,
) -> Any:
    """Operator API under ``/api/tentacle/credentials`` (mounted by dashboard.py)."""
    from fastapi import APIRouter, HTTPException

    router = APIRouter(prefix="/credentials", dependencies=dependencies or [])

    @router.get("/devices")
    def list_devices() -> dict[str, Any]:
        return auth.status()

    @router.post("/invites")
    def create_invite(
        request: FastAPIRequest, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        body = body or {}
        device_id = body.get("device_id")
        if device_id is not None and not isinstance(device_id, str):
            raise HTTPException(422, "device_id must be a string")
        try:
            issued = auth.store.create_invite(
                label=str(body.get("label") or ""), device_id=device_id
            )
        except DeviceCredentialError as exc:
            raise HTTPException(exc.status_code, exc.detail) from exc
        ws_url = ws_url_resolver(request)
        return {
            "schema": "echo.tentacle.device-invite.v1",
            "wsUrl": ws_url,
            "connectString": join_link(ws_url, issued["token"]),
            "expiresAt": issued["expiresAt"],
            "deviceId": issued["deviceId"],
            "credentialMode": "per-device",
        }

    @router.delete("/devices/{device_id}")
    async def revoke_device(device_id: str) -> dict[str, Any]:
        try:
            return await auth.revoke(device_id)
        except DeviceCredentialError as exc:
            raise HTTPException(exc.status_code, exc.detail) from exc

    @router.post("/devices/{device_id}/rotate")
    async def rotate_device(request: FastAPIRequest, device_id: str) -> dict[str, Any]:
        try:
            issued = await auth.rotate(device_id)
        except DeviceCredentialError as exc:
            raise HTTPException(exc.status_code, exc.detail) from exc
        ws_url = ws_url_resolver(request)
        return {
            "schema": "echo.tentacle.device-invite.v1",
            "wsUrl": ws_url,
            "connectString": join_link(ws_url, issued["token"]),
            "deviceId": device_id,
            "disconnected": issued["disconnected"],
            "credentialMode": "per-device",
        }

    return router
