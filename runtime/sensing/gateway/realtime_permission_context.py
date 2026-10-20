"""Canonicalize approval and filesystem boundaries independently."""

from typing import Any

from runtime.protocol.items import ApprovalPolicy


def canonical_permission_context(
    context_payload: dict[str, Any], approval_policy: ApprovalPolicy
) -> tuple[dict[str, Any], str, bool, ApprovalPolicy]:
    from runtime.safety.approval.permission_modes import (
        approval_reviewer_for_mode,
        canonical_permission_mode,
    )

    declared_permission_mode = context_payload.get("permission_mode")
    explicit_permission_mode = isinstance(declared_permission_mode, str) and bool(
        declared_permission_mode.strip()
    )
    canonical_mode = canonical_permission_mode(declared_permission_mode)
    if canonical_mode == "bypassPermissions" and approval_policy != "never":
        # A client cannot regain the operator-disabled bypass via mode metadata.
        canonical_mode = "default"
    bounded_mode_explicit = explicit_permission_mode and canonical_mode != "bypassPermissions"
    if bounded_mode_explicit and canonical_mode != "autoSandbox":
        # The two bounded modes share one workspace sandbox. The selected
        # mode changes only who reviews a boundary crossing; stale or custom
        # clients cannot silently combine them with local/full execution.
        approval_policy = "on-request"
    if canonical_mode == "autoSandbox" and approval_policy != "never":
        canonical_mode = "default"
    context_payload = {
        **context_payload,
        "permission_mode": canonical_mode,
        # Server-derived: a hand-crafted approvals_reviewer field cannot
        # silently switch who handles an escalation.
        "approvals_reviewer": approval_reviewer_for_mode(canonical_mode),
        **(
            {
                "execution_environment": "sandbox",
                "sandbox_mode": "sandbox",
            }
            if bounded_mode_explicit
            else {}
        ),
    }
    return context_payload, canonical_mode, bounded_mode_explicit, approval_policy
