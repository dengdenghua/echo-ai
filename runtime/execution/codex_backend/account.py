"""Principal-scoped Codex account control plane.

Managed ChatGPT login is a multi-request protocol: App Server must remain
alive while the user completes a browser/device ceremony.  The service keeps a
small bounded pool of principal-isolated control processes, fences login ids,
reaps idle sessions, and closes every child on application shutdown.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import stat
import threading
import time
import weakref
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
from typing import Any

from runtime.safety.auth.scope import TenantScope

from ._account_auth import (
    _control_config,
    _has_fresh_chatgpt_access_token,
    _quarantine_unusable_auth,
    _seed_legacy_auth,
    _valid_auth_file,
)
from ._account_catalog import CodexAccountCatalogMixin
from ._account_wire import (
    _apply_account_notification,
    _is_unusable_account_error,
    _normalize_login_response,
)
from ._security_support import (
    _atomic_write_private,
    _ensure_private_directory,
    _prepare_state_root,
)
from .client import CodexAppServerClient
from .command import resolve_codex_app_server_command
from .types import (
    CodexAppServerConfig,
    ConfigurationError,
    ProcessFactory,
    ProtocolError,
    RemoteError,
    RequestTimeoutError,
    TransportClosedError,
)

_LOG = logging.getLogger(__name__)


class CodexAccountConflict(RuntimeError):
    """An account mutation conflicts with a newer login generation."""


class CodexAccountCapacityError(RuntimeError):
    """Every bounded control slot currently owns an active login."""


class CodexAccountLeaseError(RuntimeError):
    """Another server worker owns this principal's control process."""


_CONTROL_LEASES: set[str] = set()
_CONTROL_LEASES_LOCK = threading.Lock()
_ACCOUNT_SERVICES: weakref.WeakSet[CodexAccountService] = weakref.WeakSet()
_ACCOUNT_SERVICES_LOCK = threading.Lock()


@dataclass(slots=True)
class _ControlLease:
    key: str
    descriptor: int
    released: bool = False

    def release(self) -> None:
        if self.released:
            return
        self.released = True
        descriptor = self.descriptor
        self.descriptor = -1
        with contextlib.suppress(ImportError, OSError):
            if os.name == "nt":
                import msvcrt

                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)  # type: ignore[attr-defined]
            elif os.name == "posix":
                import fcntl

                fcntl.flock(descriptor, fcntl.LOCK_UN)
        with contextlib.suppress(OSError):
            os.close(descriptor)
        with _CONTROL_LEASES_LOCK:
            _CONTROL_LEASES.discard(self.key)


@dataclass(frozen=True, slots=True)
class CodexAccountStatus:
    account: dict[str, object] | None
    requires_openai_auth: bool
    login_pending: bool
    login_id: str | None = None
    login_error: str | None = None

    def to_wire(self) -> dict[str, object]:
        return {
            "account": self.account,
            "requires_openai_auth": self.requires_openai_auth,
            "login_pending": self.login_pending,
            "login_id": self.login_id,
            "login_error": self.login_error,
        }


@dataclass(slots=True)
class _ControlRuntime:
    client: CodexAppServerClient
    home: Path
    lease: _ControlLease
    loop: asyncio.AbstractEventLoop
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    active_login_id: str | None = None
    active_login_type: str | None = None
    login_started_at: float | None = None
    login_error: str | None = None
    model_catalog_cache: dict[bool, tuple[float, list[dict[str, object]]]] = field(
        default_factory=dict
    )
    plugin_catalog_cache: tuple[float, list[dict[str, object]]] | None = None
    last_used: float = field(default_factory=time.monotonic)
    closed: bool = False


ClientFactory = Callable[[CodexAppServerConfig], CodexAppServerClient]


