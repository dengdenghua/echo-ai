"""Straight-line setup and nudge helpers of the native agentic tool loop.

Extracted verbatim from ``_tool_bridge_loop._stream_agentic_fallback_impl``
(mechanical, dataflow-checked extraction). Each helper receives exactly the
locals it reads as keyword arguments and returns the locals the loop reads
afterwards; names defined in ``_tool_bridge_loop`` itself (``_logger``,
``__file__``) are passed in so they resolve in that module as before.
"""

from __future__ import annotations

import contextlib
from uuid import uuid4

from runtime.core.cerebrum.capability_router import activate_capabilities
from runtime.core.cerebrum.react_native import require_public_update_on_tool_specs
from runtime.core.cerebrum.react_prompt_contracts import (
    STATIC_TURN_CONTRACTS,
    irreversible_turn_note_for,
)
from runtime.core.cerebrum.todo_protocol import (
    context_mode,
    render_todo_protocol_guidance,
    should_require_todo_protocol,
)
from runtime.execution.tool_spec_builder import build_anthropic_tool_specs
from runtime.sensing.model_router.models import Message

from ._tool_bridge_policy import (
    _filter_tool_specs_for_workspace_contract,
    _is_code_change_task,
    _is_evidence_task,
    _is_security_change_task,
    _native_tool_round_budget,
)
from ._tool_bridge_session import (
    _browser_operation_guidance,
    _ensure_explicit_browser_skills,
    _required_browser_action_evidence,
    _session_metadata_from_intent,
)


def _base_conversation_messages(*, intent, agent, __file__):
    """Conversation thread plus team roster and the agent's live SOUL prompt."""
    from .openai_gateway import (
        _conversation_messages_for_model,
        _profile_memories_payload,
    )

    messages: list[Message] = _conversation_messages_for_model(intent)

    try:
        from runtime.core.cerebrum.llm_planner import (
            _render_team_roster_section,
        )

        team_section = _render_team_roster_section(
            intent.user_context or {},
        )
    except (ImportError, AttributeError):
        team_section = ""
    if team_section:
        messages.insert(0, Message(role="system", content=team_section))

    if agent is not None and getattr(agent, "soul", None):
        # Re-read SOUL.md from disk on every turn so the
        # ``update_soul`` skill (agent rewriting its own scaffold)
        # takes effect on the very NEXT turn rather than only after
        # a process restart. Falls back to the cached ``agent.soul``
        # when the file isn't readable for any reason — keeps the
        # legacy behavior intact when no SOUL.md exists on disk.
        soul_text = agent.soul
        try:
            from pathlib import Path

            _agent_id = getattr(agent, "agent_id", "") or ""
            if _agent_id:
                _project_root = Path(__file__).resolve().parents[3]
                _soul_path = _project_root / "agents" / _agent_id / "agent-core" / "SOUL.md"
                if _soul_path.exists():
                    fresh = _soul_path.read_text(encoding="utf-8").strip()
                    if fresh:
                        soul_text = fresh
                        # Mirror back to the live Agent instance so
                        # other code reading agent.soul (display
                        # rendering, etc) sees the latest copy too.
                        with contextlib.suppress(AttributeError, TypeError):
                            agent.soul = fresh
        except (OSError, ValueError):  # noqa: BLE001 — soul file refresh failed; keep current soul text
            pass
        try:
            from runtime.execution.agents.loader import compose_runtime_soul

            soul_text = compose_runtime_soul(agent)
        except (ImportError, AttributeError):  # noqa: BLE001 — compose_runtime_soul unavailable; proceed without soul prefix
            pass
        messages.insert(0, Message(role="system", content=soul_text))
    return _profile_memories_payload, messages


