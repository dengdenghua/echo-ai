"""Tool-approval provider — pluggable, transport-agnostic.

The previous implementation kept a process-wide ``dict[str, threading.Event]``
and exposed ``request_approval``/``wait_for_approval``/``submit_decision``
free functions. That design forced the SSE+POST flow, deadlocked under
multi-worker uvicorn, and could not be unit-tested without monkey-patching
the global state.

This module replaces that with an :class:`ApprovalProvider` interface plus
two implementations:

  * :class:`AutoApproveProvider` — always grants. Useful in tests, in
    ``approvalPolicy="never"`` paths, and for headless batch jobs.
  * :class:`AutoDenyProvider`    — always denies. The default when no
    provider is wired, so a missing wiring fails closed rather than
    silently auto-accepting destructive tools.

Live UIs supply their own provider — for the realtime gateway, the
emitter is the provider (see :class:`RpcConnection.request_approval`).
"""

from __future__ import annotations

import contextlib
import dataclasses
import fnmatch
import ipaddress
import json
import logging
import re
import threading
from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlsplit

from runtime.safety.approval.permission_modes import canonical_permission_mode

_logger = logging.getLogger(__name__)

ApprovalRiskLevel = Literal["low", "medium", "high", "critical"]
ApprovalRiskAction = Literal["allow", "audit", "ask", "confirm", "deny"]


@dataclass(frozen=True, slots=True)
class ApprovalRisk:
    level: ApprovalRiskLevel
    categories: tuple[str, ...] = ()
    reason: str = ""

    @property
    def requires_approval(self) -> bool:
        return self.level in {"medium", "high", "critical"}

    def with_injection_taint(self) -> ApprovalRisk:
        """Annotate that this approval was forced by prompt-injection
        taint in the turn (untrusted content carried injection markers),
        so the UI / audit log shows *why* a normally-auto tool is asking."""
        if "prompt_injection_taint" in self.categories:
            return self
        return ApprovalRisk(
            level=self.level,
            categories=(*self.categories, "prompt_injection_taint"),
            reason=(
                f"{self.reason}; forced approval — untrusted content with "
                "injection markers entered this turn"
            ).lstrip("; "),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "level": self.level,
            "categories": list(self.categories),
            "reason": self.reason,
            "requires_approval": self.requires_approval,
        }


_RISK_ACTION_ORDER: dict[str, int] = {"allow": 0, "audit": 1, "ask": 2, "confirm": 3, "deny": 4}
# Risk categories of a call that reaches beyond this machine.
NETWORK_RISK_CATEGORIES: frozenset[str] = frozenset(
    {"network_read", "network_or_egress", "sensitive_egress", "external_mcp"}
)


@dataclass(frozen=True, slots=True)
class ApprovalRiskPolicy:
    """Risk-level policy matrix for tool approval routing."""

    low: ApprovalRiskAction = "allow"
    medium: ApprovalRiskAction = "ask"
    high: ApprovalRiskAction = "ask"
    critical: ApprovalRiskAction = "confirm"
    # Optional floor for network-reaching calls (``NETWORK_RISK_CATEGORIES``),
    # applied on top of the level action. ``None`` keeps the level matrix
    # alone. ``resolve_approval_risk_policy`` sets ``"ask"`` for the "询问审批"
    # and "自动审批" permission modes, so every network call is reviewed (by
    # the user or the review agent) whatever its level.
    network: ApprovalRiskAction | None = None

    def action_for(self, risk: ApprovalRisk) -> ApprovalRiskAction:
        action: ApprovalRiskAction = getattr(self, risk.level)
        if (
            self.network is not None
            and NETWORK_RISK_CATEGORIES.intersection(risk.categories)
            and _RISK_ACTION_ORDER[self.network] > _RISK_ACTION_ORDER[action]
        ):
            return self.network
        return action

    @classmethod
    def from_mapping(cls, value: object) -> ApprovalRiskPolicy:
        if not isinstance(value, dict):
            return cls()
        data: dict[str, ApprovalRiskAction] = {}
        for level in ("low", "medium", "high", "critical", "network"):
            raw = value.get(level)
            if isinstance(raw, str) and raw in _RISK_ACTION_ORDER:
                data[level] = raw  # type: ignore[assignment]
        return cls(**data)

    def to_dict(self) -> dict[str, ApprovalRiskAction]:
        data: dict[str, ApprovalRiskAction] = {
            "low": self.low,
            "medium": self.medium,
            "high": self.high,
            "critical": self.critical,
        }
        if self.network is not None:
            data["network"] = self.network
        return data