class CodexAccountService(CodexAccountCatalogMixin):
    """Bounded persistent App Server sessions partitioned by principal."""

    def __init__(
        self,
        state_root: str | Path,
        *,
        command: tuple[str, ...] | None = None,
        client_factory: ClientFactory | None = None,
        process_factory: ProcessFactory | None = None,
        legacy_source_home: str | Path | None = None,
        allow_local_principal_inheritance: bool = False,
        max_sessions: int = 16,
        idle_timeout_s: float = 15 * 60,
        login_timeout_s: float = 20 * 60,
    ) -> None:
        root = Path(state_root).expanduser().resolve(strict=False)
        if not root.is_absolute():
            raise ConfigurationError("Codex account state root must be absolute")
        if command is not None and (
            not command or any(not part or "\x00" in part for part in command)
        ):
            raise ConfigurationError("Codex account command must be explicit and NUL-free")
        if max_sessions < 1 or max_sessions > 256:
            raise ConfigurationError("Codex account max_sessions must be from 1 to 256")
        if idle_timeout_s <= 0:
            raise ConfigurationError("Codex account idle timeout must be positive")
        if login_timeout_s <= 0:
            raise ConfigurationError("Codex account login timeout must be positive")
        if root.parent == root:
            raise ConfigurationError("filesystem root cannot be Codex account state_root")
        # Create the tree lazily on the first account operation. Merely
        # mounting the config router must not mutate an otherwise unused data
        # directory (and keeps read-only API/schema tests side-effect free).
        self._state_root = root
        self._command = command
        self._client_factory = client_factory
        self._process_factory = process_factory
        self._legacy_source_home = (
            Path(legacy_source_home).expanduser().resolve(strict=False)
            if legacy_source_home is not None
            else None
        )
        # Local desktop may still have an authenticated Echo principal even
        # though one OS user owns the whole installation.  Opting in lets that
        # principal reuse the machine owner's ChatGPT login without copying it
        # to the renderer.  Shared/server construction never enables this.
        self._allow_local_principal_inheritance = bool(allow_local_principal_inheritance)
        self._max_sessions = max_sessions
        self._idle_timeout_s = idle_timeout_s
        self._login_timeout_s = login_timeout_s
        self._runtimes: dict[str, _ControlRuntime] = {}
        self._pool_lock = asyncio.Lock()
        self._reaper_task: asyncio.Task[None] | None = None
        self._closed = False
        with _ACCOUNT_SERVICES_LOCK:
            _ACCOUNT_SERVICES.add(self)

    @property
    def state_root(self) -> Path:
        return self._state_root

    def account_home(self, scope: TenantScope | None) -> Path:
        """Return the opaque tenant/principal partition used by control + turns."""

        return codex_account_home(self._state_root, scope)

    def resolve_execution_auth_home(self, scope: TenantScope | None) -> Path | None:
        """Prefer scoped auth; optionally inherit host auth on local desktop."""

        scoped_home = self.account_home(scope)
        if _valid_auth_file(scoped_home / "auth.json", required=False):
            return scoped_home
        # Shared principals never inherit the OS user's ambient Codex account.
        # Local desktop can opt in because the OS user is the installation's
        # trust boundary even when the UI itself has an authenticated actor.
        if self._may_inherit_local_auth(scope) and _valid_auth_file(
            self._legacy_source_home / "auth.json", required=False
        ):
            return self._legacy_source_home
        return None

    def _may_inherit_local_auth(self, scope: TenantScope | None) -> bool:
        return self._legacy_source_home is not None and (
            scope is None or self._allow_local_principal_inheritance
        )

    def cached_models(
        self,
        scope: TenantScope | None,
        *,
        include_hidden: bool = False,
    ) -> list[dict[str, object]] | None:
        """Return the already-loaded catalog without starting or waiting on App Server."""

        runtime = self._runtimes.get(self._scope_key(scope))
        if runtime is None:
            return None
        cached = runtime.model_catalog_cache.get(include_hidden)
        if cached is None:
            return None
        return [dict(model) for model in cached[1]]

    async def run_on_runtime_loop(
        self,
        scope: TenantScope | None,
        operation: Callable[[], Any],
    ) -> Any:
        """Run a control operation on the loop that owns its App Server client.

        Native model credential refresh can initialize a principal runtime from
        a worker thread.  Later HTTP requests arrive on the ASGI loop; directly
        awaiting the existing client's queues there raises ``bound to a
        different event loop`` and makes a valid login look disconnected.
        """

        runtime = self._runtimes.get(self._scope_key(scope))
        current_loop = asyncio.get_running_loop()
        if runtime is None or runtime.loop is current_loop:
            return await operation()
        if not runtime.loop.is_running():
            raise TransportClosedError("Codex account control loop is unavailable")
        future = asyncio.run_coroutine_threadsafe(operation(), runtime.loop)
        return await asyncio.wrap_future(future)

    async def read_account(
        self,
        scope: TenantScope | None,
        *,
        refresh_token: bool = False,
    ) -> CodexAccountStatus:
        runtime = await self._runtime(scope)
        try:
            return await self._read_account_locked(runtime, refresh_token=refresh_token)
        except RemoteError as exc:
            if not _is_unusable_account_error(exc):
                raise
            # The stored ChatGPT credential was revoked server-side.  App
            # Server resolves workspace routing inside ``account/read``, so a
            # dead file makes the whole call fail with an opaque internal
            # error instead of reporting "not connected".  Reporting that as a
            # 503 hid the authorization controls, so retire the dead file and
            # re-read through a fresh child.
            quarantine = _quarantine_unusable_auth(runtime.home)
            if quarantine is None:
                raise
            _LOG.warning(
                "Codex account credential was rejected by the provider; quarantined %s",
                quarantine.name,
            )
            # Never interrupt an authorization ceremony that is already in
            # flight: the panel only needs ``login_pending`` back, and the
            # freshly written credential arrives on the next read.
            if runtime.active_login_id is None:
                runtime = await self._recycle_runtime(scope, runtime)
                try:
                    return await self._read_account_locked(runtime, refresh_token=refresh_token)
                except RemoteError as retry_exc:
                    if not _is_unusable_account_error(retry_exc):
                        raise
            # The rejected credential is gone, so "no account" is the only
            # truthful state left.  Return it instead of a 503 so the user can
            # always reach the authorization flow again.
            return _account_status_without_account(runtime)

    async def _read_account_locked(
        self,
        runtime: _ControlRuntime,
        *,
        refresh_token: bool,
    ) -> CodexAccountStatus:
        async with runtime.lock:
            await self._drain_notifications(runtime)
            response = await runtime.client.account_read(refresh_token=refresh_token)
            runtime.last_used = time.monotonic()
            status = _normalize_account_response(response, runtime)
            if status.account is not None:
                runtime.active_login_id = None
                runtime.active_login_type = None
                runtime.login_started_at = None
                runtime.login_error = None
                status = _normalize_account_response(response, runtime)
            return status

    async def refresh_for_execution(self, scope: TenantScope | None) -> Path | None:
        """Check master credentials and refresh when needed under the control lease.

        Execution homes receive a copy of ``auth.json``. Rotating its refresh
        token on every turn can invalidate another desktop client's copy.
        Keep a live access token; refresh near expiry or for unknown formats.
        """

        runtime = await self._runtime(scope)
        async with runtime.lock:
            await self._drain_notifications(runtime)
            managed = self.account_home(scope)
            response = await runtime.client.account_read(
                refresh_token=not _has_fresh_chatgpt_access_token(managed / "auth.json")
            )
            status = _normalize_account_response(response, runtime)
            runtime.last_used = time.monotonic()
            if status.account is None:
                return None
            return managed if _valid_auth_file(managed / "auth.json", required=False) else None

    async def refresh_for_execution_any_loop(
        self,
        scope: TenantScope | None,
    ) -> Path | None:
        """Route refresh to the event loop that owns the persistent client."""

        runtime = self._runtimes.get(self._scope_key(scope))
        current_loop = asyncio.get_running_loop()
        if runtime is None or runtime.loop is current_loop:
            return await self.refresh_for_execution(scope)
        if not runtime.loop.is_running():
            raise TransportClosedError("Codex account control loop is unavailable")
        future = asyncio.run_coroutine_threadsafe(
            self.refresh_for_execution(scope),
            runtime.loop,
        )
        return await asyncio.wrap_future(future)

    async def login(
        self,
        scope: TenantScope | None,
        *,
        login_type: str,
        api_key: str | None = None,
    ) -> dict[str, object]:
        runtime = await self._runtime(scope)
        async with runtime.lock:
            await self._drain_notifications(runtime)
            runtime.model_catalog_cache.clear()
            if runtime.active_login_id is not None:
                raise CodexAccountConflict("a Codex login is already pending for this account")
            runtime.login_error = None
            if login_type == "apiKey":
                if api_key is None:
                    raise ConfigurationError("api_key is required for API key login")
                response = await runtime.client.login_api_key(api_key)
            elif login_type == "chatgpt":
                response = await runtime.client.login_chatgpt(device_code=False)
            elif login_type == "chatgptDeviceCode":
                response = await runtime.client.login_chatgpt(device_code=True)
            else:
                raise ConfigurationError("unsupported Codex login type")
            safe = _normalize_login_response(response)
            login_id = safe.get("login_id")
            if isinstance(login_id, str):
                runtime.active_login_id = login_id
                runtime.active_login_type = login_type
                runtime.login_started_at = time.monotonic()
            runtime.last_used = time.monotonic()
            return safe

    async def cancel_login(
        self,
        scope: TenantScope | None,
        *,
        login_id: str,
    ) -> dict[str, object]:
        runtime = await self._runtime(scope)
        async with runtime.lock:
            await self._drain_notifications(runtime)
            if runtime.active_login_id != login_id:
                return {
                    "cancelled": False,
                    "login_id": login_id,
                    "reason": "stale_or_unknown_login",
                }
            await runtime.client.cancel_login(login_id)
            runtime.active_login_id = None
            runtime.active_login_type = None
            runtime.login_started_at = None
            runtime.login_error = None
            runtime.last_used = time.monotonic()
            return {"cancelled": True, "login_id": login_id, "reason": None}

    async def logout(self, scope: TenantScope | None) -> dict[str, object]:
        runtime = await self._runtime(scope)
        async with runtime.lock:
            await self._drain_notifications(runtime)
            if runtime.active_login_id is not None:
                await runtime.client.cancel_login(runtime.active_login_id)
            await runtime.client.logout_account()
            runtime.model_catalog_cache.clear()
            runtime.active_login_id = None
            runtime.active_login_type = None
            runtime.login_started_at = None
            runtime.login_error = None
            runtime.last_used = time.monotonic()
            return {"logged_out": True}

    async def close_all(self) -> None:
        """Reap every control child; safe and idempotent at app shutdown."""

        reaper = self._reaper_task
        self._reaper_task = None
        if reaper is not None and reaper is not asyncio.current_task():
            reaper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reaper
        async with self._pool_lock:
            self._closed = True
            runtimes = list(self._runtimes.values())
            self._runtimes.clear()
        await asyncio.gather(
            *(self._close_runtime(runtime) for runtime in runtimes),
            return_exceptions=True,
        )

    def start_idle_reaper(self) -> None:
        """Start one bounded background reaper in the active app loop."""

        if self._closed or (self._reaper_task is not None and not self._reaper_task.done()):
            return
        self._reaper_task = asyncio.create_task(
            self._idle_reaper_loop(),
            name="codex-account-control-reaper",
        )

    async def reap_idle(self) -> int:
        """Close non-login sessions idle beyond the configured bound."""

        now = time.monotonic()
        async with self._pool_lock:
            stale_keys = []
            for key, runtime in self._runtimes.items():
                idle_expired = (
                    runtime.active_login_id is None
                    and now - runtime.last_used >= self._idle_timeout_s
                )
                login_expired = (
                    runtime.active_login_id is not None
                    and runtime.login_started_at is not None
                    and now - runtime.login_started_at >= self._login_timeout_s
                )
                if not runtime.lock.locked() and (idle_expired or login_expired):
                    stale_keys.append(key)
            stale = [self._runtimes.pop(key) for key in stale_keys]
        await asyncio.gather(
            *(self._close_runtime(runtime) for runtime in stale),
            return_exceptions=True,
        )
        return len(stale)

    async def _runtime(self, scope: TenantScope | None) -> _ControlRuntime:
        if self._closed:
            raise TransportClosedError("Codex account service is closed")
        await self.reap_idle()
        key = self._scope_key(scope)
        async with self._pool_lock:
            existing = self._runtimes.get(key)
            if existing is not None and not existing.closed:
                existing.last_used = time.monotonic()
                return existing
            if len(self._runtimes) >= self._max_sessions:
                raise CodexAccountCapacityError(
                    "all Codex account control sessions are occupied by active logins"
                )
            runtime = await self._start_runtime(scope)
            self._runtimes[key] = runtime
            return runtime

    async def _start_runtime(self, scope: TenantScope | None) -> _ControlRuntime:
        self._state_root = _prepare_state_root(self._state_root)
        command = self._command or resolve_codex_app_server_command()
        home = self.account_home(scope)
        app_home = home.parent / "app-home"
        temporary = home.parent / "tmp"
        for directory in (home, app_home, temporary):
            _ensure_private_directory(directory, root=self._state_root)
        lease = _acquire_control_lease(home.parent / ".control-runtime.lock")
        try:
            if self._may_inherit_local_auth(scope):
                _seed_legacy_auth(home, self._legacy_source_home)
            _atomic_write_private(home / "config.toml", _control_config().encode("utf-8"))
            environment = {
                "CODEX_HOME": str(home),
                "HOME": str(app_home),
                "USERPROFILE": str(app_home),
                "TMPDIR": str(temporary),
                "TMP": str(temporary),
                "TEMP": str(temporary),
                "PATH": os.environ.get("PATH") or os.defpath,
            }
            if os.name == "nt":
                # Node's Windows native runtime expects the standard system
                # root variables even when the rest of the host environment
                # is intentionally isolated from the Codex control process.
                for name in ("SYSTEMROOT", "COMSPEC", "PATHEXT", "WINDIR"):
                    value = os.environ.get(name)
                    if value:
                        environment[name] = value
            config = CodexAppServerConfig(
                command=command,
                cwd=str(home.parent),
                env_allowlist=frozenset(environment),
                env_overrides=environment,
                source_environment={},
                experimental_api=False,
                notification_queue_size=64,
                approval_queue_size=1,
            )
            if self._client_factory is not None:
                client = self._client_factory(config)
            else:
                client = CodexAppServerClient(config, process_factory=self._process_factory)
            await client.start()
            return _ControlRuntime(
                client=client,
                home=home,
                lease=lease,
                loop=asyncio.get_running_loop(),
            )
        except BaseException:
            lease.release()
            raise

    async def _drain_notifications(self, runtime: _ControlRuntime) -> None:
        for _ in range(64):
            try:
                notification = await runtime.client.next_notification(timeout_s=0.001)
            except RequestTimeoutError:
                return
            _apply_account_notification(runtime, notification)
        raise ProtocolError("Codex account notification queue did not quiesce")

    async def _recycle_runtime(
        self,
        scope: TenantScope | None,
        runtime: _ControlRuntime,
    ) -> _ControlRuntime:
        """Replace one control child so the principal gets a clean process."""

        key = self._scope_key(scope)
        async with self._pool_lock:
            if self._runtimes.get(key) is runtime:
                self._runtimes.pop(key, None)
        await self._close_runtime(runtime)
        return await self._runtime(scope)

    async def _close_runtime(self, runtime: _ControlRuntime) -> None:
        if runtime.closed:
            return
        runtime.closed = True
        if runtime.active_login_id is not None:
            with contextlib.suppress(Exception):
                await runtime.client.cancel_login(runtime.active_login_id)
        try:
            await runtime.client.close()
        finally:
            runtime.lease.release()

    async def _idle_reaper_loop(self) -> None:
        interval = min(60.0, max(1.0, min(self._idle_timeout_s, self._login_timeout_s) / 2))
        try:
            while not self._closed:
                await asyncio.sleep(interval)
                await self.reap_idle()
        except asyncio.CancelledError:
            raise
        except Exception:
            # A later API access also performs a synchronous reap. Keep an
            # unexpected housekeeping failure from taking down the app loop.
            return

    @staticmethod
    def _scope_key(scope: TenantScope | None) -> str:
        return codex_account_scope_key(scope)


