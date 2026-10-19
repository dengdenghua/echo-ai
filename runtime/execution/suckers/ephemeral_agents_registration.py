"""Split out of :mod:`ephemeral_agents` so that module stays under the 1000-line
god-file ratchet. Everything here is re-exported by the original module, so
import sites do not move.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_log = logging.getLogger("runtime.execution.ephemeral")


def _coerce_tool_names(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        for sep in ("，", "、", ";", "\n", "\t"):
            raw = raw.replace(sep, ",")
        return [part.strip() for part in raw.split(",") if part.strip()]
    if isinstance(value, (list, tuple, set)):
        out: list[str] = []
        for item in value:
            out.extend(_coerce_tool_names(item))
        return out
    return [str(value).strip()] if str(value).strip() else []


def _dedupe_tool_names(names: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for name in names:
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


def _effective_tool_allowlist(
    role: EphemeralRoleDef,
    context: dict[str, Any] | None,
) -> list[str]:
    from runtime.execution.misc.skill_policy import resolve_context_tool_policy

    policy = resolve_context_tool_policy(
        role_allowlist=role.tool_allowlist,
        context=context,
    )
    if policy.allow_all:
        return []
    return list(policy.allowed)


def _effective_tool_policy(
    role: EphemeralRoleDef,
    context: dict[str, Any] | None,
):
    from runtime.execution.misc.skill_policy import resolve_context_tool_policy

    return resolve_context_tool_policy(
        role_allowlist=role.tool_allowlist,
        context=context,
    )


def _format_dynamic_skill_grant_note(
    context: dict[str, Any],
    allowlist: list[str],
) -> str:
    parts: list[str] = []
    packs = _coerce_tool_names(context.get("skill_pack_names"))
    plugins = _coerce_tool_names(context.get("plugin_grants"))
    direct = _coerce_tool_names(context.get("direct_skill_grants"))
    if packs:
        parts.append(f"Skill packs: {', '.join(packs)}.")
    if plugins:
        parts.append(f"Plugin grants requested: {', '.join(plugins)}.")
    if direct:
        parts.append(f"Direct skills: {', '.join(direct)}.")
    mode = str(context.get("tool_allowlist_mode") or "").strip().lower()
    if mode in {"all", "full", "inherit_all", "*"}:
        parts.append("Tool access: full available sub-agent tool catalog.")
    elif allowlist:
        parts.append(f"Effective tools: {', '.join(allowlist)}.")
    if not parts:
        return ""
    return (
        "The main agent granted these capabilities for this subtask. "
        "Use them only when they help complete the assignment; if a "
        "needed capability is absent, state the gap clearly.\n\n"
        + "\n".join(f"- {part}" for part in parts)
    )


def _null_ephemeral_runner(call: EphemeralCall) -> str:
    """Default runner · returns a "not configured" marker. Wiring a
    real LLM runner is bootstrap's responsibility (see
    ``set_ephemeral_role_runner``)."""
    raise RuntimeError(
        "ephemeral sub-agent runner not configured · "
        "call set_ephemeral_role_runner(fn) during bootstrap"
    )


def _collect_caller_context(session: Any) -> list[dict[str, str]]:
    """Pull recent messages from the caller's thread · best-effort.

    Returns a list of ``{"type": "human|ai", "content": str}`` dicts.
    If the session or thread store isn't reachable, returns empty.

    Session is a slotted dataclass so we can't monkey-attach extras ·
    we read from ``session.metadata`` which is the documented
    extension surface. The thread_compat router stamps both
    ``recent_messages`` and ``thread_store`` onto metadata before
    dispatching the tool call.
    """
    if session is None:
        return []
    meta = getattr(session, "metadata", None) or {}
    if not isinstance(meta, dict):
        return []
    # Primary · caller already has the message list in hand · cheapest.
    msgs = meta.get("recent_messages")
    if isinstance(msgs, list):
        return [m for m in msgs if isinstance(m, dict)][-20:]

    # Fallback · look up the thread from a stored handle.
    thread_id = getattr(session, "thread_id", None)
    store = meta.get("thread_store")
    if thread_id and store is not None:
        try:
            thread = store.get(thread_id)
        except (TypeError, ValueError, KeyError):  # noqa: BLE001
            return []
        if thread:
            values = thread.get("values") if isinstance(thread, dict) else None
            if isinstance(values, dict):
                raw = values.get("messages") or []
                if isinstance(raw, list):
                    return [m for m in raw if isinstance(m, dict)][-20:]
    return []


def _collect_caller_memory(session: Any) -> str:
    """Pull caller agent's three-tier memory (global / project /
    agent) as a concatenated markdown block. Returns ``""`` if
    session has no agent or the memory paths don't resolve."""
    if session is None:
        return ""
    agent = getattr(session, "agent", None)
    if agent is None:
        return ""
    try:
        from runtime.execution.agents.loader import _memory_tier_paths
    except (ImportError, TypeError, ValueError, AttributeError):
        return ""
    agent_dir_name = getattr(agent, "agent_id", None)
    if not agent_dir_name:
        return ""
    from pathlib import Path

    # Walk up from this file to find repo root (same strategy as
    # other skills).
    repo = Path(__file__).resolve()
    for parent in repo.parents:
        if (parent / "agents").is_dir() and (parent / "runtime").is_dir():
            root = parent
            break
    else:
        return ""
    agent_dir = root / "agents" / agent_dir_name
    core = agent_dir / "agent-core"
    if not core.exists():
        return ""
    pieces: list[str] = []
    for tier, path in _memory_tier_paths(agent_dir, core):
        if path.is_file():
            try:
                txt = path.read_text(encoding="utf-8").strip()
            except (OSError, UnicodeDecodeError):
                continue
            if txt:
                pieces.append(f"## Memory ({tier})\n\n{txt}")
    return "\n\n".join(pieces)


