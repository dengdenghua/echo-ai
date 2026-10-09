"""Run a chat turn on a remote Echo over SSH or WSL (work location ``remote``).

The conversation stays local: its history, sidebar entry and panels live on
this computer. Each turn is relayed to the remote runtime's realtime gateway
as a turn on a thread with the same id, so the remote keeps its own context
between turns. Remote items (messages, commands, file changes) and their
streaming deltas are re-emitted into the local turn, and approval requests
are forwarded to the local user. The remote Echo enforces its own sandbox.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import json
import re
from typing import Any

REMOTE_LOCATION_REASON = "work_location_remote"
_BACKEND_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_TURN_TIMEOUT_S = 3600
# Remote item stream methods whose params carry the remote thread/turn ids.
_DELTA_METHODS = frozenset(
    {
        "item/agentMessage/delta",
        "item/reasoning/textDelta",
        "item/reasoning/summaryTextDelta",
        "item/plan/delta",
        "item/commandExecution/outputDelta",
        "item/fileChange/hunkDelta",
        "turn/heartbeat",
    }
)
_SKIPPED_ITEM_TYPES = frozenset({"userMessage", "steeringUserMessage"})


def remote_work_location(context: dict[str, Any] | None) -> str | None:
    """Return the selected SSH/WSL connection id, or ``None``."""
    raw = (context or {}).get("work_location")
    if not isinstance(raw, dict) or raw.get("kind") != "remote":
        return None
    backend_id = str(raw.get("backend_id") or "").strip()
    if not _BACKEND_ID_RE.fullmatch(backend_id):
        raise ValueError("远程连接无效，请重新选择工作位置")
    return backend_id


def _require_operator(runtime: Any, turn: Any) -> None:
    if not getattr(runtime, "_require_auth", False):
        return
    store = getattr(runtime, "_identity_store", None)
    actor = getattr(getattr(turn, "params", None), "owner_actor_id", None)
    identity = store.get(actor) if store is not None and actor else None
    roles = {str(role).lower() for role in getattr(identity, "roles", ()) or ()}
    if not roles & {"admin", "operator"}:
        raise PermissionError("只有管理员可以使用 SSH / WSL 远程连接")


def _registry() -> Any:
    from runtime.platform.process.paths import app_paths
    from runtime.sensing.gateway.remote_transport import BackendRegistry

    return BackendRegistry(app_paths().data_dir / "remote_backends.json")


@contextlib.asynccontextmanager
async def _open_upstream(backend: Any, auth_token: str | None):
    """Yield a websocket to the remote realtime gateway (SSH forward if needed)."""
    from urllib.parse import urlparse

    import websockets

    from runtime.safety.auth.url_guard import check_url
    from runtime.sensing.gateway.remote_transport import _to_ws_url, connect_remote_backend

    stack = contextlib.ExitStack()
    try:
        # Opening and closing an SSH forward blocks; keep it off the loop.
        connected = await asyncio.to_thread(stack.enter_context, connect_remote_backend(backend))
        url = _to_ws_url(connected.url, "/api/realtime")
        http_url = connected.url
        verdict = check_url(http_url, allow_private=connected.tunnel_active)
        if not verdict.allow:
            raise PermissionError(f"远程地址被拒绝：{verdict.reason}")
        kwargs: dict[str, Any] = {"max_size": None, "proxy": None, "open_timeout": 15}
        if auth_token:
            kwargs["additional_headers"] = {"Authorization": f"Bearer {auth_token}"}
        if verdict.resolved_ip and urlparse(http_url).hostname != verdict.resolved_ip:
            kwargs["host"] = verdict.resolved_ip
        async with websockets.connect(url, **kwargs) as upstream:
            yield upstream
    finally:
        await asyncio.to_thread(stack.close)


class _Relay:
    def __init__(self, runtime: Any, turn: Any, log: Any, emitter: Any):
        from pydantic import TypeAdapter

        from runtime.protocol.items import Item

        self.runtime, self.turn, self.log, self.emitter = runtime, turn, log, emitter
        self.items: dict[str, Any] = {}
        self.adapter = TypeAdapter(Item)
        self.remote_turn_id = ""

    def _local(self, params: dict[str, Any]) -> dict[str, Any]:
        return {**params, "threadId": self.turn.thread_id, "turnId": self.turn.id}

    def _parse(self, raw: Any) -> Any | None:
        if not isinstance(raw, dict) or raw.get("type") in _SKIPPED_ITEM_TYPES:
            return None
        try:
            return self.adapter.validate_python(raw)
        except ValueError:
            return None

    async def item_started(self, raw: Any) -> None:
        item = self._parse(raw)
        if item is None or item.id in self.items:
            return
        self.items[item.id] = item
        self.turn.items.append(item)
        await self.runtime._emit_item_started(self.turn, self.log, self.emitter, item)

    async def item_completed(self, raw: Any) -> None:
        item = self._parse(raw)
        if item is None:
            return
        previous = self.items.get(item.id)
        if previous is None:
            self.turn.items.append(item)
        else:
            self.turn.items[self.turn.items.index(previous)] = item
        self.items[item.id] = item
        await self.runtime._emit_item_completed(self.turn, self.log, self.emitter, item)

    async def notification(self, method: str, params: dict[str, Any]) -> None:
        if method == "turn/started":
            turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
            self.remote_turn_id = str(turn.get("id") or params.get("turnId") or "")
        elif method == "item/started":
            await self.item_started(params.get("item"))
        elif method == "item/completed":
            await self.item_completed(params.get("item"))
        elif method in _DELTA_METHODS:
            await self.emitter.notify(method, self._local(params))

    async def approval(self, method: str, params: dict[str, Any]) -> Any:
        return await self.emitter.request_approval(method, self._local(params))


async def drive_remote_echo(
    runtime: Any,
    turn: Any,
    log: Any,
    emitter: Any,
    intent: Any,
    *,
    text: str,
    open_upstream: Any = None,
) -> None:
    from websockets.exceptions import InvalidStatus, WebSocketException

    from runtime.platform import feature_flags
    from runtime.protocol.items import AgentMessageItem, ItemStatus
    from runtime.sensing.gateway.remote_transport import SshTunnelError

    backend_id = remote_work_location(getattr(intent, "user_context", None))
    if backend_id is None:
        raise ValueError("this turn did not select a remote connection")
    if not feature_flags.is_on("ui.remote_transport"):
        raise RuntimeError("远程连接功能未开启（ui.remote_transport）")
    _require_operator(runtime, turn)
    registry = _registry()
    backend = registry.get(backend_id)
    if backend is None or (backend.ssh is None and backend.wsl is None):
        raise RuntimeError("找不到这个远程连接，它可能已被删除")
    # One remote turn is one atomic relay; steer by sending the next message.
    set_steering = getattr(runtime, "_set_turn_steering_accepting", None)
    if callable(set_steering):
        set_steering(turn, False)

    relay = _Relay(runtime, turn, log, emitter)
    params = getattr(turn, "params", None)
    turn_params: dict[str, Any] = {
        # Same id on both sides: the remote thread is this conversation.
        "threadId": turn.thread_id,
        "input": [{"type": "text", "text": text}],
        "approvalPolicy": getattr(params, "approval_policy", None) or "on-request",
    }
    ids = itertools.count(2)
    opener = open_upstream or _open_upstream
    try:
        async with opener(backend, registry.auth_token(backend_id)) as upstream:
            await upstream.send(
                json.dumps(
                    {"jsonrpc": "2.0", "id": 1, "method": "turn/start", "params": turn_params}
                )
            )
            interrupt_sent = False
            deadline = asyncio.get_running_loop().time() + _TURN_TIMEOUT_S
            while True:
                if (
                    emitter.is_turn_interrupted(turn.id)
                    and not interrupt_sent
                    and relay.remote_turn_id
                ):
                    interrupt_sent = True
                    await upstream.send(
                        json.dumps(
                            {
                                "jsonrpc": "2.0",
                                "id": next(ids),
                                "method": "turn/interrupt",
                                "params": {
                                    "threadId": turn.thread_id,
                                    "turnId": relay.remote_turn_id,
                                },
                            }
                        )
                    )
                if asyncio.get_running_loop().time() >= deadline:
                    raise TimeoutError(f"远程「{backend.name}」超时未完成")
                try:
                    frame = await asyncio.wait_for(upstream.recv(), timeout=0.5)
                except TimeoutError:
                    continue
                message = json.loads(frame)
                method = message.get("method")
                if method and "id" in message:
                    result = await relay.approval(method, message.get("params") or {})
                    await upstream.send(
                        json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result})
                    )
                elif method:
                    await relay.notification(method, message.get("params") or {})
                elif message.get("id") == 1:
                    if message.get("error"):
                        error = message["error"]
                        detail = error.get("message") if isinstance(error, dict) else error
                        raise RuntimeError(f"远程「{backend.name}」执行失败：{detail}")
                    break
    except InvalidStatus as exc:
        status = exc.response.status_code
        registry.update_health(backend_id, status="error", detail=f"HTTP {status}")
        hint = "访问令牌无效或缺失" if status in {401, 403, 4401} else f"HTTP {status}"
        raise RuntimeError(f"远程「{backend.name}」拒绝了连接：{hint}") from exc
    except (OSError, SshTunnelError, WebSocketException) as exc:
        registry.update_health(backend_id, status="error", detail=str(exc)[:300])
        raise RuntimeError(f"连不上远程「{backend.name}」：{exc}") from exc

    answered = any(
        isinstance(item, AgentMessageItem) and item.message_kind == "answer"
        for item in relay.items.values()
    )
    if not answered and not emitter.is_turn_interrupted(turn.id):
        item = AgentMessageItem(text=f"（远程「{backend.name}」没有返回文字回复）")
        turn.items.append(item)
        await runtime._emit_item_started(turn, log, emitter, item)
        item.status = ItemStatus.COMPLETED
        await runtime._emit_item_completed(turn, log, emitter, item)


__all__ = ["REMOTE_LOCATION_REASON", "drive_remote_echo", "remote_work_location"]