def _insert_capability_assertions(*, messages, stack):
    """Anti-denial system notes for memory, delegation, skill-library and SOUL tools."""
    try:
        _has_mem = any(stack.executor.registry.has(n) for n in ("remember", "recall", "note_user"))
    except (AttributeError, TypeError, KeyError):
        _has_mem = False
    if _has_mem:
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "CAPABILITIES · cross-conversation memory:\n"
                    "You DO have persistent memory via the `remember`, "
                    "`recall`, and `note_user` tools. They write to "
                    "disk files that survive across turns and threads. "
                    "When the user asks you to remember something or "
                    "references past context, CALL THESE TOOLS — do "
                    "not say 'I don't have persistent memory' or 'each "
                    "conversation is fresh.' That denial was trained in "
                    "before you had these tools; it is no longer true.\n"
                    "- User asks to remember a fact → call `remember`\n"
                    "- User mentions a preference / style → call `note_user`\n"
                    "- User references past context → call `recall` first\n"
                ),
            ),
        )

    # Same anti-denial pattern for the `call_agent` (subagent
    # delegation) tool. Without this, when the user asks for multiple
    # delegations in one turn, Claude reflexively says "I don't have
    # the ability to dispatch to subagents" — which is false; the
    # tool is right there in its tool list. The denial happens because
    # the model's general training conflicts with the per-turn budget
    # (see delegation_skills.py). The capability assertion below tells
    # it: yes you have this, just use it sparingly per the rules.
    try:
        _has_delegation = stack.executor.registry.has("call_agent")
    except (AttributeError, TypeError, KeyError):
        _has_delegation = False
    if _has_delegation:
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "CAPABILITIES · sub-agent delegation:\n"
                    "You DO have a `call_agent` tool that spawns an "
                    "isolated specialist subagent (architect / "
                    "security-review). When the user asks you to "
                    "delegate something appropriate, CALL THE TOOL — "
                    "do not say 'I am Claude, I cannot dispatch to "
                    "subagents' or 'I don't have that capability.' "
                    "That denial is wrong; the tool is in your tool "
                    "list.\n"
                    "Delegation is optional, not a template. Use it only "
                    "when the task is large, long-running, or naturally "
                    "parallel. For one focused specialist task, call_agent "
                    "is enough. For several independent subtasks, prefer "
                    "the parallel delegation tool when available and choose "
                    "the number of subagents from the actual task split; "
                    "do not spawn helpers just to fill a fixed swarm shape."
                ),
            ),
        )

    # Same anti-denial pattern for the SOUL.md self-evolution
    # tools (`update_soul` / `revert_soul` / `list_soul_history`).
    # Without this assertion Claude reflexively says "I'm just an
    # LLM, I don't have a 'soul' file to edit" — which is wrong;
    # the agent's `agents/<id>/agent-core/SOUL.md` IS its persona
    # file, the tool exists in the spec, and writes/reverts there
    # actually persist into the next session's system prompt.
    try:
        _has_soul = stack.executor.registry.has("update_soul")
    except (AttributeError, TypeError, KeyError):
        _has_soul = False
    # Skill library capability assertion · same anti-denial pattern.
    # Agents reflexively want to "do it directly" instead of going
    # through apply_skill, leaking the template's discipline. This
    # tells them: when a learned skill matches the request, USE
    # apply_skill — don't ad-hoc reinvent the template every time.
    try:
        _has_skill_lib = stack.executor.registry.has("learn_skill_from_text")
    except (AttributeError, TypeError, KeyError):
        _has_skill_lib = False
    if _has_skill_lib:
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "CAPABILITIES · learned skill library:\n"
                    "You have a per-agent skill library at "
                    "agents/<your_id>/skills/. When the user asks for "
                    "output that matches a learned template (tech "
                    "comparison, report format, slide outline, anything "
                    "you've previously taught yourself via "
                    "`learn_skill_from_text`), DON'T re-invent the shape "
                    "from scratch. Workflow:\n"
                    "  1. `list_learned_skills` to see what you already "
                    "know. **This is free (0 tokens) — call it whenever "
                    "the user asks for structured output**.\n"
                    "  2. Pick the matching skill from that list.\n"
                    "  3. `apply_skill(name=<skill>, user_request=...)` "
                    "to produce the output. Pass the user's specific "
                    "request as user_request — apply_skill will fill in "
                    "the template for you.\n"
                    "  4. When LEARNING a new skill, pass "
                    "`golden_samples=['req A', 'req B', 'req C']` so the "
                    "C1 gate verifies the template actually reproduces "
                    "on 3 different topics before persisting. The skill "
                    "is dropped (not saved) if it fails the gate.\n\n"
                    "TRIGGERS · phrases that should ALWAYS make you "
                    "`list_learned_skills` first:\n"
                    '  · "write a report on…" / "写一份…报告"\n'
                    '  · "compare X and Y and Z" / "对比…/评估…"\n'
                    '  · "summarize X same as Y" / "像…一样写"\n'
                    '  · "做成 X 那样的" / "以后按这个格式做"\n'
                    '  · "同 Y 一样的" / "templatize this"\n\n'
                    "Do NOT manually compose markdown when a saved skill "
                    "covers the shape · the whole point of learning a "
                    "skill is to enforce its discipline on every reuse. "
                    "If the existing skill needs improvement, "
                    "`learn_skill_from_text` again to overwrite."
                ),
            ),
        )

    if _has_soul:
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "CAPABILITIES · self-evolution via SOUL.md:\n"
                    "You DO have `update_soul`, `revert_soul`, "
                    "`list_soul_history`, `recall_scores`, "
                    "`analyze_soul_impact`, `deep_reflect`, and "
                    "`deep_evolve` tools. They edit a real file at "
                    "agents/<your_id>/agent-core/SOUL.md that gets "
                    "auto-loaded into your system prompt on the very "
                    "NEXT turn (hot-reloaded · no restart needed). "
                    "Per-turn quality scores live in `.scores.jsonl` "
                    "next to it. When the user asks you to record a "
                    "self-lesson, roll back, inspect history, OR "
                    "evaluate your own performance — CALL THE TOOL. "
                    "Do not say 'I'm Claude, I don't have a soul' or "
                    "'I have no such tool.' Those denials are wrong; "
                    "the tools are in your tool list and they really "
                    "modify your future behavior. Every successful "
                    "update_soul auto-snapshots the prior state into "
                    ".soul_history/, so revert_soul is always safe.\n"
                    "Reflection cost ladder · pick the cheapest that "
                    "can answer the question:\n"
                    "  - `analyze_soul_impact` · zero LLM cost · "
                    "heuristic before/after delta on score history\n"
                    "  - `deep_reflect` · 1 cheap LLM call (~2-3¢) · "
                    "use when heuristic says 'inconclusive'\n"
                    "  - `deep_evolve` · expensive autonomous loop "
                    "(~10-30¢) · ONLY when user explicitly asks for "
                    "'deep evolution' / '深度演化' / similar. Default "
                    "dry_run=True · returns proposals without mutating "
                    "SOUL · review first, then re-run with dry_run=False "
                    "if you want to commit."
                ),
            ),
        )