def _compose_system_prompt(
    role: EphemeralRoleDef,
    session: Any,
    context: dict[str, Any] | None = None,
) -> str:
    """Build the full system prompt injected into the ephemeral LLM
    turn. Structure:

        <role system_prompt>

        ## Topology-specific instructions (if context.system_addendum)
        <system_addendum>

        ## Granted Skills (if dynamic skill grant note present)

        ## Prior turns in this thread (if thread_id + role memory present)
        <last N subagent turns for this (thread, role) — preserves
         "dig deeper on that patent" continuity>

        ## Caller conversation (if share_context)
        <last N messages>

        ## Inherited memory (if share_memory)
        <three tiers>
    """
    parts: list[str] = [role.system_prompt]

    # Tool-use contract for multi-agent sub-agents. The single-agent react
    # loop injects ``_TOOL_USE_CONTRACT`` (react_prompt_assembly_sections.py);
    # this lane bypasses that assembly (react_stack is None → mini-loop), so
    # inject an equivalent "default to tools" instruction here. Gated on the
    # sub-agent actually holding tools (set by ``run_ephemeral_definition``) —
    # a tool-less role is never told to call tools it doesn't have.
    if (context or {}).get("_ephemeral_tools_available"):
        parts.append(
            "## Tool use contract\n\n"
            "You have tools available in this turn and are expected to use "
            "them. Any task that requires searching, reading, computing, "
            "verifying, retrieving, or acting on information MUST call the "
            "appropriate tool first and base your answer on its Observation. "
            "Do not end the turn with an announcement instead of an action — "
            'phrases like "I will check…", "I\'ll continue…", "Let me look '
            'into…", or "I\'ll proceed to…" are not answers. If the tools are '
            "available, use them before you respond."
        )
    addendum = (context or {}).get("system_addendum")
    if isinstance(addendum, str) and addendum.strip():
        parts.append(
            "## Topology-specific instructions\n\n"
            "These instructions override the generic role template when they "
            "conflict.\n\n"
            f"{addendum.strip()}"
        )

    # Hierarchical delegation guidance: when this sub-agent is allowed to spawn
    # its own sub-agents, inject role-specific orchestration guidance.
    delegation_guidance = (context or {}).get("delegation_guidance")
    if isinstance(delegation_guidance, str) and delegation_guidance.strip():
        parts.append(
            "## Hierarchical Orchestration\n\n"
            "You can delegate work to specialist sub-agents using `call_agent_parallel`. "
            "Use this capability to decompose your task into parallel dimensions.\n\n"
            f"{delegation_guidance.strip()}"
        )

    workspace_path = (context or {}).get("workspace_path")
    delivery_roles = {"generator", "implementer", "synthesizer"}
    if role.id in delivery_roles and isinstance(workspace_path, str) and workspace_path.strip():
        try:
            workspace_root = Path(workspace_path).expanduser().resolve()
            task_path = (workspace_root / "TASK.md").resolve()
            if task_path.parent == workspace_root and task_path.is_file():
                task_contract = task_path.read_text(encoding="utf-8")[:12_000].strip()
                if task_contract:
                    parts.append(
                        "## Workspace task contract (TASK.md)\n\n"
                        "This is part of the caller's task, not optional background. "
                        "Satisfy every machine-checkable deliverable before returning. "
                        "If it names an output file or exact path, use the workspace "
                        "file tools to write that file and read it back; a prose-only "
                        "answer does not satisfy the contract.\n\n"
                        f"{task_contract}"
                    )
        except (OSError, RuntimeError, UnicodeError):
            _log.debug("workspace TASK.md injection skipped", exc_info=True)
    grant_note = (context or {}).get("dynamic_skill_grant_note")
    if isinstance(grant_note, str) and grant_note.strip():
        parts.append("## Granted Skills\n\n" + grant_note.strip())

    # Inject per-role, per-thread subagent memory so multi-turn calls
    # (e.g., "researcher, dig deeper on that patent") can reference prior
    # outputs. Memory is keyed by (thread_id, role_id) and bounded to the
    # last MAX_TURNS_PER_KEY turns. Disabled when context explicitly says
    # ``share_history: false`` or when no thread_id is present.
    # Verifier context-starvation. Set by the trusted vote path only (the key
    # canonicalises under the ``subagentpolicy`` protected prefix, so a model
    # cannot set or clear it). It overrides the role definition's own
    # share_context / share_memory: an independent judge must not be able to
    # read the reasoning it was spawned to check, and picking a role whose
    # definition happens to share context must not silently re-open that.
    starved = bool((context or {}).get("subagent_policy_starve_context"))
    steward_managed = bool((context or {}).get("context_steward_managed"))
    thread_id = (context or {}).get("thread_id") or getattr(session, "thread_id", None)
    share_history = (
        (context or {}).get("share_history", True) and not starved and not steward_managed
    )
    if thread_id and share_history:
        from runtime.execution.subagents.memory import recent_turns_prompt

        history_prefix = recent_turns_prompt(str(thread_id), role.id)
        if history_prefix:
            parts.append(history_prefix.strip())

    if role.share_context and not starved and not steward_managed:
        msgs = _collect_caller_context(session)
        if msgs:
            rendered_lines: list[str] = ["## Caller conversation"]
            for m in msgs:
                who = "User" if m.get("type") == "human" else "Main agent"
                content = m.get("content")
                if isinstance(content, list):
                    # Multi-block message content · flatten text
                    content = " ".join(
                        b.get("text", "")
                        for b in content
                        if isinstance(b, dict) and b.get("type") == "text"
                    )
                if not isinstance(content, str):
                    continue
                content = content.strip()
                if not content:
                    continue
                rendered_lines.append(f"**{who}**: {content[:1000]}")
            if len(rendered_lines) > 1:
                parts.append(
                    "\n\n".join(
                        [rendered_lines[0], "\n".join(rendered_lines[1:])],
                    )
                )

    if role.share_memory and not starved and not steward_managed:
        mem = _collect_caller_memory(session)
        if mem:
            parts.append(mem)

    return "\n\n---\n\n".join(parts)