# Heuristic catalog of tool names that require explicit approval when no
# more specific policy is supplied. Mirrors the original ``approval_gate``
# defaults; centralizing here keeps the rule set in one place.
DANGEROUS_TOOLS: frozenset[str] = frozenset(
    {
        "exec_shell",
        "write_text_file",
        "append_text_file",
        "edit_text_file",
        "edit_code",
        "delete_file",
        "git_commit",
        "git_push",
        "git_checkout",
        "git_create_pr",
        "git_merge",
        "git_reset",
        # Computer-automation API surface (preview-confirm-execute) ·
        # ``computer_observe`` and ``computer_preview_action`` are
        # deliberately omitted: the former is read-only status and a
        # screenshot, the latter only queues a token without executing.
        # ``computer_plan_next`` is included because it ships a fresh
        # screenshot to a vision model (egress) before any user
        # confirmation, and ``computer_execute_token`` is the one that
        # actually moves the mouse / keyboard via the queued token.
        "computer_plan_next",
        "computer_execute_token",
    }
)

DANGEROUS_PREFIXES: tuple[str, ...] = (
    "exec_shell",
    "write_",
    "edit_",
    "delete_",
    "git_",
    "send_",
    "http_",
    "fetch_",
    "email_",
    "slack_",
    # Desktop GUI control · pyautogui-driven mouse / keyboard / screen
    # primitives. Screen capture is included (not just input) because
    # whatever's on screen — open password managers, draft emails,
    # private chat — leaves the host the moment the screenshot lands
    # in a tool observation. Treat it as data egress.
    "mouse_",
    "keyboard_",
    "screen_",
    # Browser automation · both the headless Playwright pool
    # (``browser_*``) and the live bridge into the desktop Electron
    # webview (``live_browser_*``). The latter operates the user's
    # real, logged-in browser, so it is at least as sensitive as the
    # former. Gating both at the prefix level avoids per-skill drift
    # as new browser primitives get added.
    "browser_",
    "live_browser_",
    # Mobile/Tentacle device control. These names appear as canonical
    # Android skill ids (``android.tap``) and MCP-safe tool ids
    # (``android_tap``).
    "android.",
    "android_",
)


def is_dangerous_tool(tool_name: str) -> bool:
    """Return True iff ``tool_name`` should default to needing approval.

    Pure function; safe to call from anywhere. Decisions about whether
    to *consult* the user (vs. an auto-approve override) belong to the
    caller — typically the ``approval_policy`` resolution layer.
    """
    if tool_name in DANGEROUS_TOOLS:
        return True
    return any(tool_name.startswith(prefix) for prefix in DANGEROUS_PREFIXES)


# Tools that execute model-authored code without being named like a shell.
_CODE_EXECUTION_TOOLS: frozenset[str] = frozenset({"ipython", "workflow"})
# Meta-skills that dispatch to a model-chosen inner tool.
_META_DISPATCH_TOOLS: frozenset[str] = frozenset({"use_capability", "execute_skill"})
# Media generators that write output files to the workspace.
_MEDIA_GENERATION_TOOLS: frozenset[str] = frozenset(
    {"generate_image", "generate_video", "generate_speech", "generate_sound_effects"}
)
# Network reads with no other risk signal stay ``low`` but are tagged
# ``network_read`` so an ``ApprovalRiskPolicy.network`` floor routes them to
# review. ``fetch_url``/``web_fetch``/``platform_read`` all GET a model-chosen
# URL: whatever level each one has, all three must carry a network category,
# or rejecting one leaves the same request open through another.
_NETWORK_READ_TOOLS: frozenset[str] = frozenset(
    {
        "crawl_site",
        "deep_research_answer",
        "platform_collect",
        "platform_monitor",
        "platform_read",
        "platform_search",
        "reach_doctor",
        "research_answer",
        "screenshot_web_full_page",
        "search_image_by_image",
        "search_image_by_text",
        "web_fetch",
        "web_search",
    }
)
_NETWORK_READ_PREFIXES: tuple[str, ...] = (
    "web_",
    "crawl_",
    "platform_",
    # Browser automation loads pages too; it is ``high`` already, but the
    # category lets a refused target stay refused through a browser tool.
    "browser_",
    "live_browser_",
)