def _normalize_account_response(
    response: Mapping[str, Any],
    runtime: _ControlRuntime,
) -> CodexAccountStatus:
    raw_account = response.get("account")
    account: dict[str, object] | None = None
    if raw_account is not None:
        if not isinstance(raw_account, Mapping):
            raise ProtocolError("account/read account must be an object or null")
        account_type = raw_account.get("type")
        if account_type not in {"apiKey", "chatgpt", "amazonBedrock"}:
            raise ProtocolError("account/read returned an unsupported account type")
        account = {
            "type": account_type,
            "email": raw_account.get("email")
            if isinstance(raw_account.get("email"), str)
            else None,
            "plan_type": (
                raw_account.get("planType")
                if isinstance(raw_account.get("planType"), str)
                else None
            ),
        }
    requires_auth = response.get("requiresOpenaiAuth")
    if not isinstance(requires_auth, bool):
        raise ProtocolError("account/read requiresOpenaiAuth must be boolean")
    return CodexAccountStatus(
        account=account,
        requires_openai_auth=requires_auth,
        login_pending=runtime.active_login_id is not None,
        login_id=runtime.active_login_id,
        login_error=runtime.login_error,
    )


def _account_status_without_account(runtime: _ControlRuntime) -> CodexAccountStatus:
    """Report the principal as unauthenticated while keeping login state."""

    return CodexAccountStatus(
        account=None,
        requires_openai_auth=True,
        login_pending=runtime.active_login_id is not None,
        login_id=runtime.active_login_id,
        login_error=runtime.login_error,
    )