def _insert_profile_and_memory_sections(
    *, _profile_memories_payload, intent, messages, agent, stack, _logger
):
    """Profile memories and MemoryHub recall; fall back to the bare goal."""
    from runtime.memory.users.profile import render_profile_memories

    profile_section = render_profile_memories(
        _profile_memories_payload(intent),
    )
    if profile_section:
        messages.insert(0, Message(role="system", content=profile_section))

    try:
        from runtime.memory.runtime_state.hub import (
            MemoryHub,
            MemoryQuery,
            format_records_for_prompt,
        )

        _metadata_for_memory = _session_metadata_from_intent(intent)
        _workspace_for_memory = _metadata_for_memory.get("workspace_path")
        _project_for_memory = (
            str(_workspace_for_memory).strip()
            if isinstance(_workspace_for_memory, str) and str(_workspace_for_memory).strip()
            else None
        )
        _agent_id_for_memory = (
            str(getattr(agent, "agent_id", "") or "") if agent is not None else None
        )
        _team_id_for_memory = _metadata_for_memory.get("team_id")
        _team_id_for_memory = (
            str(_team_id_for_memory).strip()
            if isinstance(_team_id_for_memory, str) and str(_team_id_for_memory).strip()
            else None
        )
        memory_section = format_records_for_prompt(
            MemoryHub(
                repo_root=_project_for_memory,
                planner=getattr(stack, "planner", None),
            ).retrieve(
                MemoryQuery(
                    text=intent.normalized_goal,
                    agent_id=_agent_id_for_memory,
                    project=_project_for_memory,
                    team_id=_team_id_for_memory,
                    limit=8,
                )
            ),
        )
    except Exception:  # noqa: BLE001 — best-effort; logged
        _logger.debug("memory hub prompt injection failed", exc_info=True)
        memory_section = ""
    if memory_section:
        messages.insert(0, Message(role="system", content=memory_section))

    if not messages:
        messages.append(
            Message(
                role="user",
                content=intent.normalized_goal,
            )
        )


