"""Official CodeBuddy CLI transport; Echo owns history, tools and approvals."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import AsyncIterator, Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

from runtime.execution.codebuddy_events import CodeBuddyError, CodeBuddyEvents
from runtime.execution.host_mcp_connection import HostMCPConnection
from runtime.execution.engine_packages.store import installed_executable
from runtime.execution.engine_packages.versions import leased
from runtime.execution.engine_packages.node_runtime import node_executable


def executable() -> str | None:
    if managed := installed_executable("codebuddy"):
        return managed
    if configured := os.environ.get("ECHO_CODEBUDDY_BIN"):
        path = Path(configured).expanduser()
        return str(path.resolve()) if path.is_file() else None
    found = shutil.which("codebuddy.cmd" if os.name == "nt" else "codebuddy")
    if not found and os.name == "nt":
        candidate = Path(os.environ.get("APPDATA", "")) / "npm/codebuddy.cmd"
        found = str(candidate) if candidate.is_file() else None
    return found


def command(binary: str) -> list[str]:
    path = Path(binary)
    if path.suffix.lower() in {".cmd", ".bat"}:
        # Never execute a shell command string. Invoke the npm package with Node,
        # preserving empty --tools arguments and paths with spaces on Windows.
        entry = path.parent / "node_modules/@tencent-ai/codebuddy-code/bin/codebuddy"
        node = node_executable()
        if not node or not entry.is_file():
            raise CodeBuddyError("CodeBuddy npm 安装不完整，请重新安装官方 CLI。")
        return [node, str(entry)]
    if path.suffix.lower() in {".js", ".mjs", ".cjs"} or path.name == "codebuddy":
        if not (node := node_executable()):
            raise CodeBuddyError("CodeBuddy 需要 Node.js。")
        return [node, str(path)]
    return [binary]


def inspect_readiness(scope: Any = None) -> dict[str, Any]:
    # A machine's CLI account must never become a hosted tenant's account.
    if os.environ.get("ECHO_DEPLOYMENT_MODE", "local").strip().lower() != "local":
        return {
            "available": False,
            "reason_code": "local_only",
            "reason": "CodeBuddy CLI 目前仅支持本机模式。",
        }
    if not (binary := executable()):
        return {
            "available": False,
            "reason_code": "not_installed",
            "reason": "请先安装 CodeBuddy CLI，并在终端运行 codebuddy 完成登录。",
        }
    try:
        command(binary)
    except CodeBuddyError as exc:
        return {"available": False, "reason_code": "invalid_install", "reason": str(exc)}
    return {
        "available": True,
        "reason_code": None,
        "reason": None,
        "authentication": "cli_managed",
        "billing": "codebuddy_official",
    }


@lru_cache(maxsize=4)
def _models(binary: str, modified: tuple) -> tuple[str, ...]:
    try:
        result = subprocess.run(
            command(binary) + ["--help"],
            env=child_environment(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}),
        )
        match = re.search(r"Currently supported:\s*\(([^)]+)\)", result.stdout)
        models = (
            tuple(item.strip() for item in match[1].split(",") if item.strip()) if match else ()
        )
        if result.returncode != 0 or not models:
            raise CodeBuddyError("无法读取 CodeBuddy 官方模型列表，请重试。")
        return models
    except (OSError, subprocess.SubprocessError) as exc:
        # lru_cache must retain successful discovery only. Caching () would make
        # a temporary startup/timeout failure persist until the backend restarts.
        raise CodeBuddyError("无法读取 CodeBuddy 官方模型列表，请重试。") from exc


def _catalog_signature(binary: str) -> tuple:
    # Official login changes account/product routing without changing the CLI.
    # Fingerprint file metadata only; never load or expose account credentials.
    paths = [*map(Path, command(binary)), Path.home() / ".codebuddy/settings.json"]
    signature = []
    for path in paths:
        try:
            info = path.stat()
            signature.append((str(path), info.st_mtime_ns, info.st_size))
        except FileNotFoundError:
            signature.append((str(path), None, None))
    return tuple(signature)


@lru_cache(maxsize=4)
def _control_capabilities(binary: str, signature: tuple) -> dict:
    try:
        result = subprocess.run(command(binary) + ["--help"], env=child_environment(),
            capture_output=True, text=True, encoding="utf8", errors="replace", timeout=10,
            **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
        help_text = result.stdout if result.returncode == 0 else ""
        return {"effort": "--effort <" in help_text, "autocompact": "--autocompact <" in help_text}
    except (OSError, subprocess.SubprocessError, CodeBuddyError):
        return {"effort": False, "autocompact": False}


def control_capabilities() -> dict:
    binary = executable()
    return _control_capabilities(binary, _catalog_signature(binary)) if binary else {"effort": False, "autocompact": False}


def model_catalog() -> list[str]:
    if not inspect_readiness()["available"] or not (binary := executable()):
        return []
    try:
        return [
            model
            for model in _models(binary, _catalog_signature(binary))
            if not model.startswith("custom-local:")
        ]
    except (OSError, CodeBuddyError):
        return []


def resolve_model(selection: str | None) -> str:
    if selection in {None, "", "auto"}:
        return "auto"
    if not selection.startswith("codebuddy/"):
        raise CodeBuddyError("请选择 CodeBuddy 模型，或使用其默认模型。")
    model = selection.removeprefix("codebuddy/")
    if not model or model.startswith("-") or len(model) > 160 or any(c.isspace() for c in model):
        raise CodeBuddyError("CodeBuddy 模型名称无效。")
    if model.startswith("custom-local:"):
        raise CodeBuddyError("Echo 的 CodeBuddy 引擎使用官方积分通道，请选择官方模型。")
    return model


def child_environment() -> dict[str, str]:
    env = dict(os.environ)
    # Echo uses the Chinese official account/credits. Never inherit custom API
    # credentials, endpoint overrides, or model routing from a shell or settings.
    for name in (
        "CODEBUDDY_API_KEY",
        "CODEBUDDY_AUTH_TOKEN",
        "CODEBUDDY_BASE_URL",
        "CODEBUDDY_MODEL",
        "CODEBUDDY_BIG_SLOW_MODEL",
        "CODEBUDDY_SMALL_FAST_MODEL",
        "CODEBUDDY_CODE_SUBAGENT_MODEL",
        "CODEBUDDY_CUSTOM_HEADERS",
        "CODEBUDDY_RESOURCE_BASE_URL",
        "ACC_PRODUCT_CONFIG_PATH",
        "ACC_PRODUCT_CONFIG",
        "ACC_PRODUCT_CONFIG_V2",
        "ACC_PRODUCT_CONFIG_V3",
    ):
        env.pop(name, None)
    env["CODEBUDDY_INTERNET_ENVIRONMENT"] = "internal"
    # Keep the official CLI's login flow and credential storage; do not extract
    # tokens or emulate the provider's private model API.
    for name in ("CODEBUDDY_PLUGIN_DIRS", "NODE_OPTIONS", "NODE_PATH"):
        env.pop(name, None)
    env.update(
        {
            "DISABLE_AUTOUPDATER": "1",
            "DISABLE_TELEMETRY": "1",
            "CODEBUDDY_DISABLE_CRON": "1",
            "CODEBUDDY_DISABLE_AUTO_MEMORY": "1",
            "CODEBUDDY_CODE_DISABLE_AUTO_MEMORY": "1",
            "CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS": "1",
            "CODEBUDDY_DISABLE_BUILTIN_SUBAGENTS": "1",
            "CODEBUDDY_DISABLE_SHELL_SNAPSHOT": "1",
        }
    )
    if node := node_executable():
        env["PATH"] = str(Path(node).parent) + os.pathsep + env.get("PATH", "")
    return env


async def _stop(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        process.terminate()
    try:
        await asyncio.wait_for(process.wait(), 3)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        await process.wait()


@leased("codebuddy")
async def stream_prompt(
    *,
    text: str,
    system: str,
    model: str,
    interrupted: Callable[[], bool],
    host_mcp: HostMCPConnection | None = None,
    tool_names: dict[str, str] | None = None,
    reasoning_effort: str | None = None,
    autocompact: int | None = None,
) -> AsyncIterator[dict[str, Any]]:
    if reasoning_effort is not None and reasoning_effort not in {"minimal", "low", "medium", "high", "xhigh", "max"}:
        raise CodeBuddyError("不支持的 CodeBuddy 思考等级")
    if autocompact is not None and (type(autocompact) is not int or not 100000 <= autocompact <= 1000000):
        raise CodeBuddyError("自动压缩预算必须在 100K 到 1M 之间")
    ready = inspect_readiness()
    if not ready["available"]:
        raise CodeBuddyError(ready["reason"])
    if interrupted():
        raise asyncio.CancelledError()
    from runtime.execution.codebuddy_model_capabilities import model_capabilities
    capability = await asyncio.to_thread(model_capabilities, [model])
    selected = capability.get(model)
    if selected is not None:
        if reasoning_effort not in selected["reasoning_efforts"]:
            reasoning_effort = selected.get("default_reasoning_effort")
        window = selected.get("context_window")
        if autocompact is not None and window and autocompact > window:
            autocompact = window if window >= 100000 else None
    reducer = CodeBuddyEvents(tool_names=tool_names or {}, model=model)
    # Fresh cwd: no repository hooks/configs/plugins; Echo supplies instructions
    # and conversation history explicitly. The temporary MCP bearer never enters
    # process arguments or durable engine configuration.
    with tempfile.TemporaryDirectory(prefix="echo-codebuddy-") as temp:
        root = Path(temp)
        config = {
            "mcpServers": {
                "echo": {
                    "type": "http",
                    "defer_loading": False,
                    "url": host_mcp.url,
                    "headers": {"Authorization": f"Bearer {host_mcp.token}"},
                }
            }
            if host_mcp
            else {}
        }
        config_path = root / "mcp.json"
        config_path.write_text(json.dumps(config), encoding="utf-8")
        config_path.chmod(0o600)
        system_path = root / "system.txt"
        system_path.write_text(system, encoding="utf-8")
        # NoDefer is required: disabling native ToolSearch otherwise hides MCP
        # tools too, even though the MCP server is connected. Exact names also
        # keep every native tool outside the model-visible whitelist.
        argv = command(executable()) + [
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--tools",
            ",".join(f"NoDefer({name})" for name in reducer.tool_names),
            "--strict-mcp-config",
            "--mcp-config",
            str(config_path),
            "--permission-mode",
            "dontAsk",
            # Empty means DEFAULT scopes in the official CLI, not no scopes.
            # Only a nonexistent local file in this fresh temp cwd is allowed.
            "--setting-sources",
            "local",
            "--settings",
            json.dumps({"disableAllHooks": True, "enabledPlugins": {}}),
            "--system-prompt-file",
            str(system_path),
            "--no-session-persistence",
        ]
        if reducer.tool_names:
            argv += ["--allowedTools", ",".join(reducer.tool_names)]
        if reasoning_effort is not None:
            argv += ["--effort", reasoning_effort]
        if autocompact is not None:
            argv += ["--autocompact", str(autocompact)]
        if model != "auto":
            argv += ["--model", model]
        process = await asyncio.create_subprocess_exec(
            *argv,
            cwd=root,
            env=child_environment(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            limit=4 * 1024 * 1024,
            **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}),
        )
        pending = None
        terminal = None
        try:
            process.stdin.write(text.encode("utf-8"))
            await process.stdin.drain()
            process.stdin.close()
            while True:
                if interrupted():
                    raise asyncio.CancelledError()
                if pending is None:
                    pending = asyncio.create_task(process.stdout.readline())
                if not (await asyncio.wait({pending}, timeout=0.1))[0]:
                    continue
                line, pending = pending.result(), None
                if not line:
                    break
                try:
                    message = json.loads(line)
                except (ValueError, UnicodeDecodeError) as exc:
                    raise CodeBuddyError("CodeBuddy 返回了无效的流式消息。") from exc
                if not isinstance(message, dict):
                    raise CodeBuddyError("CodeBuddy 返回了无效的消息结构。")
                for event in reducer.consume(message):
                    if event["type"] == "react_completed":
                        terminal = event
                        terminal["completion_receipt"]["effective_controls"] = {
                            "reasoning_effort": reasoning_effort,
                            "auto_compact_token_limit": autocompact,
                            "context_window": selected.get("context_window") if selected else None,
                        }
                    else:
                        yield event
            if await process.wait() != 0 or terminal is None:
                raise CodeBuddyError("CodeBuddy 启动或执行失败，请在终端检查登录和积分状态。")
            yield terminal
        finally:
            if pending:
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
            await _stop(process)