def assess_approval_risk(
    tool_name: str,
    args_preview: str = "",
) -> ApprovalRisk:
    """Classify a tool call by capability risk, independent of UI policy."""

    name = (tool_name or "").strip()
    preview = (args_preview or "").lower()
    categories: list[str] = []
    level: ApprovalRiskLevel = "low"

    def bump(next_level: ApprovalRiskLevel, category: str) -> None:
        nonlocal level
        order = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        if order[next_level] > order[level]:
            level = next_level
        if category not in categories:
            categories.append(category)

    if name.startswith(("read_", "list_", "glob_", "grep_", "file_stats")):
        bump("low", "local_read")
    if name.startswith(
        (
            "fetch_",
            "http_",
            "send_",
            "email_",
            "slack_",
            "upload_",
            "publish_",
            "post_",
            "webhook_",
            "deploy_",
        )
    ):
        bump("medium", "network_or_egress")
    if name in _NETWORK_READ_TOOLS or name.startswith(_NETWORK_READ_PREFIXES):
        bump("low", "network_read")
    if name.startswith(("write_", "append_", "edit_", "delete_")) or name in DANGEROUS_TOOLS:
        bump("high", "filesystem_write")
    if name.startswith(
        ("browser_", "live_browser_", "mouse_", "keyboard_", "screen_", "computer_")
    ):
        bump("high", "interactive_control")
    if name.startswith(("android.", "android_")):
        bump("high", "mobile_device_control")
    if name.startswith("git_"):
        bump("high", "vcs_mutation")
    # Command execution — incl. background / renamed aliases that the
    # bare ``exec_shell`` check missed (a prompt-injected agent can route
    # a shell through any of these).
    if name in _CODE_EXECUTION_TOOLS:
        # Not shells, but they run model-authored code: ``ipython`` executes
        # Python in-process; ``workflow`` runs a model-written orchestration
        # script in a worker subprocess.
        bump("high", "code_execution")
    if name in _META_DISPATCH_TOOLS:
        # Meta-skills dispatch to an arbitrary inner tool chosen by the
        # model. The inner target can't be resolved reliably from a
        # truncated, model-controlled args preview, so the outer call is
        # rated as dangerous as the worst thing it can dispatch.
        bump("high", "meta_dispatch")
    if name in _MEDIA_GENERATION_TOOLS:
        bump("medium", "media_generation_write")
    if name in {
        "exec_shell",
        "shell_command",
        "bash",
        "background_exec",
        "run_command",
        "exec_command",
        "run_python",
        "python_exec",
        "run_code",
        "subprocess_run",
    } or name.startswith(("exec_shell", "background_exec", "run_command")):
        bump("high", "shell_execution")
        destructive_markers = (
            "rm -rf",
            "del /",
            "remove-item",
            "format ",
            "drop database",
            "truncate table",
            "git reset --hard",
            "git clean -fd",
            "push --force",
            "--force-with-lease",
            "chmod 777",
        )
        if any(marker in preview for marker in destructive_markers):
            bump("critical", "destructive_command")
    # MCP / remote tools: their output is attacker-influenceable and their
    # tool NAME is freeform, so the prefix rules above don't see the
    # capability. Treat any mcp_* tool as at least medium, and infer a
    # dangerous capability from danger keywords in the name (e.g.
    # ``mcp_<server>_exec_shell`` / ``..._write_file`` / ``..._upload``).
    # ``use_chatgpt_connector`` hands a free-form instruction to a third-party
    # connector running under the user's own credentials, so it carries the same
    # external-side-effect risk as an mcp_* call without matching the prefix.
    # Left at low it was strictly more permissive than write_text_file (high),
    # despite acting outside the machine with the user's identity.
    if name.startswith(("mcp_", "mcp__")) or name == "use_chatgpt_connector":
        bump("medium", "external_mcp")
        _low = name.lower()
        if any(
            k in _low
            for k in (
                "exec",
                "shell",
                "bash",
                "subprocess",
                "run_command",
                "run_code",
            )
        ):
            bump("high", "shell_execution")
        elif any(
            k in _low
            for k in (
                "write",
                "delete",
                "remove",
                "edit_",
                "upload",
                "publish",
                "deploy",
            )
        ):
            bump("high", "filesystem_write")
    if "api_key" in preview or "secret" in preview or "token" in preview:
        bump("high", "secret_material")
    # Credential probing — reading credentials / session material from
    # non-standard sources (browser profiles, keychains, credential files,
    # logs) is how a hijacked agent exfiltrates auth. Mirrors codex
    # policy.md "Credential Probing": high risk, denied at low/unknown
    # authorization.
    if name.startswith(("read_", "list_", "glob_", "grep_", "cat_", "file_stats")) and any(
        marker in preview for marker in _CREDENTIAL_PROBE_MARKERS
    ):
        bump("high", "credential_probing")
    # Sensitive egress — network actions moving secret material out.
    # Codex requires BOTH payload AND destination authorization; we can't
    # resolve the destination here, so flag sensitive_egress so the policy
    # layer treats it as high-risk unless the user explicitly authorized
    # that payload for that destination.
    if name.startswith(
        (
            "fetch_",
            "http_",
            "send_",
            "email_",
            "slack_",
            "upload_",
            "publish_",
            "post_",
            "webhook_",
        )
    ) and any(marker in preview for marker in _SENSITIVE_EGRESS_MARKERS):
        bump("high", "sensitive_egress")
    if level == "low" and is_dangerous_tool(name):
        bump("medium", "dangerous_tool_catalog")

    return ApprovalRisk(
        level=level,
        categories=tuple(categories),
        reason=", ".join(categories) or "no elevated risk detected",
    )