def codex_account_scope_key(scope: TenantScope | None) -> str:
    """Return the opaque stable partition shared by control and execution."""

    if scope is None:
        return "local"
    material = f"{scope.tenant_id}\x00{scope.actor_id}".encode()
    return sha256(material).hexdigest()[:40]


def _acquire_control_lease(path: Path) -> _ControlLease:
    key = os.path.normcase(str(path.resolve(strict=False)))
    with _CONTROL_LEASES_LOCK:
        if key in _CONTROL_LEASES:
            raise CodexAccountLeaseError("Codex account is controlled by another worker")
        _CONTROL_LEASES.add(key)
    descriptor = -1
    try:
        flags = os.O_CREAT | os.O_RDWR
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags, 0o600)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise CodexAccountLeaseError("Codex account control lease is invalid")
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        if os.name == "nt":
            import msvcrt

            if metadata.st_size == 0:
                os.write(descriptor, b"\0")
                os.fsync(descriptor)
            os.lseek(descriptor, 0, os.SEEK_SET)
            msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)  # type: ignore[attr-defined]
        elif os.name == "posix":
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            raise CodexAccountLeaseError("platform has no safe Codex account lease")
        return _ControlLease(key=key, descriptor=descriptor)
    except (BlockingIOError, ImportError, OSError) as exc:
        if descriptor >= 0:
            with contextlib.suppress(OSError):
                os.close(descriptor)
        with _CONTROL_LEASES_LOCK:
            _CONTROL_LEASES.discard(key)
        raise CodexAccountLeaseError("Codex account is controlled by another worker") from exc
    except BaseException:
        if descriptor >= 0:
            with contextlib.suppress(OSError):
                os.close(descriptor)
        with _CONTROL_LEASES_LOCK:
            _CONTROL_LEASES.discard(key)
        raise