def _emit_incomplete_to_bus(role_id: str, partial_text: str, rounds: int, reason: str) -> None:
    """Fire-and-forget mirror of an incomplete sub-agent outcome onto the
    typed event bus so the Workbench can render it as an incomplete tile.
    """
    try:
        from runtime.execution.subagents.event_bus import (
            EVT_SUB_INCOMPLETE,
            publish_subagent_event,
        )

        publish_subagent_event(
            EVT_SUB_INCOMPLETE,
            {
                "role": role_id,
                "reason": reason,
                "rounds": rounds,
                "partial_chars": len(partial_text),
            },
        )
    except Exception:  # noqa: BLE001 · telemetry loss never breaks the runner
        pass


@dataclass(frozen=True)
class EphemeralRoleDef:
    """Everything needed to spin up an ephemeral sub-agent turn.

    Deliberately frozen + hashable so the catalog can live as a
    module-level dict without accidental mutation at runtime.
    """

    id: str
    display_name: str
    description: str
    system_prompt: str
    # Pull caller's recent conversation messages into the sub-agent's
    # context. Almost always True for "look at what we were talking
    # about and continue" roles (reviewer / debugger). False for
    # fresh-topic roles (researcher given an unrelated topic).
    share_context: bool = True
    # Pull caller agent's three-tier memory (global / project /
    # agent) into the prompt. True for roles that need project
    # awareness (architect, reviewer). False for roles that should
    # think in a vacuum.
    share_memory: bool = True
    # Optional narrow tool list · empty = inherit caller's.
    tool_allowlist: tuple[str, ...] = ()


@dataclass
class EphemeralCall:
    """Everything the runner needs to execute a role turn.

    The ``composed_system_prompt`` already has:
    - role's own ``system_prompt``
    - caller's conversation history (if ``role.share_context``)
    - caller agent's memory (if ``role.share_memory``)

    The runner just has to feed this to an LLM and return the text.
    """

    role: EphemeralRoleDef
    user_prompt: str
    composed_system_prompt: str
    caller_thread_id: str
    caller_agent_id: str
    context: dict[str, Any]