# Tools that persist attacker-influenceable content into DURABLE agent state
# (MEMORY.md / SOUL.md / USER.md) that is re-loaded into a LATER turn's system
# prompt. Taint is per-turn and resets each turn, so a poisoned fact/lesson
# written under taint would re-enter a future CLEAN turn's context — cross-turn
# injection laundering. These are LOW capability-risk, so the approval gate
# never escalates them; they must be blocked at the chokepoint while tainted.
_DURABLE_PERSISTENCE_WRITES: frozenset[str] = frozenset(
    {"remember", "update_soul", "note_user"},
)

# Non-standard credential locations a compromised agent might read to
# exfiltrate auth material. Lowercased args preview is matched against
# these (codex policy.md "Credential Probing").
_CREDENTIAL_PROBE_MARKERS: tuple[str, ...] = (
    ".aws/credentials",
    ".aws/config",
    "browser profile",
    "cookies.sqlite",
    "login data",
    "keychain",
    "credential",
    "id_rsa",
    ".ssh/",
    "session.json",
    "secrets.json",
    ".npmrc",
    ".pypirc",
)

# Payload markers that make a network egress action sensitive — such an
# action needs explicit payload+destination authorization (codex policy.md
# "Data Exfiltration").
_SENSITIVE_EGRESS_MARKERS: tuple[str, ...] = (
    "api_key",
    "secret",
    "token",
    "password",
    "private_key",
    "credentials",
    "session",
    "authorization",
    "bearer",
)


def is_durable_persistence_write(tool_name: str) -> bool:
    """Whether ``tool_name`` persists content into durable agent state that a
    later turn re-loads into its system prompt (the cross-turn injection
    laundering surface)."""
    return (tool_name or "").strip() in _DURABLE_PERSISTENCE_WRITES


def injection_taint_block(
    tool_name: str,
    args_preview: str = "",
    *,
    defer_if_handled: bool = True,
) -> str | None:
    """The single, path-independent enforcement point for prompt-injection
    taint, called by the executor before every tool runs.

    Returns a block reason when the turn is injection-tainted (untrusted
    content with injection markers entered it) AND either:
      • this tool is risky (medium+) and no approval-capable loop has reviewed
        this specific call — i.e. it reached the executor via the parallel
        dispatch, the agentic-fallback loop, or a subagent, none of which can
        ask a human; or
      • this tool writes durable agent state (memory/soul/user profile) — a
        cross-turn laundering vector that is low-risk (so the approval gate
        never escalates it) yet persists the injection into a future turn.
    Returns ``None`` to allow (clean turn, low-risk non-persistence tool, or a
    risky call already reviewed by the single-action approval gate).
    Fail-closed: when in doubt after taint, the tool is blocked rather than
    auto-run.

    ``defer_if_handled`` lets a caller opt OUT of the gate_already_handled
    deferral. The executor passes True: a risky tool the single-action gate
    already reviewed shouldn't double-block. But a META-SKILL dispatching to an
    INNER handler (use_capability, a forged composite) must pass False — the
    single-action gate reviewed the OUTER meta-skill (typically low-risk), not
    the inner tool, so the inner call is effectively unreviewed."""
    from runtime.safety.validation.prompt_injection import (
        injection_gate_already_handled,
        injection_taint_gates,
    )

    if not injection_taint_gates():
        return None
    # Durable-persistence writes are blocked on EVERY path while tainted —
    # including the single-action path that set gate_already_handled — because
    # the single-action approval gate won't have escalated a low-risk write, so
    # deferring to it would let the poison through.
    if is_durable_persistence_write(tool_name):
        return (
            f"{(tool_name or '').strip()} blocked — writing untrusted content "
            "to durable agent state (memory/soul/user profile) while the turn "
            "is injection-tainted would launder the injection into a future "
            "turn's system prompt"
        )
    if defer_if_handled and injection_gate_already_handled():
        return None
    risk = assess_approval_risk(tool_name, args_preview)
    if risk.level in {"medium", "high", "critical"}:
        return (
            f"{tool_name} (risk={risk.level}: {risk.reason}) blocked — "
            "untrusted content with prompt-injection markers entered this "
            "turn and this execution path cannot request human approval"
        )
    return None