def _insert_turn_contract_sections(*, intent, stack, agent, messages):
    """Design/browser/capability guidance, static turn contracts, loop discipline."""
    _intent_user_context = intent.user_context or {}
    from runtime.core.cerebrum.design_capabilities import design_instructions

    _design_prompt = design_instructions(
        intent.normalized_goal,
        context=_intent_user_context,
        registry=getattr(stack.executor, "registry", None),
        agent=agent,
    )
    if _design_prompt:
        messages.insert(0, Message(role="system", content=_design_prompt))
    _ensure_explicit_browser_skills(
        getattr(stack.executor, "registry", None),
        _intent_user_context,
    )
    _browser_prompt = _browser_operation_guidance(_intent_user_context)
    _browser_required_evidence = (
        _required_browser_action_evidence(intent.normalized_goal) if _browser_prompt else set()
    )
    if _browser_prompt:
        messages.insert(0, Message(role="system", content=_browser_prompt))
    _capability_activation = activate_capabilities(
        intent.normalized_goal,
        user_context=_intent_user_context,
        registry=getattr(stack.executor, "registry", None),
    )
    _capability_activation_prompt = _capability_activation.render_prompt()
    if _capability_activation_prompt:
        messages.insert(
            0,
            Message(
                role="system",
                content=_capability_activation_prompt,
            ),
        )
    # Output/turn contracts shared verbatim with the text-protocol prompt
    # assembly (`runtime/core/cerebrum/_react_prompt_assembly_sections.py`).
    # This native tool-call path builds its own prompt from scratch, so it
    # used to deliver *none* of them: the deliverable section, citation
    # routing, the destructive-action confirmation gate and the skill
    # selection order silently did not apply to every natively-routed turn.
    # Importing the same byte-stable tuple is the fix; the block has no
    # per-turn inputs, so it stays prompt-cache safe.
    messages.insert(
        0,
        Message(
            role="system",
            content="\n".join(STATIC_TURN_CONTRACTS),
        ),
    )
    # Turn A of the two-turn irreversible-action protocol. Per-turn and
    # volatile, so it is its own message and never merged into the static
    # block above.
    _irreversible_note = irreversible_turn_note_for(intent.normalized_goal)
    if _irreversible_note:
        messages.insert(0, Message(role="system", content=_irreversible_note))

    messages.insert(
        0,
        Message(
            role="system",
            content=(
                "TOOL LOOP DISCIPLINE:\n"
                "- Reuse successful tool results already present in this turn. Never "
                "repeat an identical read/search/list call merely to reconfirm it.\n"
                "- If a read-only target is confirmed missing, changing pagination or "
                "range arguments cannot make it exist; correct the path or inspect its "
                "parent instead.\n"
                "- Once the evidence requested by the user is present, stop calling "
                "tools and return the complete answer."
            ),
        ),
    )
    return _intent_user_context, _browser_required_evidence


