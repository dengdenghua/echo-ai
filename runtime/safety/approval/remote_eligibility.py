"""Which approvals may leave the machine to be answered over a message channel.

Unattended project execution stalls whenever a tool needs consent and nobody is
at the UI. Routing that question to email/IM removes the stall — but it also
moves the approval decision onto a channel that is far weaker than the UI:
an email sender is forgeable, and anyone who can post into the notified room can
answer. So the question is not "can we deliver a notification" but "which
decisions are safe to accept from there at all".

This module answers only that. It does not deliver anything and does not decide
approvals; it gates what is even eligible to be asked remotely.

The rule, in one line: **remote approval reduces the friction of nobody being
present — never the bar for a dangerous operation.**

* ``critical`` / ``high`` risk stays local. Shell execution, deletions, git
  pushes and the rest of ``is_dangerous_tool`` are exactly the operations a
  forged "approve" would be used for. They wait for the UI, or the task blocks.
* Injection-tainted requests stay local, and are not even described remotely:
  the notification text would carry the attacker's payload to the human, which
  is the injection succeeding at one remove.
* ``low`` risk needs no approval in the first place
  (``ApprovalRisk.requires_approval`` is False below ``medium``), so a low-risk
  request arriving here means some other layer forced it — treat that as a
  signal to keep it local rather than guessing why.

What actually remains is narrow, and worth stating plainly. ``assess_approval_risk``
puts ``filesystem_write``, ``shell_execution``, ``vcs_mutation`` and
``interactive_control`` at ``high`` or above, and ``DANGEROUS_PREFIXES`` already
covers ``write_`` / ``edit_`` / ``delete_`` / ``git_`` / ``send_`` / ``http_`` /
``fetch_``. Only three categories are ``medium`` — ``network_or_egress``,
``external_mcp`` and the ``dangerous_tool_catalog`` fallback — and the
``is_dangerous_tool`` check below removes that last one. So in practice remote
approval covers external MCP calls and comparable non-dangerous medium requests,
not ordinary file writes.

That narrowness is the intended outcome, not a gap to widen later: the set of
decisions a forged reply could abuse stays small by construction. Widening it
means revisiting this module deliberately, with the forgery risk in view.
"""

from __future__ import annotations

from dataclasses import dataclass

from runtime.safety.approval.approval_gate import (
    ApprovalRequest,
    ApprovalRisk,
    assess_approval_risk,
    is_dangerous_tool,
)

# Risk levels that may be answered over a message channel. Deliberately a
# closed set rather than "not critical": a new level added upstream must be
# reviewed before it becomes remotely approvable.
_REMOTELY_APPROVABLE_LEVELS = frozenset({"medium"})

_TAINT_CATEGORY = "prompt_injection_taint"


@dataclass(frozen=True, slots=True)
class RemoteEligibility:
    """Whether this approval may be asked over a channel, and why not."""

    eligible: bool
    reason: str
    risk_level: str = ""
    # False whenever the request's details must not be transmitted at all.
    # A tainted request is ineligible *and* undescribable: its text is the
    # attacker's payload.
    describable: bool = True

    @property
    def must_stay_local(self) -> bool:
        return not self.eligible


def remote_eligibility(
    req: ApprovalRequest,
    *,
    risk: ApprovalRisk | None = None,
    injection_tainted: bool = False,
) -> RemoteEligibility:
    """Classify one approval request for remote answering.

    ``risk`` may be supplied when the caller already assessed it for this turn;
    otherwise it is derived from the request. ``injection_tainted`` reflects the
    turn-level taint the executor already tracks — pass it through rather than
    re-deriving, so this module cannot disagree with the gate that forced the
    approval.
    """

    assessed = risk if risk is not None else assess_approval_risk(req.tool_name, req.args_preview)
    tainted = injection_tainted or _TAINT_CATEGORY in assessed.categories
    if tainted:
        # Never describe a tainted request over a channel: doing so forwards
        # untrusted injected text to the human as if it were our own prompt.
        return RemoteEligibility(
            False,
            "injection_tainted",
            assessed.level,
            describable=False,
        )
    if is_dangerous_tool(req.tool_name):
        return RemoteEligibility(False, "dangerous_tool", assessed.level)
    if assessed.level not in _REMOTELY_APPROVABLE_LEVELS:
        # Covers critical/high (too dangerous) and low (should not have needed
        # approval — something else forced it, so do not guess).
        return RemoteEligibility(
            False,
            f"risk_level_not_remotely_approvable:{assessed.level}",
            assessed.level,
        )
    return RemoteEligibility(True, "remotely_approvable", assessed.level)
