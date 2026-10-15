"""Managed, loopback-only OpenCode engine with Echo-owned host tools.

The official process owns inference and its tools. Echo owns the authenticated
principal, conversation, cancellation and permission ceiling. No provider
headers are emulated and no model API is exposed to other engines.
"""

from __future__ import annotations

import asyncio
import atexit
import contextlib
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import socket
import subprocess
import threading
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from runtime.execution.engine_packages.store import (
    engines_strict,
    installed_executable,
    missing_status,
)
from runtime.execution.host_mcp_connection import HostMCPConnection

# One turn against a running server; re-exported because callers and tests
# import these from here.
from runtime.execution.opencode_turn import (  # noqa: F401
    MessageEvents,
    OpenCodeError,
    _abort_and_settle,
    _has_status,
    _has_unexecuted_tool_markup,
    _tool_result_preview,
    native_model,
    public_model_error,
    reasoning_variants,
    refuse_pending_permissions,
    refuse_permission,
    stream_prompt,
)
from runtime.platform.capabilities.tenant_context import use_capability_scope
from runtime.platform.connectors.credential_store import CredentialStore
from runtime.platform.models.custom_model_selection import resolve_custom_model_selection
from runtime.platform.process.paths import app_paths
from runtime.safety.auth.scope import TenantScope

_logger = logging.getLogger(__name__)


# How long an unused engine process is kept for the next turn. An idle
# ``opencode serve`` held 420-496MB RSS on this host (probed 2026-09-25), so
# this window is a deliberate memory/latency trade rather than a free cache:
# a cold start costs ~5.8s to the first token, and 10 minutes covers an
# ordinary "read the answer, think, come back" gap without pinning the engine
# for a whole session. Measured: 9.4s cold vs 2.3s warm to first token.
_WARM_IDLE_SECONDS = 600.0

# Native tools the engine must never run. Injected as "ask" (see
# ``child_environment``) and refused on every ``permission.asked`` event, so the
# ceiling holds without a static deny the Zen free tier rejects. The network
# tools are here because Echo's approval gate never sees a native call: an
# allowed ``webfetch`` would reach a URL the user just refused through
# ``echo_fetch_url``. Network access goes through the ``echo_*`` host tools.
DENIED_NATIVE_TOOLS = ("bash", "edit", "write", "webfetch", "websearch", "codesearch")

NO_MODEL_MESSAGE = "OpenCode 还没有可用的模型：请连接 OpenCode Zen 或 Go，或选择你添加的模型。"


@dataclass
class _WarmServer:
    signature: str
    root: Path
    process: asyncio.subprocess.Process
    client: httpx.AsyncClient
    loop: asyncio.AbstractEventLoop
    in_use: bool = True
    idle_handle: asyncio.TimerHandle | None = None


_warm_servers: dict[str, _WarmServer] = {}
_MAX_WARM_SERVERS = 3
_warm_lock: asyncio.Lock | None = None
_warm_lock_loop: asyncio.AbstractEventLoop | None = None


def _terminate_warm_server_at_exit() -> None:
    for entry in tuple(_warm_servers.values()):
        if entry.process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                entry.process.terminate()


atexit.register(_terminate_warm_server_at_exit)


def executable() -> str | None:
    configured = os.environ.get("ECHO_OPENCODE_BIN")
    if configured:
        path = Path(configured).expanduser()
        return str(path.resolve()) if path.is_file() else None
    # The store-installed (pinned) engine; the desktop never looks further.
    if (installed := installed_executable("opencode")) or engines_strict():
        return installed
    # The local launcher records its pinned installation here. Discover only
    # this source tree's managed tool directory, never an arbitrary cwd's
    # runtime-paths file or a path outside the managed installation.
    state = Path(__file__).resolve().parents[2] / ".codex-run"
    try:
        manifest = json.loads((state / "runtime-paths.json").read_text(encoding="utf-8"))
        recorded = manifest.get("opencode") if isinstance(manifest, dict) else None
        if isinstance(recorded, str) and recorded.strip():
            candidate = Path(recorded).resolve()
            if (
                candidate.is_relative_to((state / "tools" / "opencode").resolve())
                and candidate.is_file()
                and (
                    candidate.suffix.lower() == ".exe"
                    if os.name == "nt"
                    else os.access(candidate, os.X_OK)
                )
            ):
                return str(candidate)
    except (OSError, ValueError):  # intentional: an invalid record falls through
        pass
    name = "opencode.exe" if os.name == "nt" else "opencode"
    bundled = Path(__file__).resolve().parents[2] / "extras/desktop/build/opencode" / name
    if bundled.is_file():
        return str(bundled)
    return shutil.which("opencode")


