from __future__ import annotations

import inspect
import re
from typing import Any

from runtime.execution.suckers import Skill, SkillExpect, SkillRegistry, SkillTestCase
from runtime.safety.approval.cancellation import current_cancellation_token

from .client import MCPClient


def register_mcp_tools_as_skills(
    registry: SkillRegistry,
    client: MCPClient,
    *,
    name_prefix: str | None = None,
    include_golden_tests: bool = False,
    require_trust: bool = True,
    server_name: str | None = None,
    tenant_id: str | None = None,
    trust_store: Any = None,
) -> list[str]:
    registered: list[str] = []
    tools = client.list_tools()
    inferred_name = server_name
    if inferred_name is None and tools:
        inferred_name = getattr(tools[0], "server_name", None)
    effective_prefix = (
        name_prefix
        if name_prefix is not None
        else f"mcp_{_safe_name(str(inferred_name or 'server'))}_"
    )

    # Trust gate · supply-chain protection. An unknown MCP server
    # is untrusted until the user explicitly approves it via the
    # ``/api/mcp/trust`` endpoint (or programmatically via
    # ``get_trust_store().approve(...)``). This mirrors the
    if require_trust:
        if not inferred_name:
            import logging

            logging.getLogger("runtime.adapters.mcp_client.bridge").warning(
                "MCP server name missing; refusing to register %d tool(s)",
                len(tools),
            )
            return []
        if inferred_name:
            if trust_store is None:
                from .trust import get_trust_store

                store = get_trust_store(tenant_id)
            else:
                store = trust_store
            tool_names = [t.name for t in tools]
            if not store.is_approved(inferred_name, tool_names):
                import logging

                logging.getLogger(
                    "runtime.adapters.mcp_client.bridge",
                ).warning(
                    "MCP server %r not approved in trust store · "
                    "refusing to register its %d tool(s). Approve via "
                    "get_trust_store().approve(%r, tool_names).",
                    inferred_name,
                    len(tool_names),
                    inferred_name,
                )
                return []
    for tool in tools:
        skill_name = f"{effective_prefix}{tool.name}"
        handler = _make_handler_for(client, tool.name)

        # Discovery must not execute tools: empty arguments can be valid for
        # destructive operations (new document, disconnect, clear scene).
        # Executable smoke cases are an explicit opt-in for controlled tests.
        tests = []
        if include_golden_tests:
            tests.append(
                SkillTestCase(
                    name="returns_or_errors_cleanly",
                    tier="golden",
                    args={},
                    expect=SkillExpect(no_exception=True),
                )
            )

        # The server's own MCP ``annotations.readOnlyHint`` is the only
        # trustworthy read-only signal: tool names are server-chosen and
        # a name-based guess would both miss read tools with mutating
        # names and wrongly trust write tools with tame names. A declared
        # read-only tool gains the "read" affinity, which the skill gate's
        # side-effect classifier requires before a meta-skill
        # (execute_skill) may dispatch it. Absent/False hint ⇒ unchanged
        # fail-closed ["mcp", "external"]. getattr: duck-typed tools in
        # tests/third-party adapters may not carry the field.
        annotations = getattr(tool, "annotations", None)
        read_declared = isinstance(annotations, dict) and annotations.get("readOnlyHint") is True
        # Several MCP servers (blmcp among them) ship a headless twin for every
        # tool — ``*_for_cli`` — which shells out to ``<app> -b``. The two names
        # look interchangeable to a model, so "open Blender and read the scene"
        # silently ran headless with no window (2026-10-22). Label the twin
        # instead of hiding it: the capability stays, the choice gets informed.
        headless_hint = (
            " [headless: runs the app with `-b`, no window — prefer the tool"
            " without the _for_cli suffix when the user expects the UI]"
            if tool.name.endswith("_for_cli")
            else ""
        )
        skill = Skill(
            name=skill_name,
            description=(tool.description or f"MCP tool from {tool.server_name}") + headless_hint,
            affinity=(["mcp", "external", "read"] if read_declared else ["mcp", "external"]),
            cost_profile="mid",
            trusted_source=f"mcp://{tool.server_name}/{tool.name}",
            tenant_id=tenant_id,
            handler=handler,
            input_schema=getattr(tool, "input_schema", None),
            tests=tests,
        )
        try:
            registry.register(skill)
            registered.append(skill_name)
        except Exception:  # noqa: BLE001 - skill test failed, skip but don't crash
            continue
    return registered


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z_]+", "_", name.strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "server"


def _make_handler_for(client: MCPClient, tool_name: str) -> Any:

    def handler(**kwargs: Any) -> Any:
        filtered = {k: v for k, v in kwargs.items() if not k.startswith("_") and k != "intent_goal"}
        token = current_cancellation_token()
        call = client.call_tool
        if "cancellation" in inspect.signature(call).parameters:
            result = call(tool_name, filtered, cancellation=token)
        else:
            # Compatibility for lightweight third-party adapters. The
            # post-call fence below still prevents a late result from entering
            # a redirected turn, even if that adapter cannot abort in flight.
            result = call(tool_name, filtered)
        if getattr(result, "cancelled", False) or token.is_cancelled:
            reason = (
                getattr(result, "cancellation_reason", None) or token.reason or "turn redirected"
            )
            return {
                "error": f"cancelled: {reason}",
                "tool": tool_name,
                "status": "cancelled",
                "cancelled": True,
                "cancellation_reason": reason,
            }
        if not result.success:
            return {"error": result.error or "mcp_call_failed", "tool": tool_name}
        output = {"output": result.output, "tool": tool_name, "latency_ms": result.latency_ms}
        images = [
            block
            for block in getattr(result, "raw_content", [])
            if isinstance(block, dict) and block.get("type") == "image"
        ]
        if images:
            output["_mcp_images"] = images[:4]
        return output

    handler.__name__ = f"mcp_{tool_name}_handler"
    return handler