def codex_account_home(state_root: str | Path, scope: TenantScope | None) -> Path:
    """Resolve a principal's managed Codex home without creating it."""

    root = Path(state_root).expanduser().resolve(strict=False)
    if not root.is_absolute() or root.parent == root:
        raise ConfigurationError("Codex account state root must be a safe absolute path")
    return root / "accounts" / codex_account_scope_key(scope) / "codex-home"


def resolve_codex_execution_auth_home(
    *,
    state_root: str | Path,
    scope: TenantScope | None,
    deployment_mode: str,
    legacy_source_home: str | Path | None = None,
    allow_local_principal_inheritance: bool = False,
) -> Path | None:
    """Select the only auth source an execution sidecar may inherit.

    A principal-scoped managed login always wins. The OS user's legacy
    ``~/.codex`` is eligible for unauthenticated local mode and, when the
    caller explicitly opts in, authenticated principals in the single-user
    desktop trust boundary. Shared/server deployments never inherit it.
    """

    managed = codex_account_home(state_root, scope)
    if _valid_auth_file(managed / "auth.json", required=False):
        return managed
    normalized_mode = str(deployment_mode or "local").strip().casefold()
    if (
        normalized_mode == "local"
        and legacy_source_home is not None
        and (scope is None or allow_local_principal_inheritance)
    ):
        legacy = Path(legacy_source_home).expanduser().resolve(strict=False)
        if _valid_auth_file(legacy / "auth.json", required=False):
            return legacy
    return None


