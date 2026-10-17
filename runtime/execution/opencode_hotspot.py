"""Isolated OpenCode conversation roles using the verified public Zen model."""

import asyncio
import hashlib
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from runtime.execution import opencode_backend as native
from runtime.safety.auth.scope import TenantScope


@dataclass(frozen=True)
class OpenCodeRemoteConfig:
    data_dir: Path
    model: str = "big-pickle"
    permission_mode: str = "text-only"
    timeout: float = 300
    # The owner who opened this role, read per turn; their saved OpenCode Zen
    # key answers its turns. Zen's free models refuse a request with no key.
    owner_scope: Callable[[], TenantScope | None] = lambda: None


async def stream_opencode(
    config, *, prompt, workspace, resume=None
) -> AsyncGenerator[dict[str, Any], None]:
    command = native.executable()
    if not command:
        raise native.OpenCodeError("未找到本机 OpenCode 引擎")
    key = native.model_key(config.owner_scope(), config.model)
    if not key:
        raise native.OpenCodeError(native.ZEN_KEY_REQUIRED_MESSAGE)
    root = (
        config.data_dir / "runtime" / hashlib.sha256(str(workspace.resolve()).encode()).hexdigest()
    )
    text = ""
    async with asyncio.timeout(config.timeout):
        async with native.managed_server(command, root, key, config.model) as client:
            await native.validate_catalog_model(client, config.model, free_only=True)
            session = await native.session_for_thread(client, root)
            async for event in native.stream_prompt(
                client,
                session,
                text=prompt,
                system="Answer the delegated conversation task. Tools are unavailable.",
                model=config.model,
                interrupted=lambda: False,
            ):
                if event.get("type") == "text_delta":
                    delta = str(event.get("delta") or "")
                    text += delta
                    yield {
                        "type": "stream_event",
                        "event": {"delta": {"type": "text_delta", "text": delta}},
                    }
                elif event.get("type") == "react_completed":
                    yield {
                        "type": "result",
                        "subtype": "success",
                        "result": text,
                        "is_error": False,
                    }