def _insert_task_contract_sections(*, intent, messages, _intent_user_context, stack):
    """Code/evidence/security contracts, the todo checklist note, realtime contract."""
    _code_change_task = _is_code_change_task(intent)
    # Reviews/analyses are read-only, but a prose-only answer is still a
    # false completion. Require one real inspection before synthesis.
    _evidence_task = _is_evidence_task(intent) and not _code_change_task
    if _code_change_task:
        available_code_tools = [
            name
            for name in (
                "list_cwd",
                "read_file",
                "grep_text",
                "glob_files",
                "edit_file",
                "write_text_file",
                "multi_edit_file",
                "exec_shell",
                "run_tests",
                "lint_check",
            )
            if stack.executor.registry.has(name)
        ]
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "CODE EXECUTION CONTRACT:\n"
                    "- These tools are enabled in this turn: "
                    + ", ".join(f"`{name}`" for name in available_code_tools)
                    + ". Do not claim tools are unavailable and do not merely "
                    "draft a patch in prose; call the tools to change the scoped "
                    "workspace.\n"
                    "- Inspect an existing file with `read_file` before using "
                    "an edit/write tool on it. Prefer native file tools over "
                    "shell-generated source code.\n"
                    "- After changing implementation or tests, run the focused "
                    "test command that proves the requested behavior. Lint is "
                    "useful additional evidence but does not prove runtime "
                    "behavior and does not replace tests.\n"
                    "- Prefer the smallest focused regression tests. In "
                    "concurrency tests, coordinate callers before they enter "
                    "the operation; never put a barrier for all callers inside "
                    "a loader that correct coalescing should invoke only once.\n"
                    "- A failed check is evidence that work remains. Diagnose it, "
                    "repair the implementation or test, and rerun verification; "
                    "do not mark the task complete or pause while the latest "
                    "verification is failing.\n"
                ),
            ),
        )
    if _evidence_task:
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "EVIDENCE-GROUNDED REVIEW CONTRACT:\n"
                    "This is an analysis or review task. Do not answer from the "
                    "prompt alone or merely announce that you will inspect later. "
                    "Use at least one real workspace inspection tool first, then "
                    "synthesize only from the returned evidence."
                ),
            ),
        )
    if _is_security_change_task(intent):
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "SECURITY REPAIR CONTRACT:\n"
                    "- Write down the trust boundary and the exact order of "
                    "decode, normalization, resolution, and authorization checks.\n"
                    "- Add adversarial regression cases, not only the reported "
                    "example: repeated/mixed encoding, nested traversal, absolute "
                    "paths, separator variants where relevant, and symlink/TOCTOU "
                    "escape where the API touches paths.\n"
                    "- Treat input that changes meaning under another decoding "
                    "pass as ambiguous and unsafe: a downstream layer may decode "
                    "again. Repeatedly encoded traversal must be rejected with the "
                    "domain boundary exception, never left to FileNotFoundError.\n"
                    "- Verify the rejection uses the promised domain exception, "
                    "not an incidental file-not-found or permission error.\n"
                    "- Do not claim zero residual risk solely because self-authored "
                    "happy-path tests passed. Re-read the final implementation and "
                    "challenge its normalization assumptions before finishing.\n"
                ),
            ),
        )
    _todo_protocol_mode = context_mode(_intent_user_context)
    _todo_protocol_required = False

    # Anti-denial for the live task checklist. The tool is small but
    # UX-critical; Claude-family models sometimes answer "todo_write
    # is not available" when the user explicitly names it, even though
    # it is present in the tools array. State the capability plainly.
    try:
        _has_todo_write = stack.executor.registry.has("todo_write")
    except (AttributeError, TypeError, KeyError):
        _has_todo_write = False
    if _has_todo_write:
        _todo_protocol_required = should_require_todo_protocol(
            intent.normalized_goal,
            _intent_user_context,
        )
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "CAPABILITIES · task checklist:\n"
                    "You DO have a `todo_write` tool. It records the live "
                    "task checklist shown to the user during multi-step work. "
                    "When a task has several steps, CALL `todo_write` at the "
                    "start, then call it again when one item becomes "
                    "`in_progress` or `completed`. Do not say `todo_write` is "
                    "unavailable; that denial is wrong because the tool is in "
                    "your tool list.\n"
                    "Accepted payloads: prefer `items=[...]` or `todos=[...]` "
                    "as arrays; JSON strings are tolerated for compatibility. Each "
                    "item may use `content`, `text`, `title`, or `task`, plus an "
                    "optional stable `id`, "
                    "`status` (`pending` / `in_progress` / `completed`) and "
                    "optional `activeForm` / `active_form`. Preserve returned IDs "
                    "and always pass the complete list, not a diff.\n\n"
                    + render_todo_protocol_guidance(
                        required=_todo_protocol_required,
                        mode=_todo_protocol_mode,
                    )
                ),
            ),
        )

    messages.insert(
        0,
        Message(
            role="system",
            content=(
                "REALTIME INTERACTION CONTRACT:\n"
                "- During a multi-step task, accompany each meaningful tool "
                "batch with one short ordinary-text checkpoint before the tool "
                "call. State the conclusion just established and what you are "
                "doing next; do not expose private chain-of-thought.\n"
                "- Keep checkpoints concrete and user-facing. Avoid generic "
                "phrases such as 'working on it' when a verified finding is "
                "available.\n"
                "- After the last tool result, produce the complete answer "
                "directly instead of another process-only checkpoint.\n"
            ),
        ),
    )
    return _code_change_task, _evidence_task, _todo_protocol_required, _has_todo_write


