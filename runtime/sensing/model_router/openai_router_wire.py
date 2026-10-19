"""Split out of :mod:`openai_router` so that module stays under the 1000-line
god-file ratchet. Everything here is re-exported by the original module, so
import sites do not move.
"""

from __future__ import annotations

import json
import os
from typing import Any

from runtime.platform.models.model_capabilities import model_is_reasoning

from .custom_model_flags import (
    custom_model_supports_thinking,
)
from .models import (
    Message,
    normalize_reasoning_effort,
)


def _openai_reasoning_effort(value: Any) -> str:
    """Map an echo reasoning-effort tier onto a value native OpenAI accepts."""
    return _OPENAI_REASONING_EFFORT.get(normalize_reasoning_effort(value) or "high", "high")


def _model_might_think(model: str, base_url: str | None = None) -> bool:
    """Whether ``model`` may spend output tokens reasoning before it writes.

    Two sources, deliberately OR'ed rather than ranked: the operator's own
    ``supports_thinking`` declaration, and the bundled models.dev snapshot.
    Either saying yes is enough, because the cost of a false positive is a
    slightly larger output floor while the cost of a false negative is a
    response with no content in it.

    ``base_url`` anchors the operator lookup on the endpoint actually being
    called. The models.dev side stays name-based on purpose: it is knowledge
    about the upstream family, not about any one operator endpoint.
    """
    return custom_model_supports_thinking(model, base_url) or model_is_reasoning(model)


def _compat_payload_fingerprint(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)


def _resolve_credential_ref(entry: dict[str, Any]) -> str:
    """Resolve a ``connector:<id>:<key>`` reference to a plaintext secret."""
    reference = str(entry.get("credential_ref") or "")
    parts = reference.split(":", 2)
    if len(parts) != 3 or parts[0] != "connector" or not parts[1] or not parts[2]:
        return ""
    try:
        from runtime.platform.connectors.credential_store import CredentialStore

        store = CredentialStore()
        return str(store.get_secret(parts[1], parts[2]) or "")
    except Exception:  # noqa: BLE001 — best-effort; fall back to no key
        return ""


def _opencode_session_headers(base_url: str) -> dict[str, str]:
    """Identify as an OpenCode client so free-tier models accept the call."""
    if "opencode.ai/zen" not in base_url:
        return {}
    import hashlib

    session = hashlib.sha256(str(os.getcwd()).encode()).hexdigest()
    return {"x-opencode-session": session, "User-Agent": "Echo/1.0"}


def _redact_error_text(text: str) -> str:
    if not text:
        return text
    try:
        from runtime.platform.observability.redactor import redact_text

        return redact_text(text)
    except Exception:  # pragma: no cover - diagnostics must not fail calls
        return text


def _format_openai_http_error(
    status_code: int,
    body: str,
    *,
    compatibility_events: list[dict[str, Any]] | None = None,
) -> str:
    body_preview = _redact_error_text((body or "").strip())[:500]
    parsed_message = ""
    parsed_type = ""
    try:
        payload = json.loads(body or "{}")
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict):
            parsed_message = _redact_error_text(
                str(error.get("message") or "").strip(),
            )
            parsed_type = _redact_error_text(
                str(error.get("type") or error.get("code") or "").strip(),
            )
    except (TypeError, json.JSONDecodeError):  # noqa: BLE001 — error body parse failed; keep empty parsed fields
        pass

    lower = f"{parsed_type} {parsed_message} {body_preview}".lower()
    if (
        status_code == 402
        or "insufficient_balance" in lower
        or "insufficient account balance" in lower
    ):
        return _append_compatibility_retry_summary(
            f"http_{status_code}: 模型账户余额不足，请充值当前模型供应商账户，"
            "或在模型选择里切换到可用模型。",
            compatibility_events,
        )
    if status_code == 403 and ("freetiererror" in lower or "free tier can only be used" in lower):
        # OpenCode answers this for its free catalog when the caller is not the
        # OpenCode client itself. Saying "invalid API key" here sent operators
        # hunting for a credential problem that does not exist.
        return _append_compatibility_retry_summary(
            "http_403: OpenCode 免费模型只能在 OpenCode 客户端内调用，"
            "第三方客户端无法使用该渠道的免费模型；"
            "请改用 OpenCode Go 渠道的同名模型，或在模型选择里换一个可用模型。",
            compatibility_events,
        )
    if status_code in (401, 403):
        detail = parsed_message or body_preview
        suffix = f"（{detail}）" if detail else ""
        return _append_compatibility_retry_summary(
            f"http_{status_code}: 模型 API Key 无效或没有权限{suffix}",
            compatibility_events,
        )

    detail = parsed_message or body_preview
    if status_code == 400 and (not detail or detail == "openai_error"):
        return _append_compatibility_retry_summary(
            f"http_{status_code}: 上游 OpenAI 兼容接口拒绝请求"
            f"{f'（{detail}）' if detail else ''}。"
            "通常是模型名、API Key、额度或供应商不支持的 reasoning/thinking "
            "参数导致；请切换到可用模型，或在模型设置里关闭该模型的思考能力后重试。",
            compatibility_events,
        )
    return _append_compatibility_retry_summary(
        f"http_{status_code}: {detail}",
        compatibility_events,
    )