def needs_approval(tool_name: str, auto_approve: bool = False) -> bool:
    """Backwards-compatible helper. Prefer ``is_dangerous_tool``."""
    if auto_approve:
        return False
    return assess_approval_risk(tool_name).requires_approval


def needs_approval_for_chain(tool_names: list[str], auto_approve: bool = False) -> bool:
    if auto_approve:
        return False
    return any(assess_approval_risk(name).requires_approval for name in tool_names)


# Permission modes that review every network-reaching call. "询问审批"
# (``default``) promises to ask before network access; "自动审批"
# (``acceptEdits``) keeps the same boundary and hands each crossing to the
# review agent instead of the user.
_NETWORK_REVIEW_MODES: frozenset[str] = frozenset({"default", "acceptEdits"})


def resolve_approval_risk_policy(
    policy: ApprovalRiskPolicy | Mapping[str, Any] | None = None,
    *,
    permission_mode: object = None,
) -> ApprovalRiskPolicy:
    """The risk policy a turn runs under, including its permission mode.

    An explicit "询问审批" or "自动审批" mode floors every network-reaching
    call at ``ask``, whatever its level: the user or the review agent decides,
    per the mode. A missing mode keeps the policy as configured: headless
    callers (cron, channels, tests) never chose that contract, and realtime
    turns always stamp a mode.
    """

    resolved = (
        policy
        if isinstance(policy, ApprovalRiskPolicy)
        else ApprovalRiskPolicy.from_mapping(policy)
    )
    if (
        resolved.network is None
        and isinstance(permission_mode, str)
        and permission_mode.strip()
        and canonical_permission_mode(permission_mode) in _NETWORK_REVIEW_MODES
    ):
        resolved = dataclasses.replace(resolved, network="ask")
    return resolved


def approval_action_for_tool(
    tool_name: str,
    args_preview: str = "",
    *,
    policy: ApprovalRiskPolicy | Mapping[str, Any] | None = None,
    permission_mode: object = None,
) -> tuple[ApprovalRisk, ApprovalRiskAction, ApprovalRiskPolicy]:
    risk = assess_approval_risk(tool_name, args_preview)
    resolved_policy = resolve_approval_risk_policy(policy, permission_mode=permission_mode)
    return risk, resolved_policy.action_for(risk), resolved_policy


def is_network_risk(risk: ApprovalRisk) -> bool:
    """Whether a classified call reaches beyond this machine."""
    return bool(NETWORK_RISK_CATEGORIES.intersection(risk.categories))


# ── Refused network access, remembered for the turn ──────────
#
# The bypass this closes: the user refused ``fetch_url`` for a URL, and the
# model fetched the same URL through ``web_fetch`` and ``platform_read``.
# Each turn-scoped approval path (the ReAct loop, the external-engine host
# tool broker) keeps one ``NetworkDenialMemory`` and consults it for every
# network-reaching call, whichever tool makes it and whatever the policy
# would otherwise do.

# Argument names whose value is a destination even without a scheme.
_TARGET_KEYS: frozenset[str] = frozenset(
    {
        "url",
        "urls",
        "uri",
        "href",
        "link",
        "links",
        "domain",
        "domains",
        "host",
        "hostname",
        "site",
        "endpoint",
        "base_url",
        "target_url",
        "page_url",
        "start_url",
    }
)
_URL_IN_TEXT = re.compile(r"\b[a-z][a-z0-9+.-]{1,15}://[^\s\"'<>()\[\]{}\\,]+", re.IGNORECASE)
_HOST_LABELS = re.compile(
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\Z"
)
# Without a scheme, only a dotted name with an alphabetic TLD reads as a host
# ("example.com"), so a bare word in a ``site`` field is not mistaken for one.
_BARE_HOST = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}\Z")
_MAX_TARGET_NODES = 512


def _normalized_host(raw: str, *, bare_allowed: bool) -> str | None:
    text = raw.strip().strip("\"'").lower()
    if not text:
        return None
    has_scheme = "://" in text
    if not has_scheme:
        if not bare_allowed:
            return None
        text = "http://" + text.lstrip("/")
    try:
        host = urlsplit(text).hostname
    except ValueError:
        return None
    host = (host or "").rstrip(".")
    if host.startswith("www."):
        host = host[4:]
    if not host:
        return None
    try:
        ipaddress.ip_address(host)
        return host
    except ValueError:
        pass
    pattern = _HOST_LABELS if has_scheme else _BARE_HOST
    return host if pattern.fullmatch(host) else None