def zen_catalog() -> dict[str, Any]:
    try:
        value = json.loads(app_paths().custom_models_path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def resolve_zen_model(selection: str | None, catalog: dict[str, Any]) -> str:
    selected_go = resolve_custom_model_selection(catalog, selection or "")
    if (selection or "").startswith("official/") or (
        selected_go and selected_go.entry_id not in {"opencode-zen", "opencode-go"}
    ):
        return "echo-shared/" + str(selection)
    if (selected_go and selected_go.entry_id == "opencode-go") or (selection or "").startswith(
        "opencode-go/"
    ):
        entry = catalog.get("opencode-go", {})
        model = selected_go.model if selected_go else selection.removeprefix("opencode-go/")
        if entry.get("managed_by_plugin") not in {
            "opencode-go",
            "opencode-zen",
        } or model not in entry.get("models", []):
            raise OpenCodeError("请先连接 OpenCode Go，并选择套餐模型。")
        if selected_go and selected_go.context_profile != "default":
            raise OpenCodeError("OpenCode Go 请选择默认上下文模型。")
        return f"opencode-go/{model}"
    if selection == "auto":
        selection = None
    entry = catalog.get("opencode-zen")
    if entry is None:
        # There is no keyless default any more: Zen's free tier now refuses
        # every client but OpenCode's own app, the official CLI included
        # (checked 2026-10-15 with `opencode run -m opencode/big-pickle` from
        # an empty home: "OpenCode's free tier can only be used from within
        # OpenCode"). Without a Zen or Go connection the engine has no model.
        raise OpenCodeError(NO_MODEL_MESSAGE)
    if not isinstance(entry, dict) or entry.get("managed_by_plugin") != "opencode-zen":
        raise OpenCodeError("请先安装并连接 OpenCode Zen 模型插件。")
    selected = resolve_custom_model_selection(catalog, selection or "")
    if selected:
        if selected.entry_id != "opencode-zen" or selected.context_profile != "default":
            raise OpenCodeError("OpenCode 引擎请选择 Zen 插件中的默认上下文模型。")
        model = selected.model
    else:
        model = (selection or "big-pickle").removeprefix("opencode/")
    if model not in entry.get("models", []):
        raise OpenCodeError("OpenCode 引擎请选择已连接的 Zen 模型。")
    return model


def can_serve(selection: str | None) -> bool:
    """Whether OpenCode has a model for this selection without asking upstream."""
    try:
        resolve_zen_model(selection, zen_catalog())
    except OpenCodeError:
        return False
    return True


def zen_key(scope: TenantScope | None) -> str | None:
    with use_capability_scope(scope):
        key = CredentialStore().get_secret("opencode-zen", "api_key")
    return key or None


def model_selection_id(model: str) -> str:
    from runtime.platform.models.custom_model_selection import custom_model_selection_id

    provider, upstream = native_model(model)
    if provider == "echo-shared":
        return upstream
    return custom_model_selection_id(
        "opencode-go" if provider == "opencode-go" else "opencode-zen", upstream
    )


def model_key(scope: TenantScope | None, model: str) -> str | None:
    if native_model(model)[0] == "echo-shared":
        return None
    if native_model(model)[0] != "opencode-go":
        return zen_key(scope)
    with use_capability_scope(scope):
        key = CredentialStore().get_secret(
            "opencode-zen", "api_key"
        ) or CredentialStore().get_secret("opencode-go", "api_key")
    if not key:
        raise OpenCodeError("请先连接 OpenCode Go 套餐。")
    return key


def inspect_readiness(scope: TenantScope | None) -> dict[str, Any]:
    if os.environ.get("ECHO_DEPLOYMENT_MODE", "local").strip().lower() != "local":
        return {"available": False, "reason": "OpenCode 引擎目前仅支持本地运行。"}
    if not executable():
        return {"available": False, **missing_status("opencode")}
    try:
        # Model-agnostic: a turn can still bring its own model (a Zen/Go pick
        # or a custom model through echo-shared); ``can_serve`` decides per turn.
        if (entry := zen_catalog().get("opencode-zen")) is not None and (
            not isinstance(entry, dict) or entry.get("managed_by_plugin") != "opencode-zen"
        ):
            raise OpenCodeError("请先安装并连接 OpenCode Zen 模型插件。")
        zen_key(scope)
    except OpenCodeError as exc:
        return {"available": False, "reason": str(exc)}
    except (OSError, ValueError, RuntimeError):
        return {"available": False, "reason": "暂时无法读取 Zen 连接配置。"}
    return {
        "available": True,
        "reason": None,
        "readiness_kind": "configuration_only",
        "capabilities": ["chat", "skills"],
    }


def state_directory(scope: TenantScope | None, thread_id: str) -> Path:
    # Never use browser-supplied paths or ids as filesystem components.
    identity = [scope.tenant_id, scope.actor_id] if scope else [None, None]
    digest = hashlib.sha256(json.dumps([*identity, thread_id]).encode()).hexdigest()
    return app_paths().data_dir / "opencode" / digest


def server_directory(scope: TenantScope | None) -> Path:
    """Engine root shared by every thread of one identity.

    The warm pool keys on the state root (``_server_signature``), so a
    per-thread root made each new conversation pay a full ``opencode serve``
    cold start. Measured on this host: 1.1-1.4s for the process, 1.2-2.6s for
    the model catalog, and ~1.8s more on the first request while the provider
    handshake settled — 9.4s to the first token versus 2.3s once warm. Session
    coordinates stay per thread in :func:`state_directory`; only the server
    process and its XDG caches are shared. Nested under ``servers/`` so it can
    never collide with the per-thread roots already on disk.

    Tool turns use this same database through a throwaway MCP-enabled process.
    Retiring an idle warm process is preferable to handing its session id to
    a different database when a conversation starts using tools.
    """

    identity = [scope.tenant_id, scope.actor_id] if scope else [None, None]
    digest = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
    return app_paths().data_dir / "opencode" / "servers" / digest


def child_environment(
    root: Path,
    key: str | None,
    password: str,
    model: str,
    *,
    host_mcp: HostMCPConnection | None = None,
    shared_provider: dict[str, Any] | None = None,
) -> dict[str, str]:
    # Do not inherit other provider credentials, plugins, or OpenCode settings.
    allowed = {
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "TEMP",
        "TMP",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "LANG",
        "LC_ALL",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
    }
    env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
    for name in ("CONFIG", "DATA", "CACHE", "STATE"):
        directory = root / name.lower()
        directory.mkdir(parents=True, exist_ok=True)
        env[f"XDG_{name}_HOME"] = str(directory)
    # Zen's free tier refuses any config that *statically* disables a native
    # tool: "OpenCode's free tier can only be used from within OpenCode".
    # Bisected 2026-09-18 against the real upstream, one config key at a time —
    # the gate fires on `permission: {<tool>: "deny"}` (a single entry is
    # enough), on `"*": "deny"`, and on `tools: {<tool>: false}`, whether at the
    # top level or inside an agent block. It does *not* fire on "ask"/"allow",
    # on an empty permission map, on a deny for a tool that does not exist, or
    # on anything else Echo injects (XDG redirection, the OPENCODE_DISABLE_*
    # flags, the provider apiKey override, an agent block without permissions).
    # Neither the credential nor the binary is involved: the CLI's own key gets
    # the same 403 through this path, and the bundled binary succeeds without
    # these keys.
    #
    # So ask instead of deny, and refuse every ask for these tools in
    # ``stream_prompt``. The ceiling is unchanged — bash/edit/write and the
    # native network tools never run — but it is now enforced by us at request
    # time rather than declared in a config the gate rejects. read/glob/grep/list
    # stay available natively; privileged and network actions must go through
    # the echo_* host MCP tools, which OpenCode allows outright because Echo's
    # own approval gate reviews each call.
    permission = dict.fromkeys(DENIED_NATIVE_TOOLS, "ask")
    if host_mcp:
        permission["echo_*"] = "allow"
    provider, upstream = native_model(model)
    config = {
        "model": f"{provider}/{upstream}",
        "small_model": f"{provider}/{upstream}",
        "share": "disabled",
        "autoupdate": False,
        "snapshot": False,
        "permission": permission,
        "default_agent": "echo",
        "agent": {"echo": {"mode": "primary", "permission": permission, "steps": 16}},
    }
    if key:
        config["provider"] = {provider: {"options": {"apiKey": "{env:OPENCODE_API_KEY}"}}}
        env["OPENCODE_API_KEY"] = key
    if provider == "echo-shared":
        if shared_provider is None or not key:
            raise OpenCodeError("Shared model proxy is unavailable")
        config["provider"][provider] = {
            "name": "Echo models",
            "npm": "@ai-sdk/openai",
            "models": {upstream: {"name": upstream}},
            "options": {"baseURL": shared_provider["base_url"], "apiKey": "{env:OPENCODE_API_KEY}"},
        }
    if provider == "opencode-go":
        if not key:
            raise OpenCodeError("请先连接 OpenCode Go 套餐。")
        config["provider"][provider].update(
            {
                "name": "OpenCode Go",
                "npm": (
                    "@ai-sdk/openai"
                    if upstream.startswith(("gpt-", "grok-", "muse-spark-"))
                    else "@ai-sdk/anthropic"
                    if upstream.startswith(("minimax-", "qwen"))
                    else "@ai-sdk/openai-compatible"
                ),
                "models": {upstream: {"name": upstream}},
            }
        )
        config["provider"][provider]["options"].update(
            {
                "baseURL": "https://opencode.ai/zen/go/v1",
                "headers": {
                    "User-Agent": "Echo/1.0",
                    "x-opencode-session": hashlib.sha256(str(root).encode()).hexdigest(),
                },
            }
        )
    if host_mcp:
        config["mcp"] = {
            "echo": {
                "type": "remote",
                "url": host_mcp.url,
                "headers": {"Authorization": "Bearer {env:ECHO_HOST_MCP_TOKEN}"},
                "oauth": False,
                "enabled": True,
                "timeout": 180_000,
            }
        }
        env["ECHO_HOST_MCP_TOKEN"] = host_mcp.token
    env.update(
        OPENCODE_SERVER_PASSWORD=password,
        OPENCODE_SERVER_USERNAME="opencode",
        OPENCODE_DISABLE_AUTOUPDATE="true",
        OPENCODE_DISABLE_DEFAULT_PLUGINS="true",
        OPENCODE_DISABLE_CLAUDE_CODE="true",
        OPENCODE_DISABLE_EXTERNAL_SKILLS="true",
        OPENCODE_DISABLE_PROJECT_CONFIG="true",
        OPENCODE_DISABLE_LSP_DOWNLOAD="true",
        OPENCODE_CONFIG_CONTENT=json.dumps(config),
    )
    return env


def _server_signature(command: str, root: Path, key: str | None, model: str) -> str:
    key_digest = hashlib.sha256(key.encode()).hexdigest() if key else "anonymous"
    return hashlib.sha256(
        json.dumps([str(Path(command).resolve()), str(root.resolve()), key_digest, model]).encode()
    ).hexdigest()


def _loop_lock() -> asyncio.Lock:
    global _warm_lock, _warm_lock_loop
    loop = asyncio.get_running_loop()
    if _warm_lock is None or _warm_lock_loop is not loop:
        _warm_lock = asyncio.Lock()
        _warm_lock_loop = loop
    return _warm_lock


async def _stop_server(process: asyncio.subprocess.Process, client: httpx.AsyncClient) -> None:
    await client.aclose()
    if process.returncode is None:
        with contextlib.suppress(ProcessLookupError):
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), 3)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()