def _append_compatibility_retry_summary(
    message: str,
    events: list[dict[str, Any]] | None,
) -> str:
    if not events:
        return message
    rows: list[str] = []
    for index, event in enumerate(events, start=1):
        reason = _redact_error_text(str(event.get("reason") or "unknown"))
        parts: list[str] = []
        for key, label in (
            ("removed_fields", "移除"),
            ("added_fields", "新增"),
            ("changed_fields", "调整"),
        ):
            values = [
                _redact_error_text(str(value))
                for value in (event.get(key) or [])
                if str(value).strip()
            ]
            if values:
                parts.append(f"{label}:{','.join(values)}")
        detail = f"{reason}（{';'.join(parts)}）" if parts else reason
        rows.append(f"{index}.{detail}")
    return f"{message} 已自动尝试 OpenAI 兼容降级：{'；'.join(rows)}。"


def _without_openai_thinking(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a Chat Completions payload without thinking extensions.

    OpenAI-compatible gateways disagree on reasoning knobs: some accept
    ``reasoning_effort`` and/or ``thinking``, others return a generic
    ``400 openai_error`` for either field. A one-shot fallback keeps custom
    providers usable without forcing operators to know every proxy dialect.
    """
    fallback = dict(payload)
    fallback.pop("reasoning_effort", None)
    fallback.pop("thinking", None)
    return fallback


def _should_retry_without_openai_thinking(
    status_code: int,
    payload: dict[str, Any],
) -> bool:
    if status_code != 400:
        return False
    return "reasoning_effort" in payload or "thinking" in payload


def _message_to_openai(m: Message) -> dict[str, str]:
    """Legacy 1-to-1 translator · preserved for callers that only
    handle plain string content. New code should use
    ``_messages_to_openai`` which handles Anthropic-style blocks.
    """
    content = m.content if isinstance(m.content, str) else ""
    return {"role": m.role, "content": content}


def _messages_to_openai(messages: list[Message]) -> list[dict[str, Any]]:
    """Translate Echo messages to OpenAI chat-completion shape.

    Echo internally uses Anthropic-style block lists for
    multi-turn tool flows:

        assistant · content=[{"type":"text",...}, {"type":"tool_use", id, name, input}]
        user      · content=[{"type":"tool_result", tool_use_id, content, [is_error]}]

    OpenAI's schema is different:

        assistant · {"role":"assistant", "content":"...", "tool_calls":[{id, type:"function", function:{name, arguments}}]}
        tool      · {"role":"tool", "tool_call_id":"...", "content":"..."}

    This translator does the mapping. A plain-string content
    message passes through unchanged.
    """
    out: list[dict[str, Any]] = []
    for m in messages:
        if isinstance(m.content, str):
            # Fast path · plain string · pass through.
            out.append({"role": m.role, "content": m.content})
            continue

        # Block-list content · need to split and re-shape.
        blocks = m.content if isinstance(m.content, list) else []

        if m.role == "assistant":
            # Collect text + tool_use blocks into a single
            # assistant message.
            text_parts: list[str] = []
            tool_calls: list[dict[str, Any]] = []
            for b in blocks:
                if not isinstance(b, dict):
                    continue
                btype = b.get("type")
                if btype == "text":
                    text_parts.append(str(b.get("text", "")))
                elif btype == "tool_use":
                    args = b.get("input") or {}
                    tool_calls.append(
                        {
                            "id": b.get("id") or "",
                            "type": "function",
                            "function": {
                                "name": b.get("name") or "",
                                "arguments": json.dumps(
                                    args,
                                    ensure_ascii=False,
                                ),
                            },
                        }
                    )
            msg: dict[str, Any] = {
                "role": "assistant",
                "content": "".join(text_parts),
            }
            if tool_calls:
                msg["tool_calls"] = tool_calls
            out.append(msg)
            continue

        if m.role == "user":
            # Separate tool_result blocks from text content.
            # Tool results become standalone ``{"role":"tool"}``
            # messages; any stray text goes into a user message.
            #
            # Image blocks must survive as blocks: a user upload arrives as
            # an ``image_url`` block (built by ``_react_context_attachments``)
            # and OpenAI's only way to carry it is multimodal list content.
            # Collapsing the message to a joined string here silently dropped
            # every uploaded image — the model was told about the text and
            # never saw the picture.
            text_parts = []
            image_blocks: list[dict[str, Any]] = []
            for b in blocks:
                if not isinstance(b, dict):
                    continue
                btype = b.get("type")
                if btype == "tool_result":
                    content = b.get("content") or ""
                    if not isinstance(content, str):
                        content = json.dumps(
                            content,
                            ensure_ascii=False,
                            default=str,
                        )
                    out.append(
                        {
                            "role": "tool",
                            "tool_call_id": b.get("tool_use_id") or "",
                            "content": content,
                        }
                    )
                elif btype == "text":
                    text_parts.append(str(b.get("text", "")))
                elif btype in ("image_url", "image"):
                    normalized = _image_block_to_openai(b)
                    if normalized is not None:
                        image_blocks.append(normalized)
            if image_blocks:
                # Text first mirrors ``_build_user_message_content``'s order
                # and how vision providers expect the prompt to read.
                content_blocks: list[dict[str, Any]] = []
                joined = "".join(text_parts)
                if joined:
                    content_blocks.append({"type": "text", "text": joined})
                content_blocks.extend(image_blocks)
                out.append({"role": "user", "content": content_blocks})
            elif text_parts:
                out.append(
                    {
                        "role": "user",
                        "content": "".join(text_parts),
                    }
                )
            continue

        # System (or unknown role) · stringify best-effort.
        text_parts = [
            str(b.get("text", ""))
            for b in blocks
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        out.append({"role": m.role, "content": "".join(text_parts)})
    return out


def _image_block_to_openai(block: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize one image block to OpenAI's ``image_url`` shape.

    Accepts both the OpenAI shape we build internally and the Anthropic
    ``{"type": "image", "source": {...}}`` variant, so a message that took
    a detour through an Anthropic-shaped path still delivers its picture.
    Returns ``None`` when the block carries no usable reference — dropping
    an empty block beats sending one the upstream will 400 on.
    """
    if block.get("type") == "image_url":
        raw = block.get("image_url")
        url = raw.get("url") if isinstance(raw, dict) else raw
        if not isinstance(url, str) or not url:
            return None
        return {"type": "image_url", "image_url": {"url": url}}
    source = block.get("source")
    if not isinstance(source, dict):
        return None
    if source.get("type") == "url":
        url = source.get("url")
        return (
            {"type": "image_url", "image_url": {"url": url}}
            if isinstance(url, str) and url
            else None
        )
    data = source.get("data")
    if not isinstance(data, str) or not data:
        return None
    media_type = str(source.get("media_type") or "image/png")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{media_type};base64,{data}"},
    }


def _attach_images_to_last_user_openai(
    msgs: list[dict[str, Any]],
    images_b64: list[str],
) -> None:
    for i in range(len(msgs) - 1, -1, -1):
        if msgs[i].get("role") == "user":
            existing = msgs[i].get("content", "")
            screenshots: list[dict[str, Any]] = [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{b64}"},
                }
                for b64 in images_b64
            ]
            if isinstance(existing, list):
                # The message already carries multimodal blocks (a user
                # upload). Append the screenshots instead of wrapping the
                # whole list into a text block, which would both stringify
                # the upload away and 400 on strict providers.
                msgs[i]["content"] = list(existing) + screenshots
                return
            blocks: list[dict[str, Any]] = list(screenshots)
            if existing:
                blocks.append({"type": "text", "text": existing})
            msgs[i]["content"] = blocks
            return


_OPENAI_REASONING_EFFORT: dict[str, str] = {
    "minimal": "minimal",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "xhigh": "high",
    "max": "high",
}