def _build_native_session(*, _intent_user_context, intent, stack, agent, sub_event_queue):
    """The per-turn Session that tool handlers bind around every call."""
    from runtime.platform.process.session import Session, current_session

    user_context = _intent_user_context
    _outer_session = current_session()
    _session_metadata = {
        **_session_metadata_from_intent(intent),
        **dict(getattr(_outer_session, "metadata", None) or {}),
        "_execution_stack": stack,
    }
    _authoritative_thread_id = (
        getattr(_outer_session, "thread_id", None)
        or getattr(_outer_session, "conversation_id", None)
        or getattr(intent, "thread_id", None)
        or getattr(intent, "conversation_id", None)
        or user_context.get("thread_id")
        or user_context.get("conversation_id")
    )
    _session_obj = Session(
        actor=getattr(_outer_session, "actor", None) or getattr(intent, "actor", None),
        agent=agent,
        thread_id=_authoritative_thread_id,
        conversation_id=_authoritative_thread_id,
        turn_id=getattr(_outer_session, "turn_id", None) or uuid4().hex,
        metadata=_session_metadata,
    )
    # Stash the SSE pump queue on the Session so sub-agents spawned
    # via ``call_agent`` / ``call_agent_parallel`` can push their
    # own tool_start/tool_end events and have them appear in the
    # same ordered stream the parent emits. See module docstring +
    # ``ephemeral_runner._emit_sub_tool_event``.
    if sub_event_queue is not None:
        _session_obj.metadata["sub_tool_event_queue"] = sub_event_queue
    return _session_obj


