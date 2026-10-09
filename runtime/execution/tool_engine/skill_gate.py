"""Shared pre-execution safety gate for direct skill dispatch.

``ToolExecutor.execute_step`` is the chokepoint where every normal tool
call is vetted — capability-permission, prompt-injection taint, immunity
(``TrustEngine``), and the credential-file denylist all run there before a
handler executes.

Two meta-skills dispatch to a resolved inner skill's handler DIRECTLY,
bypassing ``execute_step`` entirely:

  * ``use_capability`` (``suckers/capability_skills.py``) runs a plugin /
    skill-pack's registered child action.
  * a forged composite (``suckers/forged_persistence.py``) runs each of
    its underlying sub-skills in turn.

Without a shared gate, each site would have to re-implement every check
(and an earlier pass only re-implemented the taint check, leaving immunity,
file-safety, and capability-permission bypassable — a meta-skill became a
confused deputy that could launder ``exec_shell`` / a ``.env`` write / an
untrusted inner skill past the gates its low-risk name slipped through).

``gate_inner_dispatch`` is that single helper: it mirrors the gate sequence
in ``execute_step`` using the same primitive functions, so a
tainted / denied / untrusted / credential-targeting inner skill is blocked
uniformly regardless of which meta-skill reached it.

The immunity gate needs the runtime's ``TrustEngine`` instance, which the
meta-skill handlers (plain closures over a registry) can't see. The
executor binds the active engine via :func:`use_trust_engine` around every
handler call, so a nested meta-skill dispatch resolves the SAME engine the
executor would have used.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from runtime.platform.models import AntigenSignature, ToolCall
from runtime.safety.auth import check_file_write

if TYPE_CHECKING:
    from runtime.safety.auth import TrustEngine


# ── Ambient trust engine ──────────────────────────────────────
#
# Meta-skills dispatch to an inner handler DIRECTLY, so they can't take
# the executor's TrustEngine as a parameter. The executor binds the
# active engine here for the duration of a handler call; a nested
# meta-skill dispatch reads it back via ``current_trust_engine()`` and so
# runs the SAME immunity policy. Unset (``None``) outside an executor —
# e.g. a unit test calling a handler directly — in which case the
# immunity gate is skipped (the other, stateless gates still apply),
# exactly the no-op the direct dispatch already had.
_active_trust_engine: ContextVar[TrustEngine | None] = ContextVar(
    "echo_active_trust_engine",
    default=None,
)


def current_trust_engine() -> TrustEngine | None:
    return _active_trust_engine.get()


@contextmanager
def use_trust_engine(engine: TrustEngine | None) -> Iterator[None]:
    """Bind ``engine`` as the ambient trust engine for the dynamic extent
    of the ``with`` block (and any nested meta-skill dispatch within it)."""
    token: Token = _active_trust_engine.set(engine)
    try:
        yield
    finally:
        _active_trust_engine.reset(token)


# ── Gate primitives (shared with executor.execute_step) ───────


def canonical_tool_path(args: dict[str, Any]) -> Path | None:
    raw = args.get("path") or args.get("file_path") or args.get("filepath")
    if not isinstance(raw, str) or not raw.strip():
        return None
    path = Path(raw).expanduser()
    if not path.is_absolute():
        base = args.get("sandbox_dir") or args.get("cwd")
        if isinstance(base, str) and base.strip():
            path = Path(base).expanduser() / path
    try:
        return path.resolve(strict=False)
    except OSError:
        return path


def file_safety_target(skill: Any, args: dict[str, Any]) -> Path | None:
    """Write target to vet against the credential-file denylist.

    Any write/edit/delete/dangerous skill that names a concrete path is
    checked, so a mis-tagged write skill can't slip a credential write
    (``.env`` / ``id_rsa`` / ``~/.ssh/*``) past the denylist.
    """
    affinity = set(getattr(skill, "affinity", None) or [])
    if not (affinity & {"write", "edit", "delete", "dangerous"}):
        return None
    return canonical_tool_path(args)


def antigen_for(skill: Any) -> AntigenSignature:
    return AntigenSignature(
        entity_id=skill.trusted_source,
        entity_type="skill",
        content_hash=hashlib.blake2b(skill.name.encode("utf-8"), digest_size=8).hexdigest(),
        origin=("public" if skill.trusted_source.startswith("skill://public") else "custom"),
    )


# ── Gate result ───────────────────────────────────────────────

GATE_CAPABILITY = "capability"
GATE_INJECTION_TAINT = "injection_taint_block"
GATE_IMMUNE = "immune_reject"
GATE_FILE_SAFETY = "file_safety"
GATE_HOST_CONTRACT = "host_contract"
GATE_READ_ONLY = "read_only"
GATE_TASK_CAPABILITY = "task_capability"
GATE_APPROVAL = "approval_required"
GATE_SCOPE = "scope"

# Canonical map from a ``GATE_*`` identifier to the CamelCase ``error_type``
# the composite meta-handlers report on a blocked sub-skill. Shared so the
# in-process forge (skill_forge) and the persisted reload (forged_persistence)
# surface the same type for the same gate.
_GATE_ERROR_TYPES: dict[str, str] = {
    GATE_INJECTION_TAINT: "InjectionTaintBlocked",
    GATE_CAPABILITY: "CapabilityBlocked",
    GATE_IMMUNE: "ImmuneRejected",
    GATE_FILE_SAFETY: "FileSafetyBlocked",
    GATE_HOST_CONTRACT: "HostContractBlocked",
    GATE_READ_ONLY: "ReadOnlyBlocked",
    GATE_TASK_CAPABILITY: "TaskCapabilityBlocked",
    GATE_APPROVAL: "ApprovalRequired",
    GATE_SCOPE: "ScopeBlocked",
}


@dataclass(frozen=True, slots=True)
class GateBlock:
    """A definitive block verdict from :func:`gate_inner_dispatch`.

    ``gate`` is one of the ``GATE_*`` identifiers above so callers can map
    it to their own error shape; ``message`` is a human-readable string
    ``"<gate>: <reason>"`` suitable for surfacing to the model; ``error_type``
    is the CamelCase tag the composite meta-handlers record.
    """

    gate: str
    reason: str

    @property
    def message(self) -> str:
        return f"{self.gate}: {self.reason}"

    @property
    def error_type(self) -> str:
        return _GATE_ERROR_TYPES.get(self.gate, "InnerDispatchBlocked")


def gate_inner_dispatch(
    skill: Any,
    args: dict[str, Any],
    *,
    caller: str,
    defer_taint_if_handled: bool = False,
) -> GateBlock | None:
    """Apply the executor's pre-execution safety gates to a skill that a
    meta-skill is about to dispatch DIRECTLY (``use_capability``, a forged
    composite), where ``executor.execute_step`` is bypassed.

    Mirrors the gate order in ``execute_step`` — capability-permission,
    injection-taint, immunity, file-safety — using the same primitive
    functions, and returns the first :class:`GateBlock` that fires, or
    ``None`` to allow. Fail-closed wherever a verdict is definitive.

    The immunity gate is enforced only when a ``TrustEngine`` is ambiently
    bound (the executor binds it via :func:`use_trust_engine` around every
    handler call). Outside an executor it is skipped, matching the
    pre-existing direct-dispatch behaviour. Like ``execute_step``, only a
    ``reject`` verdict blocks — ``quarantine`` / ``allow`` proceed.

    ``defer_taint_if_handled`` stays ``False`` for meta-skill dispatch:
    the single-action approval gate reviewed the OUTER meta-skill (usually
    low-risk), not this inner tool, so the inner call is effectively
    unreviewed and must not defer to a gate that never saw it.
    """
    from runtime.execution.misc.capability_permissions import is_skill_allowed
    from runtime.platform.capabilities.permission_grants import (
        is_marketplace_skill_allowed,
    )
    from runtime.safety.approval.approval_gate import injection_taint_block

    skill_id = str(getattr(skill, "name", "") or "")

    # 1. Capability-permission denylist (runtime group switches).
    allowed, reason = is_skill_allowed(skill_id)
    if not allowed:
        return GateBlock(GATE_CAPABILITY, reason or "capability disabled")
    allowed, reason = is_marketplace_skill_allowed(skill)
    if not allowed:
        return GateBlock(GATE_CAPABILITY, reason or "capability permission denied")

    # 2. Indirect prompt-injection taint.
    inj = injection_taint_block(
        skill_id,
        str(args)[:500],
        defer_if_handled=defer_taint_if_handled,
    )
    if inj is not None:
        return GateBlock(GATE_INJECTION_TAINT, inj)

    # 3. Immunity / trust — only when an engine is ambiently bound.
    engine = current_trust_engine()
    if engine is not None:
        report = engine.check(
            ToolCall(caller=caller, sucker_id=skill_id, args=args),
            antigen_for(skill),
        )
        if report.verdict == "reject":
            return GateBlock(
                GATE_IMMUNE,
                report.reason or "rejected by trust engine",
            )

    # 4. Credential-file denylist.
    fs_target = file_safety_target(skill, args)
    if fs_target is not None:
        verdict = check_file_write(fs_target)
        if not verdict.allow:
            return GateBlock(GATE_FILE_SAFETY, verdict.reason)

    return None


# ── Full inner-dispatch preparation (meta-skill → inner skill) ─

# Affinity tags that make an inner action side-effecting enough to need the
# same human review a direct call would get. The name-based risk matrix alone
# misses plugin actions (``pack__runner``) whose names carry no risk prefix.
_INNER_HIGH_RISK_AFFINITIES = frozenset(
    {"exec", "shell", "dangerous", "write", "edit", "delete"},
)
_RISK_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}


@dataclass(frozen=True, slots=True)
class PreparedInnerDispatch:
    """Result of :func:`prepare_inner_dispatch`.

    ``args`` are the sanitized, scope-prepared arguments to hand to the inner
    handler (only meaningful when ``block`` is ``None``); ``stripped`` lists
    the model-controlled override keys that were removed.
    """

    args: dict[str, Any]
    stripped: tuple[str, ...] = ()
    block: GateBlock | None = None


def _session_metadata() -> dict[str, Any]:
    try:
        from runtime.platform.process.session import current_session

        metadata = getattr(current_session(), "metadata", None)
    except (ImportError, AttributeError, LookupError, RuntimeError):
        return {}
    return metadata if isinstance(metadata, dict) else {}


def _action_tail(name: str) -> str:
    tail = name.rsplit(".", 1)[-1].rsplit("/", 1)[-1]
    if "__" in tail:
        tail = tail.rsplit("__", 1)[-1]
    return tail


def inner_dispatch_risk(skill: Any, args: dict[str, Any]) -> Any:
    """Approval risk for an inner action a meta-skill is about to run.

    The strictest of: the risk matrix for the registered name, for its
    plugin-local action tail (``pack__exec_shell`` → ``exec_shell``), and a
    ``high`` floor when the skill declares a side-effecting affinity.
    """
    from runtime.safety.approval.approval_gate import ApprovalRisk, assess_approval_risk

    name = str(getattr(skill, "name", "") or "")
    preview = str(args)[:500]
    candidates = [assess_approval_risk(name, preview)]
    tail = _action_tail(name)
    if tail and tail != name:
        candidates.append(assess_approval_risk(tail, preview))
    affinity = {str(tag).strip().lower() for tag in (getattr(skill, "affinity", None) or [])}
    risky_tags = sorted(affinity & _INNER_HIGH_RISK_AFFINITIES)
    if risky_tags:
        candidates.append(
            ApprovalRisk(
                level="high",
                categories=("side_effect_affinity",),
                reason=f"side-effecting affinity: {', '.join(risky_tags)}",
            )
        )
    worst = max(candidates, key=lambda risk: _RISK_ORDER.get(risk.level, 0))
    categories: list[str] = []
    for risk in candidates:
        for category in risk.categories:
            if category not in categories:
                categories.append(category)
    return ApprovalRisk(
        level=worst.level,
        categories=tuple(categories),
        reason=", ".join(categories) or worst.reason,
    )


def _inner_approval_block(
    skill: Any,
    args: dict[str, Any],
    metadata: dict[str, Any],
) -> GateBlock | None:
    """Approval gate for an inner action.

    The single-action approval gate reviewed the OUTER meta-skill (usually
    low-risk), never this inner call, and a nested dispatch has no channel to
    ask the user. So an inner action whose risk policy says ``ask`` /
    ``confirm`` / ``deny`` is refused (fail-closed) unless the session is
    already in auto-approve / bypass-permissions mode — the same session
    switches the executor's governance evaluator honours. The model is told
    to call the tool directly, where the normal approval flow applies.
    """
    from runtime.safety.governance import ExecutionPolicyContext

    context = ExecutionPolicyContext.from_metadata(metadata)
    if context.auto_approve or context.bypass_approval:
        return None
    risk = inner_dispatch_risk(skill, args)
    action = context.approval_risk_policy.action_for(risk)
    if action in {"allow", "audit"}:
        return None
    name = str(getattr(skill, "name", "") or "")
    return GateBlock(
        GATE_APPROVAL,
        (
            f"{name} (risk={risk.level}: {risk.reason}; action={action}) needs human "
            "approval, which a nested meta-skill dispatch cannot request. Invoke "
            f"{name!r} directly as a tool so the approval gate reviews this exact call."
        ),
    )


def prepare_inner_dispatch(
    skill: Any,
    args: dict[str, Any],
    *,
    caller: str,
    require_approval: bool = True,
) -> PreparedInnerDispatch:
    """Run the executor's pre-execution pipeline for a meta-skill's inner call.

    ``use_capability`` / ``execute_skill`` dispatch an inner handler without
    going through ``ToolExecutor.execute_step`` (they run *inside* a handler
    that step already dispatched and have no step/journal/budget of their
    own). This mirrors the step's argument and policy stages, in order:

    1. strip model-controlled privilege overrides (``allow_sensitive`` …);
    2. host execution contract (``allowed_tools``) and audit read-only mode;
    3. task capability manifest;
    4. :func:`gate_inner_dispatch` — capability, taint, immunity, file safety;
    5. approval risk policy for the inner tool (see ``_inner_approval_block``);
    6. ``_prepare_scoped_args`` — session injection, ``sandbox_dir`` / root /
       path confinement to the execution scope, plan-mode write refusal;
       then the declared write allowlist and the credential-file denylist on
       the scope-resolved target.
    """
    from runtime.safety.auth import strip_model_controlled_overrides

    cleaned, stripped_keys = strip_model_controlled_overrides(dict(args))
    call_args: dict[str, Any] = dict(cleaned)
    stripped = tuple(stripped_keys)
    skill_id = str(getattr(skill, "name", "") or "")

    def _blocked(gate: str, reason: str) -> PreparedInnerDispatch:
        return PreparedInnerDispatch(call_args, stripped, GateBlock(gate, reason))

    from runtime.execution.request import current_execution_request

    host_request = current_execution_request()
    if (
        host_request is not None
        and host_request.task.allowed_tools is not None
        and skill_id not in host_request.task.allowed_tools
    ):
        return _blocked(GATE_HOST_CONTRACT, "tool is outside the host execution contract")

    metadata = _session_metadata()
    from runtime.execution.misc.skill_policy import audit_read_only_tool_denial

    denial = audit_read_only_tool_denial(skill_id, call_args, context=metadata)
    if denial is not None:
        return _blocked(GATE_READ_ONLY, denial)

    from runtime.execution.tool_engine._executor_helpers import (
        _check_task_capability_permission,
        _declared_write_scope_violation,
        _prepare_scoped_args,
    )
    from runtime.platform.models import SkillId

    allowed, reason = _check_task_capability_permission(SkillId(skill_id))
    if not allowed:
        return _blocked(GATE_TASK_CAPABILITY, reason or "task capability disabled")

    # Definitive denials (capability / taint / immunity / credential file)
    # are reported before the approval hold, so the model sees the final
    # reason instead of being told to retry a call that can never run.
    gate = gate_inner_dispatch(skill, call_args, caller=caller)
    if gate is not None:
        return PreparedInnerDispatch(call_args, stripped, gate)

    if require_approval:
        approval = _inner_approval_block(skill, call_args, metadata)
        if approval is not None:
            return PreparedInnerDispatch(call_args, stripped, approval)

    try:
        call_args = _prepare_scoped_args(skill, SkillId(skill_id), call_args)
    except PermissionError as exc:
        return _blocked(GATE_SCOPE, str(exc))
    scope_reason = _declared_write_scope_violation(skill, SkillId(skill_id), call_args)
    if scope_reason is not None:
        return _blocked(GATE_SCOPE, scope_reason)
    fs_target = file_safety_target(skill, call_args)
    if fs_target is not None:
        verdict = check_file_write(fs_target)
        if not verdict.allow:
            return _blocked(GATE_FILE_SAFETY, verdict.reason)
    return PreparedInnerDispatch(call_args, stripped, None)


__all__ = [
    "GATE_APPROVAL",
    "GATE_CAPABILITY",
    "GATE_FILE_SAFETY",
    "GATE_HOST_CONTRACT",
    "GATE_IMMUNE",
    "GATE_INJECTION_TAINT",
    "GATE_READ_ONLY",
    "GATE_SCOPE",
    "GATE_TASK_CAPABILITY",
    "GateBlock",
    "PreparedInnerDispatch",
    "antigen_for",
    "canonical_tool_path",
    "current_trust_engine",
    "file_safety_target",
    "gate_inner_dispatch",
    "inner_dispatch_risk",
    "prepare_inner_dispatch",
    "use_trust_engine",
]
