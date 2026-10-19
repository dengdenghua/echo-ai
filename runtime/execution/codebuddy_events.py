"""Reduce official CodeBuddy stream-json messages into Echo turn events."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any


class CodeBuddyError(RuntimeError):
    """An engine failure safe to display without raw upstream output."""


@dataclass
class CodeBuddyEvents:
    tool_names: dict[str, str] = field(default_factory=dict)
    messages: set[str] = field(default_factory=set)
    snapshots: dict[str, str] = field(default_factory=dict)
    tools: dict[str, str] = field(default_factory=dict)
    ended: set[str] = field(default_factory=set)
    text: str = ""
    partial: str = ""
    completed: bool = False
    model: str = "auto"

    def consume(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        kind = message.get("type")
        if self.completed and message.get("type") == "system":
            return []  # The official CLI repeats init metadata while shutting down.
        if self.completed:
            raise CodeBuddyError("CodeBuddy 在回合结束后发送了额外消息。")
        if message.get("parent_tool_use_id"):
            raise CodeBuddyError("CodeBuddy 返回了未授权的内置子代理消息。")
        if kind == "stream_event":
            event = message.get("event") or {}
            delta = event.get("delta") or {}
            if event.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                value = delta.get("text", "")
                if isinstance(value, str) and value:
                    self.partial += value
                    self.text += value
                    return [{"type": "text_delta", "delta": value}]
            return []
        if kind in {"assistant", "user"}:
            return self._message(message)
        if kind == "result":
            return self._result(message)
        if kind == "system" and message.get("subtype") == "init":
            if isinstance(message.get("model"), str):
                self.model = message["model"]
            for server in message.get("mcp_servers", []):
                if server.get("name") == "echo" and server.get("status") != "connected":
                    raise CodeBuddyError("CodeBuddy 未能连接 Echo 工具。")
        return []

    def _message(self, envelope: dict[str, Any]) -> list[dict[str, Any]]:
        message = envelope.get("message") or {}
        identity = str(message.get("id") or envelope.get("uuid") or "")
        fingerprint = hashlib.sha256(json.dumps(message, sort_keys=True).encode()).hexdigest()
        if fingerprint in self.messages:
            return []
        self.messages.add(fingerprint)
        events = []
        content = message.get("content") or []
        if not isinstance(content, list) or any(not isinstance(block, dict) for block in content):
            raise CodeBuddyError("CodeBuddy 返回了无效的消息内容。")
        if envelope["type"] == "assistant":
            text = "".join(
                str(block.get("text") or "") for block in content if block.get("type") == "text"
            )
            old = self.snapshots.get(identity, "") if identity else ""
            if not text.startswith(old):
                raise CodeBuddyError("CodeBuddy 回答快照不一致。")
            self.snapshots[identity] = text
            novel = text[len(old) :]
            # A complete assistant snapshot repeats preceding stream deltas.
            if self.partial and novel:
                if not novel.startswith(self.partial):
                    raise CodeBuddyError("CodeBuddy 流式回答与最终消息不一致。")
                novel, self.partial = novel[len(self.partial) :], ""
            if novel:
                self.text += novel
                events.append({"type": "text_delta", "delta": novel})
        for block in content:
            if block.get("type") == "tool_use":
                call_id, native = str(block.get("id") or ""), str(block.get("name") or "")
                if not call_id or native not in self.tool_names:
                    raise CodeBuddyError("CodeBuddy 请求了未授权的工具，本轮已停止。")
                if call_id not in self.tools:
                    self.tools[call_id] = self.tool_names[native]
                    events.append(
                        {
                            "type": "tool_start",
                            "tool_name": self.tools[call_id],
                            "tool_call_id": call_id,
                            "input_preview": block.get("input", {}),
                        }
                    )
            elif block.get("type") == "tool_result":
                call_id = str(block.get("tool_use_id") or "")
                if call_id in self.tools and call_id not in self.ended:
                    self.ended.add(call_id)
                    success = not block.get("is_error", False)
                    events.append(
                        {
                            "type": "tool_end",
                            "tool_name": self.tools[call_id],
                            "tool_call_id": call_id,
                            "success": success,
                            "status": "success" if success else "error",
                            "output_preview": str(block.get("content") or "")[:2000],
                        }
                    )
        return events

    def _result(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        if message.get("is_error") or message.get("subtype") != "success":
            raise CodeBuddyError("CodeBuddy 未完成本次任务，请检查登录、积分或模型设置。")
        if self.tools.keys() - self.ended:
            raise CodeBuddyError("CodeBuddy 仍有未完成的工具调用，本轮未完成。")
        events = []
        if not self.text.strip() and isinstance(message.get("result"), str):
            self.text = message["result"]
            events.append({"type": "text_delta", "delta": self.text})
        if not self.text.strip():
            raise CodeBuddyError("CodeBuddy 没有返回回答。")
        self.completed = True
        events.append(
            {
                "type": "react_completed",
                "success": True,
                "terminated_reason": "completed",
                "completion_receipt": {
                    "engine": "codebuddy",
                    "model": self.model,
                    "tokens": self._tokens(message.get("usage")),
                },
            }
        )
        return events

    @staticmethod
    def _tokens(usage: Any) -> dict[str, Any] | None:
        if not isinstance(usage, dict):
            return None

        def count(key: str) -> int:
            value = usage.get(key, 0)
            return value if type(value) is int and value >= 0 else 0

        return {
            "input": count("input_tokens"),
            "output": count("output_tokens"),
            "cache": {
                "read": count("cache_read_input_tokens"),
                "write": count("cache_creation_input_tokens"),
            },
        }