def network_targets(arguments: Any) -> frozenset[str]:
    """Hosts a tool call would reach, from its arguments or their preview.

    Reads URL-valued fields (``url``, ``links``, ``domain`` …, with or
    without a scheme) and any absolute URL inside other strings. A preview
    that is not JSON is scanned as text. Returns an empty set when nothing
    resolves; callers then fall back to the capability.
    """

    if isinstance(arguments, str):
        with contextlib.suppress(ValueError):
            arguments = json.loads(arguments)
    hosts: set[str] = set()
    stack: list[tuple[Any, bool]] = [(arguments, False)]
    nodes = 0
    while stack and nodes < _MAX_TARGET_NODES:
        value, is_target = stack.pop()
        nodes += 1
        if isinstance(value, str):
            if is_target:
                host = _normalized_host(value, bare_allowed=True)
                if host:
                    hosts.add(host)
            for match in _URL_IN_TEXT.findall(value):
                host = _normalized_host(match, bare_allowed=False)
                if host:
                    hosts.add(host)
        elif isinstance(value, Mapping):
            for key, child in value.items():
                stack.append((child, str(key).strip().lower() in _TARGET_KEYS))
        elif isinstance(value, (list, tuple)):
            stack.extend((child, is_target) for child in value)
    return frozenset(hosts)


def _same_site(host: str, refused: str) -> bool:
    return host == refused or host.endswith("." + refused) or refused.endswith("." + host)


# Shell and code execution reach the network too: refusing
# ``curl https://example.com`` refuses that site. Those calls carry no network
# category (the sandbox decides their network), so the memory reads the
# destination from the command: any absolute URL, plus a bare host handed to a
# known network client (``curl example.com``). A sandbox escalation reruns a
# command with network, so it is read the same way.
_COMMAND_RISK_CATEGORIES: frozenset[str] = frozenset(
    {"shell_execution", "code_execution", "sandbox_escalation"}
)
_NETWORK_CLIENTS: frozenset[str] = frozenset(
    {
        "curl",
        "wget",
        "http",
        "https",
        "xh",
        "aria2c",
        "ping",
        "nslookup",
        "dig",
        "traceroute",
        "tracert",
        "ssh",
        "scp",
        "sftp",
        "telnet",
        "nc",
        "ncat",
        "ftp",
        "invoke-webrequest",
        "iwr",
        "invoke-restmethod",
        "irm",
        "test-netconnection",
        "tnc",
    }
)
_COMMAND_SEGMENT_SPLIT = re.compile(r"[;|&\n]+")
_COMMAND_TOKEN_SPLIT = re.compile(r"[\s\"'`\[\](){},<>]+")


def _command_client_hosts(arguments: Any) -> frozenset[str]:
    """Bare hosts passed to a network client inside command strings."""

    texts: list[str] = []
    stack: list[Any] = [arguments]
    nodes = 0
    while stack and nodes < _MAX_TARGET_NODES:
        value = stack.pop()
        nodes += 1
        if isinstance(value, str):
            texts.append(value)
        elif isinstance(value, Mapping):
            stack.extend(value.values())
        elif isinstance(value, (list, tuple)):
            stack.extend(value)
    hosts: set[str] = set()
    for text in texts:
        for segment in _COMMAND_SEGMENT_SPLIT.split(text):
            after_client = False
            for token in _COMMAND_TOKEN_SPLIT.split(segment):
                if not token:
                    continue
                program = re.split(r"[\\/]", token)[-1].lower().removesuffix(".exe")
                if program in _NETWORK_CLIENTS:
                    after_client = True
                elif after_client and not token.startswith("-"):
                    host = _normalized_host(token, bare_allowed=True)
                    if host:
                        hosts.add(host)
    return frozenset(hosts)


def _reached_hosts(risk: ApprovalRisk, arguments: Any) -> frozenset[str] | None:
    """Hosts a call reaches, or ``None`` when it is not a network call."""

    network = is_network_risk(risk)
    command = bool(_COMMAND_RISK_CATEGORIES.intersection(risk.categories))
    if not (network or command):
        return None
    hosts = network_targets(arguments)
    if command:
        hosts |= _command_client_hosts(arguments)
    return hosts if network or hosts else None


