"""Consent to run a command without a hard sandbox, for one tool call.

Hosts without bwrap, Landlock or Seatbelt (Windows today) fall back to direct
execution only with explicit human consent: ``stream_run`` (a kernel module,
runtime/kernel-release.json) asks its ``approval_provider`` and fails closed
without one. The tool layer is where a human reviews the call, so it opens
this scope around the call's execution:

* ``approved`` — a human approved this exact call on an approval request
  marked ``unconfined``, so the process layer must not ask again;
* ``provider`` — otherwise, the human approval channel to ask.

Command tools turn the scope into ``stream_run``'s provider with
:func:`fallback_approval_provider`. Without a scope (or with neither) the
fallback still fails closed.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from typing import Any

from runtime.safety.approval.approval_gate import (
    ApprovalDecision,
    ApprovalProvider,
    ApprovalRequest,
)

# Risk categories whose tools spawn processes (approval_gate risk scoring).
PROCESS_RISK_CATEGORIES = frozenset(
    {"shell_execution", "code_execution", "vcs_mutation", "destructive_command"}
)


@dataclass(frozen=True, slots=True)
class ExecConsent:
    approved: bool
    provider: Any | None


_EXEC_CONSENT: ContextVar[ExecConsent | None] = ContextVar("echo_exec_consent", default=None)


@contextmanager
def exec_consent_scope(*, approved: bool, provider: Any | None) -> Iterator[ExecConsent]:
    consent = ExecConsent(approved=approved, provider=provider)
    token = _EXEC_CONSENT.set(consent)
    try:
        yield consent
    finally:
        _EXEC_CONSENT.reset(token)


def current_exec_consent() -> ExecConsent | None:
    return _EXEC_CONSENT.get()


class _AlreadyApproved(ApprovalProvider):
    """The person approved this exact call, disclosed as unconfined."""

    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        return ApprovalDecision(approved=True, reason="approved_with_tool_call")


class _AskUnconfined(ApprovalProvider):
    """Ask the person, marking the request as an unconfined run."""

    def __init__(self, provider: Any) -> None:
        self._provider = provider

    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        return self._provider.request(replace(req, unconfined=True), timeout=timeout)


def fallback_approval_provider() -> ApprovalProvider | None:
    """``stream_run``'s ``approval_provider`` for the current tool call."""

    consent = current_exec_consent()
    if consent is None:
        return None
    if consent.approved:
        return _AlreadyApproved()
    if consent.provider is not None:
        return _AskUnconfined(consent.provider)
    return None


def needs_unconfined_consent(risk_categories: Any) -> bool:
    """Whether approving a tool with these risk categories also approves an
    unconfined run, because it spawns processes on a host without a hard
    sandbox."""

    return bool(PROCESS_RISK_CATEGORIES.intersection(risk_categories or ())) and (
        host_lacks_hard_sandbox()
    )


def is_human_provider(provider: Any | None) -> bool:
    """Whether a provider's approval is a person's decision.

    Model-driven reviewers set ``human_reviewer = False``; their approval can
    clear a tool policy but not consent to unconfined execution.
    """

    return provider is not None and bool(getattr(provider, "human_reviewer", True))


def host_lacks_hard_sandbox() -> bool:
    """True when commands here would need the unconfined fallback."""

    from runtime.safety.sandboxing.sandbox import (
        effective_process_sandbox_mode,
        resolved_process_backend,
    )

    try:
        choice = resolved_process_backend(effective_process_sandbox_mode())
    except Exception:  # noqa: BLE001 - a strict mode that cannot resolve never falls back
        return False
    return bool(getattr(choice, "needs_approval", False))


__all__ = [
    "PROCESS_RISK_CATEGORIES",
    "ExecConsent",
    "current_exec_consent",
    "exec_consent_scope",
    "fallback_approval_provider",
    "host_lacks_hard_sandbox",
    "is_human_provider",
    "needs_unconfined_consent",
]