async def _start_server(
    command: str,
    root: Path,
    key: str | None,
    model: str,
    *,
    host_mcp: HostMCPConnection | None = None,
    shared_provider: dict[str, Any] | None = None,
) -> tuple[asyncio.subprocess.Process, httpx.AsyncClient]:
    workspace = root / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    password = secrets.token_urlsafe(32)
    process = await asyncio.create_subprocess_exec(
        command,
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        str(port),
        cwd=workspace,
        env=child_environment(
            root,
            key,
            password,
            model,
            host_mcp=host_mcp,
            shared_provider=shared_provider,
        ),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    client = httpx.AsyncClient(
        base_url=f"http://127.0.0.1:{port}",
        auth=("opencode", password),
        trust_env=False,
        timeout=10,
    )
    try:
        for _ in range(100):
            if process.returncode is not None:
                raise OpenCodeError("OpenCode 启动失败，请检查安装版本和引擎配置。")
            try:
                response = await client.get("/global/health", timeout=1)
                if response.status_code == 200 and response.json().get("healthy"):
                    break
            except (
                httpx.TransportError,
                ValueError,
            ):  # intentional: Retry health until the bounded startup deadline.
                pass
            await asyncio.sleep(0.1)
        else:
            raise OpenCodeError("OpenCode 启动超时，请检查本地引擎。")
        if needs_catalog_check(model):
            await validate_catalog_model(client, model, free_only=not key)
        return process, client
    except BaseException:
        await _stop_server(process, client)
        raise


@asynccontextmanager
async def _ephemeral_server(
    command: str,
    root: Path,
    key: str | None,
    model: str,
    *,
    host_mcp: HostMCPConnection | None = None,
    shared_provider: dict[str, Any] | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    process, client = await _start_server(
        command,
        root,
        key,
        model,
        host_mcp=host_mcp,
        shared_provider=shared_provider,
    )
    try:
        yield client
    finally:
        await _stop_server(process, client)


async def _expire_warm_server(entry: _WarmServer) -> None:
    async with _loop_lock():
        if _warm_servers.get(entry.signature) is not entry or entry.in_use:
            return
        del _warm_servers[entry.signature]
    await _stop_server(entry.process, entry.client)


def _schedule_warm_expiry(entry: _WarmServer) -> None:
    if entry.idle_handle is not None:
        entry.idle_handle.cancel()
    entry.idle_handle = entry.loop.call_later(
        _WARM_IDLE_SECONDS,
        lambda: entry.loop.create_task(_expire_warm_server(entry)),
    )


@asynccontextmanager
async def _warm_text_server(
    command: str, root: Path, key: str | None, model: str
) -> AsyncIterator[httpx.AsyncClient]:
    signature = _server_signature(command, root, key, model)
    loop = asyncio.get_running_loop()
    lock = _loop_lock()
    entry = None
    fresh = False
    async with lock:
        for stale in tuple(_warm_servers.values()):
            if stale.loop is not loop or stale.process.returncode is not None:
                _warm_servers.pop(stale.signature, None)
                if stale.idle_handle is not None:
                    stale.idle_handle.cancel()
                if stale.loop is loop:
                    await _stop_server(stale.process, stale.client)
                elif stale.process.returncode is None:
                    with contextlib.suppress(ProcessLookupError):
                        stale.process.terminate()
        current = _warm_servers.get(signature)
        if current is not None and not current.in_use:
            if current.idle_handle is not None:
                current.idle_handle.cancel()
                current.idle_handle = None
            current.in_use = True
            entry = current
        elif current is None:
            # Remove idle entries for the same state root after model/key changes.
            for old in tuple(_warm_servers.values()):
                if old.root == root.resolve() and not old.in_use:
                    _warm_servers.pop(old.signature, None)
                    if old.idle_handle is not None:
                        old.idle_handle.cancel()
                    await _stop_server(old.process, old.client)
            if len(_warm_servers) >= _MAX_WARM_SERVERS:
                victim = next((e for e in _warm_servers.values() if not e.in_use), None)
                if victim is not None:
                    _warm_servers.pop(victim.signature, None)
                    if victim.idle_handle is not None:
                        victim.idle_handle.cancel()
                    await _stop_server(victim.process, victim.client)
            if len(_warm_servers) < _MAX_WARM_SERVERS:
                process, client = await _start_server(command, root, key, model)
                entry = _WarmServer(signature, root.resolve(), process, client, loop)
                _warm_servers[signature] = entry
                fresh = True
    if entry is None:
        async with _ephemeral_server(command, root, key, model) as client:
            yield client
        return
    reusable = False
    try:
        if not fresh:
            response = await entry.client.get("/global/health", timeout=1)
            if response.status_code != 200 or not response.json().get("healthy"):
                raise OpenCodeError("OpenCode 本地引擎连接中断，请重试。")
            if needs_catalog_check(model):
                await validate_catalog_model(entry.client, model, free_only=not key)
        yield entry.client
        reusable = getattr(entry.client, "_echo_reusable", True)
    finally:
        async with lock:
            if _warm_servers.get(signature) is entry:
                if not reusable:
                    del _warm_servers[signature]
                    await _stop_server(entry.process, entry.client)
                else:
                    entry.in_use = False
                    _warm_servers.pop(signature)
                    _warm_servers[signature] = entry
                    _schedule_warm_expiry(entry)


async def _discard_idle_warm_server(root: Path) -> None:
    async with _loop_lock():
        for current in tuple(_warm_servers.values()):
            if (
                current.in_use
                or current.loop is not asyncio.get_running_loop()
                or current.root != root.resolve()
            ):
                continue
            _warm_servers.pop(current.signature, None)
            if current.idle_handle is not None:
                current.idle_handle.cancel()
            await _stop_server(current.process, current.client)


@asynccontextmanager
async def managed_server(
    command: str,
    root: Path,
    key: str | None,
    model: str,
    *,
    host_mcp: HostMCPConnection | None = None,
    shared_provider: dict[str, Any] | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    # Text-only servers are reusable. Keep up to three isolated conversations
    # warm so replies avoid paying the native process's cold-start cost.
    if (
        shared_provider is None
        and host_mcp is None
        and threading.current_thread() is threading.main_thread()
    ):
        async with _warm_text_server(command, root, key, model) as client:
            yield client
        return
    if threading.current_thread() is threading.main_thread():
        await _discard_idle_warm_server(root)
    async with _ephemeral_server(
        command,
        root,
        key,
        model,
        host_mcp=host_mcp,
        shared_provider=shared_provider,
    ) as client:
        yield client


_PROVIDER_CATALOG_LOAD_TIMEOUT = 10.0
_PROVIDER_CATALOG_POLL_INTERVAL = 0.4


def needs_catalog_check(model: str) -> bool:
    """Whether a live ``/provider`` read can still reject this selection.

    ``echo-shared`` (the default selection, and every custom model behind it) is
    declared by Echo's own ``OPENCODE_CONFIG_CONTENT``: the provider block and
    its single model id are written from the same selection the host is about to
    send, so membership is guaranteed by construction. The check exists to catch
    a *stale* Zen choice, and it cannot do that here — it only costs the wait for
    the whole provider catalog to load, measured at ~1.1s per turn on this host.
    """

    return native_model(model)[0] != "echo-shared"


async def validate_catalog_model(
    client: httpx.AsyncClient, model: str, *, free_only: bool = False
) -> None:
    """Reject stale Zen selections before OpenCode reports an opaque HTTP 500.

    A freshly spawned engine answers /global/health before its models.dev
    catalog finishes loading (a network fetch that can take seconds on a
    cold start), so reading /provider immediately can see an empty list and
    falsely reject a perfectly valid selection — and the failed turn then
    kills the server before the cache ever lands, so the next turn races
    again. Wait a bounded time while the catalog is empty; only declare the
    model missing once the catalog has actually loaded. (Probed 2026-09-18:
    a cold server fetched models.json ~3s after spawn while /provider was
    already reachable, and two turns failed before one warm cache existed.)
    """
    deadline = asyncio.get_running_loop().time() + _PROVIDER_CATALOG_LOAD_TIMEOUT
    while True:
        try:
            response = await client.get("/provider")
            response.raise_for_status()
            payload = response.json()
            providers = payload.get("all") if isinstance(payload, dict) else None
            if not isinstance(providers, list):
                raise ValueError("invalid provider catalog")
            provider, upstream = native_model(model)
            zen = next(
                (p for p in providers if isinstance(p, dict) and p.get("id") == provider),
                {},
            )
            models = zen.get("models", {})
            if not isinstance(models, dict):
                raise ValueError("invalid model catalog")
        except (httpx.HTTPError, ValueError):
            raise OpenCodeError("无法读取 OpenCode 模型列表，请稍后重试。") from None
        if models:
            break
        if asyncio.get_running_loop().time() >= deadline:
            raise OpenCodeError("OpenCode 模型列表尚未就绪，请稍后重试。")
        await asyncio.sleep(_PROVIDER_CATALOG_POLL_INTERVAL)
    if upstream not in models:
        raise OpenCodeError("OpenCode 当前未提供所选 Zen 模型，请在输入框选择其他模型后重试。")
    if free_only:
        cost = models[upstream].get("cost") if isinstance(models[upstream], dict) else None

        def zero_price(value: Any) -> bool:
            if isinstance(value, dict):
                return all(zero_price(item) for item in value.values())
            return type(value) in (int, float) and value == 0

        if (
            not isinstance(cost, dict)
            or not {"input", "output"}.issubset(cost)
            or not zero_price(cost)
        ):
            raise OpenCodeError("未连接 Zen 账号时仅可使用官方目录中明确标为零费用的模型。")


async def stream_model(
    model: str,
    text: str,
    *,
    interrupted: Callable[[], bool],
    fresh_text: str | None = None,
    reasoning_effort: str | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Run a text-only OpenCode model turn without tools or role orchestration."""
    command = executable()
    if not command:
        raise OpenCodeError(missing_status("opencode")["reason"])
    root = state_directory(None, "model")
    async with _warm_text_server(command, root, model_key(None, model), model) as client:
        session_id = await session_for_thread(client, root, recover_missing=bool(fresh_text))
        async for event in stream_prompt(
            client,
            session_id,
            text=text,
            system="",
            model=model,
            interrupted=interrupted,
            fresh_thread_text=fresh_text,
            reasoning_effort=reasoning_effort,
        ):
            yield event


async def session_for_thread(
    client: httpx.AsyncClient, root: Path, *, recover_missing: bool = False
) -> str:
    mapping = root / "session.json"
    if mapping.exists():
        try:
            session_id = json.loads(mapping.read_text(encoding="utf-8"))["session_id"]
            if not isinstance(session_id, str) or not re.fullmatch(r"ses_[A-Za-z0-9]+", session_id):
                raise ValueError("invalid session coordinate")
        except (ValueError, KeyError):
            raise OpenCodeError("OpenCode 会话记录损坏，请新建对话。") from None
        response = await client.get(f"/session/{session_id}")
        if response.status_code == 200:
            return session_id
        if response.status_code != 404:
            raise OpenCodeError("无法读取 OpenCode 会话，请稍后重试。")
        # Only recover when the caller can bootstrap Echo's canonical history
        # into the new empty session. Auth/network/server errors never reset it.
        if not recover_missing:
            raise OpenCodeError("OpenCode 会话已不存在，且没有可用于恢复的对话历史。")
    response = await client.post("/session", json={"title": "Echo"})
    response.raise_for_status()
    session_id = response.json()["id"]
    if not isinstance(session_id, str) or not re.fullmatch(r"ses_[A-Za-z0-9]+", session_id):
        raise OpenCodeError("OpenCode 返回了无效的会话编号，请重试。")
    # The session coordinate lives in its own per-thread root, which nothing
    # else creates any more now that the engine runs from a shared root.
    mapping.parent.mkdir(parents=True, exist_ok=True)
    temporary = mapping.with_suffix(".tmp")
    temporary.write_text(json.dumps({"session_id": session_id}), encoding="utf-8")
    temporary.replace(mapping)
    return session_id
