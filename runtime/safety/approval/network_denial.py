"""Refused network access, remembered for the turn.

Split out of :mod:`runtime.safety.approval.approval_gate`, which re-exports
every public name here, so existing imports keep working.
"""

from __future__ import annotations

import contextlib
import ipaddress
import json
import re
import threading
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from runtime.safety.approval.approval_gate import ApprovalRisk

# Risk categories of a call that reaches beyond this machine.
NETWORK_RISK_CATEGORIES: frozenset[str] = frozenset(
    {"network_read", "network_or_egress", "sensitive_egress", "external_mcp"}
)


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
    except ValueError:
        # Not an IP literal: accept it only if it reads as a host name.
        pattern = _HOST_LABELS if has_scheme else _BARE_HOST
        return host if pattern.fullmatch(host) else None
    return host


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


__all__ = [
    "NETWORK_RISK_CATEGORIES",
    "NetworkDenialMemory",
    "is_network_risk",
    "network_targets",
]