async def refresh_codex_execution_auth_home(
    *,
    state_root: str | Path,
    scope: TenantScope | None,
) -> Path | None:
    """Refresh the managed master using its persistent control process.

    Services are process-local but the selected service holds a lifetime OS
    lease. In another backend worker, attempting a transient control process
    collides with that lease and fails closed instead of reading/writing the
    same principal home concurrently.
    """

    root = Path(state_root).expanduser().resolve(strict=False)
    scope_key = codex_account_scope_key(scope)
    with _ACCOUNT_SERVICES_LOCK:
        candidates = [
            service
            for service in _ACCOUNT_SERVICES
            if not service._closed and service.state_root == root
        ]
    candidates.sort(key=lambda service: scope_key in service._runtimes, reverse=True)
    lease_error: CodexAccountLeaseError | None = None
    for service in candidates:
        try:
            return await service.refresh_for_execution_any_loop(scope)
        except CodexAccountLeaseError as exc:
            lease_error = exc
    if lease_error is not None:
        raise lease_error
    transient = CodexAccountService(root, legacy_source_home=None)
    try:
        return await transient.refresh_for_execution_any_loop(scope)
    finally:
        await transient.close_all()


__all__ = [
    "CodexAccountCapacityError",
    "CodexAccountConflict",
    "CodexAccountLeaseError",
    "CodexAccountService",
    "CodexAccountStatus",
    "codex_account_home",
    "codex_account_scope_key",
    "resolve_codex_execution_auth_home",
    "refresh_codex_execution_auth_home",
]