class NetworkDenialMemory:
    """Network access the user (or reviewer) refused earlier in this turn.

    A refusal is remembered per target host, whichever tool reached for it —
    including a shell command or sandbox escalation that names the host. When
    a refused network call names no resolvable host (a search query, an
    opaque MCP call), the refusal is remembered for that tool instead.
    Thread-safe; one instance per turn.
    """

    def __init__(self) -> None:
        self._hosts: set[str] = set()
        self._tools: set[str] = set()
        self._lock = threading.Lock()

    def note_denial(self, tool_name: str, risk: ApprovalRisk, arguments: Any) -> None:
        targets = _reached_hosts(risk, arguments)
        if targets is None:
            return
        with self._lock:
            if targets:
                self._hosts.update(targets)
            else:
                self._tools.add((tool_name or "").strip())

    def refusal(self, tool_name: str, risk: ApprovalRisk, arguments: Any) -> str | None:
        """Why this call is refused without asking again, or ``None``."""

        targets = _reached_hosts(risk, arguments)
        if targets is None:
            return None
        with self._lock:
            refused = sorted(
                host for host in targets if any(_same_site(host, denied) for denied in self._hosts)
            )
            tool_refused = (tool_name or "").strip() in self._tools
        if refused:
            return (
                f"network access to {', '.join(refused)} was refused earlier in this "
                "turn; do not retry it through this or another tool"
            )
        if tool_refused:
            return (
                f"{tool_name} was refused earlier in this turn; do not retry it or "
                "reach the same result through another tool"
            )
        return None


# ── Provider protocol ────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ApprovalRequest:
    """All the context an approval decision could possibly need."""

    thread_id: str
    tool_name: str
    tool_call_id: str
    args_preview: str = ""
    detail: str = ""


@dataclass(frozen=True, slots=True)
class ApprovalDecision:
    approved: bool
    reason: str | None = None


class ApprovalProvider(ABC):
    """Adapter between a planner's "needs human consent" event and a
    transport (web UI, CLI prompt, Slack, auto-deny, …).

    Implementations must be thread-safe — the same provider may be
    invoked from any worker thread the executor places ReAct on.
    """

    @abstractmethod
    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        """Block the calling thread until the user decides or timeout.

        Implementations may raise on transport failure; callers should
        treat exceptions as denial unless they have a more specific
        policy.
        """


class AutoApproveProvider(ApprovalProvider):
    """Always grants. Convenient for tests and non-interactive runs."""

    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        return ApprovalDecision(approved=True, reason="auto-approve")


class AutoDenyProvider(ApprovalProvider):
    """Default fail-closed provider.
    When no UI is wired, the safe behavior is to refuse rather than
    silently auto-accepting whatever the planner proposes. The reason
    string is surfaced to the planner so it can adjust its plan.
    """

    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        _logger.info(
            "AutoDenyProvider rejecting %s (no interactive UI wired)",
            req.tool_name,
        )
        return ApprovalDecision(
            approved=False,
            reason="no interactive approval UI is wired in this runtime",
        )


# ── Rule-based provider (static policy → cheap) ───────────────
#
# Two-layer permission: static rules absorb the bulk
# of routine tool calls (no human round-trip), and an underlying
# provider handles whatever the rules do not decide. This drops
# approval UI traffic dramatically for sessions where the user has
# pre-declared trusted operations (e.g. "always allow reads",
# "never allow rm -rf").


@dataclass(frozen=True, slots=True)
class ApprovalRule:
    """A single allow/deny rule.

    ``tool`` is matched with ``fnmatch`` against ``ApprovalRequest.tool_name``
    (``"*"`` = any). ``args_contains``, if non-empty, requires the
    substring to appear in ``args_preview`` (cheap containment check —
    deliberately not a regex, the rule set is expected to stay small
    and auditable).
    """

    effect: Literal["allow", "deny"]
    tool: str = "*"
    args_contains: str = ""
    reason: str = ""

    def matches(self, req: ApprovalRequest) -> bool:
        if not fnmatch.fnmatchcase(req.tool_name, self.tool):
            return False
        if self.args_contains and self.args_contains not in req.args_preview:  # noqa: SIM103 — early-return guards read better
            return False
        return True


@dataclass(frozen=True, slots=True)
class ApprovalPolicy:
    """Ordered rule list. First match wins; miss → fallback provider."""

    rules: tuple[ApprovalRule, ...] = field(default_factory=tuple)

    def decide(self, req: ApprovalRequest) -> ApprovalDecision | None:
        for rule in self.rules:
            if rule.matches(req):
                return ApprovalDecision(
                    approved=(rule.effect == "allow"),
                    reason=rule.reason or f"rule:{rule.effect}:{rule.tool}",
                )
        return None


