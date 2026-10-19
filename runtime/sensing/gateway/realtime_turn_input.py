"""Turn-input shaping for the realtime runtime.

Split out of ``realtime_cerebrum.py``: everything that turns the raw
``turn/start`` params into structured execution inputs — text/attachment
extraction, metadata/mode lookup, resume-intent parsing and confirmation
texts, default planning-mode / topology routing, and the final
``ParsedIntent`` assembly via :func:`_build_intent`.
"""

from __future__ import annotations

from typing import Any

from runtime.platform.models import ParsedIntent
from runtime.protocol import TurnParams
from runtime.safety.auth.scope import TenantScope
from runtime.safety.recovery.tenant_scope import (
    AUTHORITATIVE_SCOPE_CONTEXT_KEY,
    authoritative_scope_context,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (  # noqa: F401  re-export: import sites stay stable
    _AUDIT_INTENT_RE as _AUDIT_INTENT_RE,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _CODEX_COMPOSER_MODE_RE as _CODEX_COMPOSER_MODE_RE,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _COMPLEX_EXECUTION_RE as _COMPLEX_EXECUTION_RE,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _EXPLICIT_CHANGE_RE as _EXPLICIT_CHANGE_RE,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _PRODUCTION_DEPLOYMENT_MODES as _PRODUCTION_DEPLOYMENT_MODES,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _RESUME_CONFIRM_RE as _RESUME_CONFIRM_RE,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _TOPOLOGY_KEYWORD_RULES as _TOPOLOGY_KEYWORD_RULES,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _agent_id_from_params as _agent_id_from_params,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _apply_runtime_surface_context as _apply_runtime_surface_context,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _context_requests_code_workspace as _context_requests_code_workspace,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _conversation_messages_from_params as _conversation_messages_from_params,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _execution_resume_intent as _execution_resume_intent,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _extract_codex_composer_mode as _extract_codex_composer_mode,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _extract_resume_proposal_json as _extract_resume_proposal_json,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _input_attachments as _input_attachments,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _input_metadata as _input_metadata,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _is_audit_intent as _is_audit_intent,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _is_explicit_change_request as _is_explicit_change_request,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _join_text as _join_text,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _logger as _logger,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _looks_complex as _looks_complex,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _parse_resume_confirmation as _parse_resume_confirmation,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _parse_resume_intent as _parse_resume_intent,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _preview_text as _preview_text,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _redact_preview_text as _redact_preview_text,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _reflex_response_to_text as _reflex_response_to_text,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _resume_confirmation_text as _resume_confirmation_text,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _resume_task_id_from_intent as _resume_task_id_from_intent,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _safe_int as _safe_int,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _safe_str as _safe_str,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _sanitize_preview_text as _sanitize_preview_text,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _sanitize_recent_tool_calls as _sanitize_recent_tool_calls,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _should_default_planning_mode as _should_default_planning_mode,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _should_default_topology as _should_default_topology,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _truncate_text as _truncate_text,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _turn_mode as _turn_mode,
)
from runtime.sensing.gateway.realtime_turn_input_helpers import (
    _validated_local_project_workspace as _validated_local_project_workspace,
)

# Planning-mode defaulting is a prompt nudge, not an enforcement gate (see
# ``_should_default_planning_mode``). todo-protocol enforcement is contract-
# only (``todo_protocol.should_require_todo_protocol``), so this module keeps
# its own light multi-step heuristic instead of delegating — otherwise a
# natural-language implementation/research request would stop defaulting to
# plan-mode. Being generous here is fine: plan-mode no longer blocks tool
# execution, it only nudges the prompt.


# Keyword → built-in topology id auto-dispatch.
# When the user message strongly suggests a category of work that
# benefits from a multi-agent topology, route to the matching
# built-in (seeded by ``runtime.safety.organization.builtin_topologies``).
# The user can override by explicitly setting ``topology_id`` in the
# turn params; this default only fires when no topology was specified
# AND the message clearly matches one of the categories below.
#
# Order matters — ``code_review`` must come before ``refactor`` because
# "review the refactor PR" mentions both keywords; the more specific
# match wins.


def external_model_owner(params: TurnParams) -> str | None:
    """Identify model ownership for shaping input, not execution admission."""
    if params.execution_engine in {"codex", "opencode", "codebuddy"}:
        return params.execution_engine
    if params.execution_engine != "auto":
        return None
    metadata = _input_metadata(params)
    context = metadata.get("context")
    context = context if isinstance(context, dict) else metadata
    preview = str(context.get("execution_engine") or "").strip().lower()
    return preview if preview in {"codex", "opencode", "codebuddy"} else None


# Audit / review intent detection. "审计项目 / 审计一下 / 审查 / code review" are
# read-heavy inspection tasks: the agent's job is a report, not silent
# code edits. We do NOT hard-block writes (an audit may legitimately fix a
# found issue after stating it), but we inject a prompt-level audit contract
# so the default behaviour is inspect-and-report, and any edit must be
# explicitly justified in the same turn.

# An audit/review surface is a default posture, not a permanent write lock.
# When the user explicitly asks to repair/change something in the same turn,
# promote that turn to the normal development workflow.  Keep question/report
# phrasing ("哪些问题需要修复？") in audit mode; only imperative language or a
# bare repair verb opts into mutation.


def _build_intent(
    text: str,
    params: TurnParams,
    *,
    workspaces: Any = None,
    thread_store: Any = None,
    allow_client_auto_approve: bool = False,
    allow_local_workspace_access: bool = False,
    conversation_messages: list[dict[str, str]] | None = None,
) -> ParsedIntent:
    owner_actor_id = str(getattr(params, "owner_actor_id", None) or "").strip()
    tenant_id = str(getattr(params, "tenant_id", None) or "").strip()
    authenticated_principal = bool(owner_actor_id or tenant_id)
    if authenticated_principal and (not owner_actor_id or not tenant_id):
        raise RuntimeError("authenticated realtime principal is incomplete")
    from runtime.sensing.gateway._realtime_cerebrum_project_os import _is_project_os_command

    # Project workers must inherit the same managed root as their parent turn.
    # Allocate it before the host creates the execution permission ceiling.
    authenticated_workspace = authenticated_principal and (
        not allow_local_workspace_access or _is_project_os_command(text)
    )

    managed_layout: Any = None
    cwd: str | None
    if authenticated_workspace:
        if workspaces is None or thread_store is None:
            raise RuntimeError("authenticated realtime workspace service unavailable")
        from runtime.sensing.gateway.thread_workspace import (
            ensure_managed_thread_workspace,
        )

        managed_workspace = ensure_managed_thread_workspace(
            getattr(workspaces, "root", None),
            thread_id=params.thread_id,
            actor_id=owner_actor_id,
            tenant_id=tenant_id,
            store=thread_store,
        )
        managed_layout = workspaces.bind_managed(params.thread_id, managed_workspace)
        cwd = str(managed_layout.root)
    else:
        cwd = params.cwd
        if workspaces is not None:
            cwd = workspaces.resolve_cwd(params.thread_id, params.cwd)
    text, marker_mode = _extract_codex_composer_mode(text)
    metadata = _input_metadata(params)
    context = metadata.get("context")
    context_payload = context if isinstance(context, dict) else {}
    local_project_workspace = (
        None
        if authenticated_workspace
        else _validated_local_project_workspace(
            context_payload,
            allow_authenticated_selection=(
                authenticated_principal and allow_local_workspace_access
            ),
        )
    )
    if local_project_workspace is not None:
        cwd = local_project_workspace
    if thread_store is not None:
        from runtime.sensing.gateway.turn_session import build_turn_metadata

        # These are per-turn execution choices, not persisted persona/mode
        # defaults. The merge intentionally omits them; retain them here for
        # the operator-gated canonicalization below. Otherwise a stored thread
        # silently turns complete access into the default sandbox.
        execution_choices = {
            key: context_payload[key]
            for key in (
                "permission_mode",
                "execution_environment",
                "network_access",
                "work_location",
            )
            if key in context_payload
        }
        context_payload = build_turn_metadata(
            thread_id=params.thread_id,
            body={"context": context_payload},
            store=thread_store,
            authoritative_workspace=(managed_layout.root if managed_layout is not None else None),
            owner_actor_id=owner_actor_id or None,
            tenant_id=tenant_id or None,
        )
        context_payload.update(execution_choices)
    context_payload = dict(context_payload)
    # This private marker is consumed by memory/context readers.  It must
    # never survive from client metadata; authenticated TurnParams are the
    # server-overwritten authority and are re-injected below.
    context_payload.pop(AUTHORITATIVE_SCOPE_CONTEXT_KEY, None)
    if authenticated_principal:
        context_payload[AUTHORITATIVE_SCOPE_CONTEXT_KEY] = authoritative_scope_context(
            TenantScope(tenant_id=tenant_id, actor_id=owner_actor_id)
        )
    attachments = _input_attachments(params.input)
    # Attachment paths arrive from the client and therefore are not authority.
    # Grant read access only to the upload directory derived server-side from
    # this thread's WorkspaceManager.  The execution scope consumes this as a
    # read-only root; it is never added to writable roots.
    if attachments and workspaces is not None:
        try:
            upload_root = workspaces.layout(params.thread_id).upload.resolve()
        except (OSError, ValueError):
            upload_root = None
        if upload_root is not None:
            context_payload["attachment_read_roots"] = [str(upload_root)]
    # ``TurnParams.cwd`` is the public single-shot / power-user working
    # directory contract.  Merely carrying it as ``user_context.cwd`` leaves
    # the execution scope in chat mode, where filesystem tools default to the
    # thread's empty artifact folder.  Promote an explicit caller-supplied cwd
    # to the same project context the interactive work-directory selector
    # emits.  Auto-allocated per-thread cwd values still follow the personal
    # workspace path below and do not gain project scope implicitly.
    explicit_cwd = not authenticated_workspace and (
        (isinstance(params.cwd, str) and bool(params.cwd.strip()))
        or local_project_workspace is not None
    )
    if explicit_cwd and isinstance(cwd, str) and cwd.strip():
        context_payload.setdefault("workspace_path", cwd.strip())
        context_payload.setdefault("workspace_scope", "project")
        context_payload.setdefault("mode", "code")
    if marker_mode:
        context_payload.setdefault("workflow_mode", marker_mode)
        context_payload.setdefault("completion_policy", marker_mode)
        context_payload.setdefault("mode_preset", f"{marker_mode}.mode")
        context_payload.setdefault("workflow_preset", f"{marker_mode}.mode")
        if marker_mode == "goal":
            context_payload.setdefault("goal_mode", True)
    context_payload = _apply_runtime_surface_context(text, context_payload)
    actor_id = owner_actor_id or metadata.get("actor_id") or metadata.get("actorId")
    if isinstance(actor_id, str) and actor_id.strip():
        if authenticated_principal:
            context_payload["owner_actor_id"] = actor_id.strip()
            context_payload["tenant_id"] = tenant_id
        else:
            context_payload.setdefault("owner_actor_id", actor_id.strip())
    if managed_layout is not None:
        # Reassert the execution boundary after all client-controlled context
        # shaping. These paths are consumed independently by cwd resolution,
        # filesystem scope, attachments and artifact publishing.
        for key in (
            "extra_workspaces",
            "personal_workspace_path",
            "allowed_write_paths",
        ):
            context_payload.pop(key, None)
        context_payload["workspace_path"] = str(managed_layout.root)
        context_payload["workspace_scope"] = "project"
        context_payload["_artifact_output_root"] = str(managed_layout.final)
    if conversation_messages is not None:
        # The authenticated Echo journal supersedes browser-supplied history,
        # including an empty journal. Older direct embeddings may omit it.
        context_payload["conversation_messages"] = conversation_messages
    if _context_requests_code_workspace(context_payload):
        if (
            isinstance(context_payload.get("workspace_path"), str)
            and context_payload["workspace_path"].strip()
        ):
            context_payload.setdefault("workspace_scope", "project")
        else:
            context_payload.setdefault("workspace_scope", "personal")
        if (
            context_payload.get("workspace_scope") == "personal"
            and isinstance(cwd, str)
            and cwd.strip()
        ):
            context_payload.setdefault("personal_workspace_path", cwd.strip())
    resume_intent = _parse_resume_intent(text)
    if resume_intent is not None:
        context_payload["resume_intent"] = resume_intent
    if "effort" in getattr(params, "model_fields_set", set()):
        context_payload["reasoning_effort"] = params.effort
    # Defense in depth: ``RealtimeGateway._sanitize_turn_params`` already
    # rewrites ``approvalPolicy="never"`` to ``"on-request"`` when the
    # operator hasn't opted in. We re-check here so tests that drive
    # CerebrumRuntime directly (bypassing the gateway) cannot silently
    # disable approval gates either.
    approval_policy = params.approval_policy
    if approval_policy == "never" and not allow_client_auto_approve:
        approval_policy = "on-request"
    from .realtime_permission_context import canonical_permission_context

    context_payload, canonical_mode, bounded_mode_explicit, approval_policy = (
        canonical_permission_context(context_payload, approval_policy)
    )
    permission_mode = canonical_mode.lower()
    full_access_requested = permission_mode in {
        "bypasspermissions",
        "bypass-permissions",
        "bypass",
        "yolo",
        "full",
    }
    if full_access_requested and approval_policy == "never":
        # Full access is an inclusive backend contract, not merely an
        # approval shortcut. Canonicalize stale or hand-crafted clients so
        # execution and network cannot remain narrower than the selected mode.
        context_payload = {
            **context_payload,
            "permission_mode": "bypassPermissions",
            "approval_policy": "never",
            "execution_environment": "local",
            "sandbox_mode": "full",
            "network_access": "full",
        }
    # Audit / review turns get a prompt-level audit contract (inspect →
    # report; any code edit must be explicitly justified). This is a
    # behavioural nudge, not a permission gate — an audit may legitimately
    # fix a found issue after stating it.
    audit_mode = _is_audit_intent(text, context_payload)
    if audit_mode:
        context_payload = {**context_payload, "audit_mode": True}
        if _is_explicit_change_request(text):
            # Preserve the audit surface for inspection turns, but let an
            # explicit repair request become executable without requiring the
            # user to manually switch modes first.
            audit_mode = False
            context_payload = {
                **context_payload,
                "audit_mode": False,
                "mode": "code",
                "agent_mode": "develop",
                "workflow_mode": "develop",
                "completion_policy": "develop",
                "mode_preset": "develop.mode",
                "workflow_preset": "develop.iterate",
            }
    # Thread the turn's declared sandbox policy through to execution so
    # exec_shell can honour ``sandboxPolicy.networkAccess``. Default when
    # absent is network denied — a turn must explicitly opt in.
    sb_policy = getattr(params, "sandbox_policy", None) or {}
    if full_access_requested and approval_policy == "never":
        sb_policy = {
            **(sb_policy if isinstance(sb_policy, dict) else {}),
            "type": "dangerFullAccess",
            "networkAccess": True,
        }
        sb_policy.pop("egressAllowCommon", None)
        sb_policy.pop("egress_allow_common", None)
    elif bounded_mode_explicit and isinstance(sb_policy, dict):
        sb_policy = {**sb_policy, "type": "workspaceWrite"}
    if isinstance(sb_policy, dict) and sb_policy:
        context_payload = {
            **context_payload,
            "sandbox_policy": {"type": str(sb_policy.get("type") or ""), **sb_policy},
        }
    return ParsedIntent(
        raw=text,
        intent_type="task",
        normalized_goal=text,
        user_context={
            **context_payload,
            "approval_policy": approval_policy,
            "auto_approve": approval_policy == "never",
            "cwd": cwd,
            "mode": context_payload.get("mode") or _turn_mode(params),
            "planning_mode": bool(getattr(params, "planning_mode", False)),
            # Native tool models often emit protocol calls with no surrounding
            # prose. The realtime bridge may request one evidence-grounded
            # public update after a genuinely quiet, long-running batch.
            "realtime_public_narrative": True,
            # Ask the working model itself for one natural public sentence
            # before its first real tool round.
            "realtime_public_orientation": True,
            # Reasoning providers can spend minutes producing only private
            # tokens before they reach ordinary text or a tool call. Ask the
            # lightweight, thinking-disabled narrator for the first public
            # sentence independently so the main conversation never waits on
            # the working model's hidden chain of thought.
            "realtime_public_preface": True,
            # Pass attachments through so images become image_url blocks and
            # documents become a path/metadata manifest with bounded previews.
            "attachments": attachments,
        },
    )
