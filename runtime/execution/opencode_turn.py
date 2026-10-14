"""One OpenCode turn against a running ``opencode serve``.

Submits the prompt, turns the engine's growing message snapshots and SSE
events into Echo turn events, refuses every native permission ask, and words
model failures for people. Process lifecycle stays in ``opencode_backend``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

_logger = logging.getLogger(__name__)


class OpenCodeError(RuntimeError):
    """Safe-to-display engine failure, without credentials or raw responses."""


def _has_unexecuted_tool_markup(text: str) -> bool:
    """Recognize protocol blocks outside Markdown examples, without executing text."""
    fence = ""
    for line in text.splitlines():
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            token = marker.group(1)
            if not fence:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = ""
            continue
        if not fence and re.match(
            r"^\s*<[^<>\n]{0,16}DSML[^<>\n]{0,16}(?:tool_calls|invoke)\b", line
        ):
            return True
    return False


def native_model(model: str) -> tuple[str, str]:
    if model.startswith("echo-shared/"):
        return "echo-shared", model.removeprefix("echo-shared/")
    return (
        ("opencode-go", model.removeprefix("opencode-go/"))
        if model.startswith("opencode-go/")
        else ("opencode", model)
    )


async def reasoning_variants(client: httpx.AsyncClient, model: str) -> list[str]:
    """Read only variants advertised by the selected native model."""
    response = await client.get("/provider")
    response.raise_for_status()
    provider, upstream = native_model(model)
    for entry in response.json().get("all", []):
        if entry.get("id") == provider:
            variants = entry.get("models", {}).get(upstream, {}).get("variants", {})
            return [
                name
                for name, options in variants.items()
                if isinstance(options, dict) and not options.get("disabled")
            ]
    return []


async def refuse_pending_permissions(client: httpx.AsyncClient) -> int:
    """Refuse asks that never reached us over SSE; returns how many.

    ``receive_events`` ends streaming on any gap (45s read timeout, a parse
    error, a dropped connection) and never reconnects. An ask raised after that
    point would sit unanswered forever while the prompt POST waits with no
    timeout — the turn would hang rather than fail. Polling the engine's own
    pending list closes that window, so a lost event stream costs a refusal, not
    a stuck turn.
    """

    try:
        response = await client.get("/permission", timeout=10)
        response.raise_for_status()
        pending = response.json()
    except (httpx.HTTPError, ValueError):
        return 0
    if not isinstance(pending, list):
        return 0
    refused = 0
    for request in pending:
        if not isinstance(request, dict):
            continue
        if await refuse_permission(client, {"type": "permission.asked", "properties": request}):
            refused += 1
    return refused


async def refuse_permission(client: httpx.AsyncClient, event: dict[str, Any]) -> bool:
    """Refuse a native tool the host never grants; ``True`` if we handled it.

    ``child_environment`` asks rather than denies because a static deny trips
    Zen's free-tier gate, so the ceiling is enforced here instead. Every ask is
    refused, not just the ones we asked for: an unexpected prompt is a tool we
    did not intend to expose, and fail-closed is the only safe reading.

    The refusal carries a message because a bare reject ends the turn at
    ``finish: "tool-calls"`` with no text — the model stops mid-step and
    ``stream_prompt`` reports "未完成本次回答". With a reason attached the model
    finishes normally and explains what it could not do.
    """

    if str(event.get("type", "")) != "permission.asked":
        return False
    properties = event.get("properties")
    if not isinstance(properties, dict):
        return False
    request_id = properties.get("id")
    if not isinstance(request_id, str) or not request_id:
        return False
    tool = str(properties.get("permission", "") or "unknown")
    try:
        response = await client.post(
            f"/permission/{request_id}/reply",
            json={
                "reply": "reject",
                "message": (
                    f"The host does not allow the native {tool} tool. "
                    "Use the available echo_* tools instead, or explain to the "
                    "user what you could not do."
                ),
            },
            timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        # A refusal we could not deliver must not read as a grant: the tool
        # stays pending and the turn fails on its own deadline rather than
        # running something the host forbids.
        _logger.warning("could not refuse native %s permission %s", tool, request_id)
    return True


def _has_status(detail: str, status: str) -> bool:
    """A status code, not any digits that happen to spell one.

    ``"403" in detail`` also matches the milliseconds in
    ``2026-09-18T02:08:58.403Z``, which turned a transport error into "your
    account has no entitlement for this model".
    """

    return re.search(rf"(?<![\d.]){status}(?![\d.])", detail) is not None


def public_model_error(error: Any) -> str:
    detail = json.dumps(error, ensure_ascii=False).lower()
    if "free tier can only be used from within opencode" in detail or "freetiererror" in detail:
        # Not an entitlement problem: Zen refuses free-tier traffic from a
        # client it does not recognise as OpenCode itself. Switching model does
        # not help, so do not send the user model-shopping.
        return "OpenCode 免费额度只允许其官方客户端使用，请改用已连接的付费模型或自有模型。"
    if _has_status(detail, "429") or "limit" in detail or "rate" in detail:
        return "当前模型额度或请求频率受限，请稍后重试或切换模型。"
    if (
        _has_status(detail, "403")
        or "forbidden" in detail
        or "payment" in detail
        or "credits" in detail
        or "subscription" in detail
        or "entitlement" in detail
    ):
        # Upstream entitlement rejections (free-tier gates, contributor-only
        # models, missing payment method) are per-model, not a broken login.
        # Say so, or they read as "authentication dropped" and users re-login
        # for nothing. (Probed 2026-09-18: muse-spark-1.3-contributor-free
        # failed this way right after a working big-pickle turn.)
        return "当前账号没有这个模型的使用资格（部分免费模型有额外门槛或需付费），请换一个模型。"
    if _has_status(detail, "401") or "unauthorized" in detail or "authentication" in detail:
        return "模型连接已失效，请在模型设置中检查授权。"
    if "model" in detail and (
        _has_status(detail, "404") or any(x in detail for x in ("not found", "unavailable"))
    ):
        return "当前模型不可用，请切换其他模型。"
    return "OpenCode 调用模型失败，请稍后重试或检查模型连接。"


def _tool_result_preview(tool: str, value: object) -> str:
    text = str(value or "")
    if tool not in {"call_agent", "call_agent_parallel"}:
        return text[:4000]
    try:
        result = json.loads(text)
    except (ValueError, TypeError):
        return text[:4000]
    if not isinstance(result, dict):
        return text[:4000]
    # Delegation receipts must remain valid JSON after previewing. Internal
    # review queues and repeated prompt copies otherwise truncate identity and
    # status along with the child's output.
    keys = {
        "agent_id",
        "requested_agent_id",
        "market_agent_id",
        "identity_source",
        "display_name",
        "role_display_name",
        "codename",
        "role",
        "avatar",
        "avatar_url",
        "role_source_path",
        "success",
        "ok",
        "error",
        "output",
        "iteration_count",
        "files_touched",
        "spec_index",
        "success_count",
    }

    def receipt(raw: dict) -> dict:
        return {
            key: (
                val[:1500] if isinstance(val, str) else val[:50] if isinstance(val, list) else val
            )
            for key, val in raw.items()
            if key in keys
        }

    preview = receipt(result)
    for group in ("successes", "failures"):
        if isinstance(result.get(group), list):
            preview[group] = [receipt(row) for row in result[group] if isinstance(row, dict)]
    return json.dumps(preview, ensure_ascii=False)


@dataclass
class MessageEvents:
    """Reduce growing message snapshots without replaying old prose or tools."""

    baseline: set[str]
    text: dict[str, str] = field(default_factory=dict)
    tools: dict[str, str] = field(default_factory=dict)
    last_text_part: str | None = None
    tool_names: dict[str, str] = field(default_factory=dict)

    def consume(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        events = []
        for message in messages:
            info = message.get("info", {})
            if info.get("role") != "assistant" or info.get("id") in self.baseline:
                continue
            for part in message.get("parts", []):
                part_id = str(part.get("id", ""))
                if part.get("type") == "text" and not part.get("synthetic"):
                    value = str(part.get("text") or "")
                    old = self.text.get(part_id, "")
                    if value.startswith(old) and len(value) > len(old):
                        events.append(
                            {
                                "type": "text_delta",
                                "delta": value[len(old) :],
                                "start_new_segment": self.last_text_part not in (None, part_id),
                            }
                        )
                        self.last_text_part = part_id
                        self.text[part_id] = value
                elif part.get("type") == "tool":
                    state = part.get("state", {})
                    status = state.get("status")
                    call_id = str(part.get("callID") or part_id)
                    engine_name = str(part.get("tool") or "tool")
                    tool = self.tool_names.get(engine_name, f"opencode.{engine_name}")
                    tool_input = state.get("input", {})
                    encoded_input = json.dumps(tool_input, ensure_ascii=False)
                    input_preview = (
                        tool_input
                        if isinstance(tool_input, dict) and len(encoded_input) <= 100_000
                        else encoded_input[:2000]
                    )
                    if status in ("running", "completed", "error") and call_id not in self.tools:
                        events.append(
                            {
                                "type": "tool_start",
                                "tool_name": tool,
                                "tool_call_id": call_id,
                                "input_preview": input_preview,
                            }
                        )
                    if status in ("completed", "error") and self.tools.get(call_id) not in (
                        "completed",
                        "error",
                    ):
                        events.append(
                            {
                                "type": "tool_end",
                                "tool_name": tool,
                                "tool_call_id": call_id,
                                "success": status == "completed",
                                "status": "success" if status == "completed" else "error",
                                "output_preview": _tool_result_preview(
                                    tool, state.get("output") or state.get("error") or ""
                                ),
                            }
                        )
                    if status != "pending":
                        self.tools[call_id] = status
        return events


async def _abort_and_settle(client: httpx.AsyncClient, session_id: str) -> None:
    # A cancelled HTTP request is not proof that the native model has stopped.
    client._echo_reusable = False
    try:
        async with asyncio.timeout(3):
            response = await client.post(f"/session/{session_id}/abort", timeout=2)
            response.raise_for_status()
            if response.json() is not True:
                return
            while True:
                response = await client.get("/session/status", timeout=1)
                response.raise_for_status()
                statuses = response.json()
                if (
                    isinstance(statuses, dict)
                    and statuses.get(session_id, {"type": "idle"}).get("type") == "idle"
                ):
                    # Retire cancelled processes even after idle: a late prompt
                    # admission must not race with the next warm acquisition.
                    return
                await asyncio.sleep(0.05)
    except (
        TimeoutError,
        httpx.HTTPError,
        ValueError,
        AttributeError,
    ):  # intentional: Leave connection retirement to managed_server.
        pass  # managed_server must retire an unconfirmed warm connection.


async def stream_prompt(
    client: httpx.AsyncClient,
    session_id: str,
    *,
    text: str,
    system: str,
    model: str,
    interrupted: Callable[[], bool],
    poll_s: float = 0.1,
    tool_names: dict[str, str] | None = None,
    fresh_thread_text: str | None = None,
    reasoning_effort: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    from runtime.execution.opencode_events import (
        TurnEvents,
        message_id,
        receive_events,
        reported_turn_cost,
    )

    variant = None
    if reasoning_effort:
        offered = await reasoning_variants(client, model)
        candidate = "none" if reasoning_effort == "off" and "none" in offered else reasoning_effort
        if candidate in offered:
            variant = candidate
        elif offered:
            raise OpenCodeError("当前模型不支持所选推理档位，请重新选择。")
    url = f"/session/{session_id}"
    previous = await client.get(f"{url}/message")
    previous.raise_for_status()
    previous_messages = previous.json()
    if not previous_messages and fresh_thread_text is not None:
        text = fresh_thread_text
    reducer = MessageEvents(
        {m["info"]["id"] for m in previous_messages}, tool_names=tool_names or {}
    )
    user_message_id = message_id()
    projection = TurnEvents(session_id, user_message_id, reducer)
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue(maxsize=128)
    ready = asyncio.Event()
    receiver = asyncio.create_task(receive_events(client, queue, ready))
    pending = None
    incoming = None
    settled = False
    try:
        # Subscribe before prompt submission so early Parts are not lost.
        try:
            await asyncio.wait_for(ready.wait(), timeout=2)
        except TimeoutError:
            receiver.cancel()
            await asyncio.gather(receiver, return_exceptions=True)
            queue.put_nowait(None)
        if interrupted():
            yield {"type": "react_cancelled", "reason": "用户停止了任务"}
            return
        pending = asyncio.create_task(
            client.post(
                f"{url}/message",
                json={
                    "messageID": user_message_id,
                    "model": {
                        "providerID": native_model(model)[0],
                        "modelID": native_model(model)[1],
                    },
                    "agent": "echo",
                    **({"variant": variant} if variant else {}),
                    "system": system,
                    "parts": [{"type": "text", "text": text}],
                },
                timeout=None,
            )
        )
        incoming = asyncio.create_task(queue.get())
        streaming = True
        next_snapshot = 0.0
        loop = asyncio.get_running_loop()
        while True:
            if interrupted():
                await _abort_and_settle(client, session_id)
                settled = True
                yield {"type": "react_cancelled", "reason": "用户停止了任务"}
                return
            waiting = {pending}
            if incoming is not None:
                waiting.add(incoming)
            await asyncio.wait(waiting, timeout=poll_s, return_when=asyncio.FIRST_COMPLETED)
            if incoming is not None and incoming.done():
                native = incoming.result()
                incoming = None
                if native is None:
                    streaming = False
                elif await refuse_permission(client, native):
                    # A permission prompt is host policy, not turn content: it
                    # never reaches the projection or the UI.
                    incoming = asyncio.create_task(queue.get())
                else:
                    for event in projection.consume(native):
                        yield event
                    incoming = asyncio.create_task(queue.get())
            if not streaming and not pending.done() and loop.time() >= next_snapshot:
                # With no event stream left, an ask raised from here on would
                # never be refused and the turn would hang on it. Poll instead.
                await refuse_pending_permissions(client)
                response = await client.get(f"{url}/message")
                response.raise_for_status()
                for event in projection.snapshots(response.json()):
                    yield event
                next_snapshot = loop.time() + 1.0
            if not pending.done():
                continue
            result = await pending
            if result.is_error:
                raise OpenCodeError(
                    public_model_error(
                        {"statusCode": result.status_code, "body": result.text[:16_384]}
                    )
                )
            final = result.json()
            # One final read repairs missed/out-of-order Parts and earlier tool
            # messages. Never replay queued deltas after this snapshot boundary.
            response = await client.get(f"{url}/message")
            response.raise_for_status()
            final_messages = response.json()
            for event in projection.snapshots(final_messages):
                yield event
            for event in reducer.consume([final]):
                yield event
            info = final.get("info", {})
            if info.get("error"):
                raise OpenCodeError(public_model_error(info["error"]))
            if info.get("finish") not in ("stop", "end_turn"):
                raise OpenCodeError("OpenCode 未完成本次回答，请重试继续。")
            if not any(reducer.text.values()):
                raise OpenCodeError("模型没有返回回答，请重试或切换模型。")
            final_text = "".join(
                str(part.get("text", ""))
                for part in final.get("parts", [])
                if part.get("type") == "text"
            )
            if tool_names and _has_unexecuted_tool_markup(final_text):
                # Serialized model protocol is text, never an authorized tool
                # invocation. Do not execute it or report the task completed.
                raise OpenCodeError(
                    "模型输出了未执行的工具调用文本，本轮未完成。请重试或切换模型。"
                )
            settled = True
            yield {
                "type": "react_completed",
                "success": True,
                "terminated_reason": "completed",
                "completion_receipt": {
                    "engine": "opencode",
                    "model": model,
                    "reasoning_variant": variant,
                    "cost": reported_turn_cost([*final_messages, final], user_message_id),
                    "tokens": info.get("tokens"),
                },
            }
            return
    finally:
        receiver.cancel()
        if incoming is not None:
            incoming.cancel()
        await asyncio.gather(receiver, *([incoming] if incoming else []), return_exceptions=True)
        if pending is not None:
            if not settled:
                await _abort_and_settle(client, session_id)
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
