"""Prompt composition and critic heuristics for ``TeamRunner`` roles."""

from __future__ import annotations

from ._team_runner_results import RoleOutput
from .topology import Role, TeamTopology

# ── Critic 问题判定 + 重写 prompt ───────────────────────────

# 3 critic rebut -> generator rewrite: these words mean the critic flagged substantive issues.
# Pure 'no issues / all fine' verdicts do NOT trigger a rewrite.
_CRITIC_ISSUE_HINTS = (
    "问题",
    "缺失",
    "缺",
    "错误",
    "不准确",
    "需修正",
    "需补充",
    "需要修正",
    "需要补充",
    "建议",
    "风险",
    "漏洞",
    "矛盾",
    "冲突",
    "遗漏",
    "不足",
    "含糊",
    "无法",
    "issue",
    "flaw",
    "error",
    "concern",
    "contradiction",
    "missing",
    "gap",
)
_CRITIC_CLEAN_HINTS = (
    "未发现",
    "没有问题",
    "一切正常",
    "没问题",
    "全部正确",
    "无需",
    "no issues",
    "all good",
    "no problems",
    "looks good",
    "looks correct",
    "all correct",
)


def _critic_has_issues(text: str) -> bool:
    # 3 Heuristic: did the critic flag substantive issues worth a rewrite?
    if not text or not text.strip():
        return False
    low = text.lower()
    if any(hint in low for hint in _CRITIC_CLEAN_HINTS):
        return False
    return any(hint in low for hint in _CRITIC_ISSUE_HINTS)


class _TeamRunnerPromptsMixin:
    """Role prompt builders mixed into ``TeamRunner``."""

    def _compose_prompt(
        self,
        role: Role,
        task: str,
        prior: list[RoleOutput],
    ) -> str:
        if not prior:
            return f"[role: {role}]\n\nTask:\n{task}"
        bits = [f"[role: {role}]", f"Task:\n{task}", ""]
        for p in prior:
            bits.append(f"--- {p.role} output ---")
            bits.append(p.output)
            bits.append("")
        return "\n".join(bits)

    def _compose_generator_prompt(
        self,
        task: str,
        last_gen: RoleOutput | None,
        last_eval: RoleOutput | None,
    ) -> str:
        if last_gen is None or last_eval is None:
            return f"[role: generator]\n\nTask:\n{task}"
        return (
            f"[role: generator · retry]\n\n"
            f"Task:\n{task}\n\n"
            f"--- previous attempt ---\n{last_gen.output}\n\n"
            f"--- evaluator feedback (score: "
            f"{last_eval.score if last_eval.score is not None else 'n/a'}) ---\n"
            f"{last_eval.output}\n\n"
            f"Address the feedback and produce a revised answer."
        )

    def _compose_cross_check_prompt(
        self,
        task: str,
        replica_outputs: list[RoleOutput],
        topology: TeamTopology,
    ) -> str:
        """② 并行副本交叉验证 prompt：让 critic 对研究员池的全部产出做交叉核查。

        Critic 看到所有副本的结果后，指出重复/冲突/覆盖缺口，供 synthesizer
        去重与收敛——副本之间通过 critic 这一"裁判"互相可见，而不是各查各的。
        """
        bits = ["[role: critic · cross-validation]", f"Task:\n{task}", ""]
        for i, out in enumerate(replica_outputs, start=1):
            bits.append(f"--- researcher replica {i} ({out.agent_id}) ---")
            bits.append(out.output if out.output else "(no output)")
            bits.append("")
        bits.append(
            "以上是同一角色并行副本各自独立调研的全部结果。请做交叉核查：\n"
            "1) 找出重复/重叠的结论；\n"
            "2) 找出相互矛盾的地方；\n"
            "3) 指出还没覆盖到的关键缺口。\n"
            "只输出核查结论，逐条列出（重复/冲突/缺口），不要复述各副本内容。"
        )
        return "\n".join(bits)

    def _compose_critic_revision_prompt(
        self,
        task: str,
        prior: list[RoleOutput],
        critic: RoleOutput,
        *,
        round_no: int = 1,
    ) -> str:
        """3 Let the generator rewrite against the critic's specific feedback.

        Hands the previous generator draft plus the critic's concrete criticism
        back to the generator and asks it to address each point — a real
        "critic rebuttal -> generator rewrite" loop instead of passing the
        critic notes as plain text to the synthesizer.
        """
        gen_out = next(
            (o for o in reversed(prior) if o.role == Role.GENERATOR),
            None,
        )
        prev = gen_out.output if gen_out else "(no previous draft)"
        bits = [
            "[role: generator · critic-revision]",
            f"Task:\n{task}",
            "",
            f"--- previous generator output (v{max(0, round_no - 1)}) ---",
            prev,
            "",
            f"--- critic's feedback (round {round_no}) ---",
            critic.output,
            "",
            "Please address each point: what you accept, what you keep and why. "
            "Then produce the revised answer only — do not restate the feedback.",
        ]
        return "\n".join(bits)

    def _compose_evaluator_prompt(self, task: str, generator_output: str) -> str:
        return (
            "[role: evaluator]\n\n"
            "Score the candidate answer on a 0-1 scale and explain why.\n"
            "Begin your reply with: score: <number between 0 and 1>\n\n"
            f"Task:\n{task}\n\n"
            f"Candidate answer:\n{generator_output}"
        )


def _render_replica_addendum(
    addendum: str,
    *,
    replica_index: int | None,
    replica_count: int | None,
) -> str:
    """Fill ``{replica_index}`` / ``{replica_count}`` placeholders in a
    role's system addendum.

    Used by the ``parallel`` protocol so a multi-replica role's prompt can
    tell each concurrent copy which slice of the work it owns (e.g. a
    researcher pool of 3, where replica 2 researches the 2nd sub-problem).
    Only the named placeholders are substituted — any other braces in the
    addendum are left untouched (``.format`` would reject them).
    """
    if replica_index is None:
        return addendum
    return addendum.replace("{replica_index}", str(replica_index)).replace(
        "{replica_count}", str(replica_count or 1)
    )