def _resolve_native_tool_specs(
    *,
    model,
    stack,
    agent,
    _intent_user_context,
    intent,
    _code_change_task,
    max_tool_rounds,
    messages,
):
    """Effective model, filtered tool specs, and the round-budget / workspace notes."""
    effective_model = (
        model
        if model and model not in ("echo-ai", "", "auto")
        else getattr(stack.planner, "planner_model", None) or "echo-ai"
    )

    tool_specs = build_anthropic_tool_specs(
        stack.executor.registry,
        agent=agent,
        user_context=_intent_user_context,
        goal=intent.normalized_goal,
    )
    tool_specs, workspace_contract = _filter_tool_specs_for_workspace_contract(
        tool_specs,
        intent.normalized_goal,
        user_context=_intent_user_context,
    )
    evidence_tool_specs = tool_specs
    if bool(_intent_user_context.get("realtime_public_orientation")):
        base_tool_specs = tool_specs
        tool_specs = require_public_update_on_tool_specs(base_tool_specs)
        evidence_tool_specs = require_public_update_on_tool_specs(
            base_tool_specs,
            evidence_round=True,
        )
    _tool_round_budget = _native_tool_round_budget(
        intent.normalized_goal,
        workspace_contract=workspace_contract,
        code_change_task=_code_change_task,
    )
    if _tool_round_budget < max_tool_rounds:
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "TOOL-ROUND BUDGET:\n"
                    f"You have at most {_tool_round_budget} evidence-gathering "
                    "rounds before tools are disabled for synthesis. Prefer "
                    "the strongest available evidence, avoid retrying equivalent "
                    "URLs or searches, and answer as soon as the request is "
                    "supported. The final synthesis round must produce the best "
                    "complete answer from collected evidence."
                ),
            ),
        )
    if workspace_contract == "no_local_access":
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "LOCAL WORKSPACE ACCESS IS FORBIDDEN FOR THIS TURN:\n"
                    "The user explicitly prohibited reading, inspecting, "
                    "modifying, or creating local files. Local filesystem, "
                    "shell, memory-write, delegation, and artifact tools have "
                    "therefore been removed from the tool list. Use only remote "
                    "research/browser tools and the live checklist. Do not claim "
                    "that local inspection is required and do not ask another "
                    "agent to perform it."
                ),
            ),
        )
    elif workspace_contract in {"read_only", "audit_read_only"}:
        messages.insert(
            0,
            Message(
                role="system",
                content=(
                    "READ-ONLY WORKSPACE CONTRACT:\n"
                    "Inspection, search, and focused test/lint verification are "
                    "permitted, but project mutation is prohibited. File-write, "
                    "edit, general shell, formatting, memory-write, and "
                    "self-modification tools have been removed. Do not create or "
                    "modify local files; switch to develop before applying fixes."
                ),
            ),
        )
    return effective_model, tool_specs, evidence_tool_specs, _tool_round_budget


def _apply_code_convergence_nudges(
    *,
    _pending_code_semantic_nudge,
    messages,
    _green_verification_convergence_active,
    _code_semantic_repair_required,
    _green_convergence_todo_only,
    _force_convergence_next,
):
    """Queue the semantic-repair nudge or the green-verification stop request."""
    if _pending_code_semantic_nudge:
        messages.append(
            Message(
                role="user",
                content=(
                    "[SYSTEM CHECK - concurrency semantic repair required]\n"
                    + _pending_code_semantic_nudge
                    + " Repair the production implementation before running more "
                    "verification or attempting the final answer."
                ),
            )
        )
        _pending_code_semantic_nudge = ""

    if _green_verification_convergence_active and not _code_semantic_repair_required:
        # Successful independent verification is terminal evidence. Do
        # not add a checklist-only round after it; the todo list is a
        # projection and may be stale without invalidating the result.
        _green_convergence_todo_only = False
        _force_convergence_next = True
        messages.append(
            Message(
                role="user",
                content=(
                    "[SYSTEM CHECK - green verification convergence]\n"
                    "Two independent clean verifier calls succeeded after "
                    "the latest code mutation. Do not call or request any "
                    "more tools. Produce the concise final answer now."
                ),
            )
        )
    return _pending_code_semantic_nudge, _green_convergence_todo_only, _force_convergence_next