def _fire_permission_denied(req: ApprovalRequest, reason: str | None) -> None:
    """Dispatch a PermissionDenied hook (best-effort, never breaks approval)."""
    try:
        from runtime.safety.hooks import dispatch_permission_denied

        dispatch_permission_denied(
            sucker_id=req.tool_name,
            args={"args_preview": req.args_preview, "detail": req.detail},
            reason=reason or "",
        )
    except Exception:  # noqa: BLE001 — hooks are best-effort
        pass


class RuleBasedProvider(ApprovalProvider):
    """Decorator that consults a static policy before delegating.

    A hit on the policy short-circuits; a miss falls through to
    ``fallback`` (typically a UI-backed provider or AutoDeny).
    """

    def __init__(self, policy: ApprovalPolicy, fallback: ApprovalProvider) -> None:
        self._policy = policy
        self._fallback = fallback

    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        decision = self._policy.decide(req)
        if decision is not None:
            if not decision.approved:
                _fire_permission_denied(req, decision.reason)
            _logger.debug(
                "RuleBasedProvider short-circuit: %s → %s (%s)",
                req.tool_name,
                "allow" if decision.approved else "deny",
                decision.reason,
            )
            return decision
        # No policy hit → offer hooks a chance to grant or deny before
        # falling through to the interactive ask. A cancel from a
        # PermissionRequest hook replaces the gate's decision (lets
        # automation deny unsafe calls without a human prompt).
        hook_denied = None
        try:
            from runtime.safety.hooks import dispatch_permission_request

            hook_decision = dispatch_permission_request(
                sucker_id=req.tool_name,
                args={"args_preview": req.args_preview, "detail": req.detail},
                caller="approval",
            )
            if hook_decision.cancelled:
                hook_denied = hook_decision.reason or "denied by PermissionRequest hook"
        except Exception:  # noqa: BLE001 — hooks are best-effort, never break approval
            hook_denied = None
        if hook_denied:
            decision = ApprovalDecision(approved=False, reason=hook_denied)
            _fire_permission_denied(req, decision.reason)
            return decision
        decision = self._fallback.request(req, timeout=timeout)
        if not decision.approved:
            _fire_permission_denied(req, decision.reason)
        return decision


__all__ = [
    "ApprovalDecision",
    "ApprovalPolicy",
    "ApprovalProvider",
    "ApprovalRisk",
    "ApprovalRiskAction",
    "ApprovalRiskLevel",
    "ApprovalRiskPolicy",
    "ApprovalRequest",
    "ApprovalRule",
    "AutoApproveProvider",
    "AutoDenyProvider",
    "DANGEROUS_PREFIXES",
    "DANGEROUS_TOOLS",
    "NETWORK_RISK_CATEGORIES",
    "NetworkDenialMemory",
    "RuleBasedProvider",
    "approval_action_for_tool",
    "assess_approval_risk",
    "is_dangerous_tool",
    "is_network_risk",
    "needs_approval",
    "needs_approval_for_chain",
    "network_targets",
    "resolve_approval_risk_policy",
    "DenialCircuitBreaker",
]


# ── Denial circuit breaker ────────────────────────────────────
#
# A hijacked or stubborn agent may retry the same denied action over and
# over, burning budget against a wall the guard already hit. Codex's
# guardian tracks repeated same-guard rejections and stops retrying after
# N (``count_denial_for_circuit_breaker``). This is the Echo analogue:
# a per-key (thread/action fingerprint) counter that flips OPEN after
# ``limit`` consecutive denials, so the executor can stop retrying and
# surface a terminal "denied + circuit open" instead of spinning.


class DenialCircuitBreaker:
    """Thread-safe consecutive-denial counter with an open state.

    ``key`` is typically ``(thread_id, tool_name, fingerprint)`` so the
    breaker only trips for the SAME action being retried, never for
    unrelated approvals. Call ``note_denial`` on each denial and
    ``note_clear`` when the action is approved / the goal moves on.
    """

    def __init__(self, limit: int = 3) -> None:
        if limit < 1:
            raise ValueError("limit must be >= 1")
        self._limit = limit
        self._counts: dict[tuple[str, ...], int] = {}
        self._lock = threading.Lock()

    def is_open(self, key: tuple[str, ...]) -> bool:
        with self._lock:
            return self._counts.get(key, 0) >= self._limit

    def note_denial(self, key: tuple[str, ...]) -> int:
        with self._lock:
            count = self._counts.get(key, 0) + 1
            self._counts[key] = count
            return count

    def note_clear(self, key: tuple[str, ...]) -> None:
        with self._lock:
            self._counts.pop(key, None)
