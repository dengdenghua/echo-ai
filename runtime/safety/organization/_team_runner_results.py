"""Team run result records and outcome helpers for ``TeamRunner``."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .topology import Role


@dataclass
class RoleOutput:
    role: Role
    agent_id: str
    output: str
    score: float | None = None
    duration_ms: float = 0.0
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class TeamRunResult:
    topology_name: str
    topology_fingerprint: str
    task_bucket: str
    success: bool
    final_output: str
    role_outputs: list[RoleOutput] = field(default_factory=list)
    iterations: int = 1
    total_duration_ms: float = 0.0
    error: str | None = None
    # ① 失败隔离：记录本轮哪些角色失败但其部分产出被保留继续，便于上游
    # 在最终交付上标注"降级"而非整体失败。
    degraded_roles: list[str] = field(default_factory=list)
    # ③ critic 反驳 → generator 重写：本轮实际发生的修订轮数。
    revision_rounds: int = 0

    @property
    def quality_score(self) -> float | None:
        """The last evaluator score, if any.

        For evaluator_optimizer this is the threshold metric. For
        sequential this is whatever the evaluator role (if present)
        emitted last; ``None`` when no evaluator ran.
        """
        for out in reversed(self.role_outputs):
            if out.role == Role.EVALUATOR and out.score is not None:
                return out.score
        return None


# ── Score parser ──────────────────────────────────────────────


_SCORE_PATTERN = re.compile(
    r"(?:score|quality|rating)[:\s]+([0-9]*\.?[0-9]+)",
    re.IGNORECASE,
)


def _parse_evaluator_score(text: str) -> float | None:
    """Extract a 0..1 quality score from evaluator output.

    Looks for ``score: 0.78`` / ``quality 0.4`` / ``rating: 1.0``.
    Returns ``None`` when no score is found so the caller can decide
    whether to treat that as pass (no signal) or fail (regression).
    """
    if not text:
        return None
    match = _SCORE_PATTERN.search(text)
    if not match:
        return None
    try:
        raw = float(match.group(1))
    except (TypeError, ValueError):
        return None
    # Tolerate evaluators that emit 0-100 instead of 0-1.
    # We only treat values 10-100 as percent (a "score: 5" likely
    # means 5 out of 10 in some rubric — clamp instead of divide).
    if raw > 10.0 and raw <= 100.0:
        raw = raw / 100.0
    return max(0.0, min(1.0, raw))


def _first_role_error(outputs: list[RoleOutput]) -> str | None:
    for output in outputs:
        if output.error:
            return f"{output.role}({output.agent_id}): {output.error}"
    return None


def _has_fatal_role_error(outputs: list[RoleOutput]) -> bool:
    """Whether an error prevented a valid terminal team deliverable.

    ① 失败隔离：单个角色失败不再视为整体致命。只要终态交付（synthesizer，
    否则 evaluator，否则最后一个有产出的角色）存在且成功，就认为团队仍
    交付了可用结果——先前的角色失败会被记录在 ``degraded_roles``，上游可
    以标注"降级交付"。只有终态交付本身缺失/失败才算 fatal。
    """
    terminal = next(
        (
            output
            for output in reversed(outputs)
            if output.role in (Role.SYNTHESIZER, Role.EVALUATOR)
            and output.output
            and not output.error
        ),
        None,
    )
    if terminal is not None:
        return False
    # 没有终态角色成功：若任一角色有非空产出（部分交付）也不算致命，
    # 只有完全没有任何可交付内容才是致命。
    return not any(output.output and not output.error for output in outputs)


def _collect_degraded_roles(outputs: list[RoleOutput]) -> list[str]:
    """① 失败隔离：列出所有失败角色的 role 名（去重、按顺序）。"""
    seen: list[str] = []
    for output in outputs:
        if output.error and str(output.role) not in seen:
            seen.append(str(output.role))
    return seen
