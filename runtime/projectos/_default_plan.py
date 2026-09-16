"""Deterministic milestone and task plans used without an LLM."""

from runtime.projectos.model import Milestone, Task


def stub_generate_milestones(goal: str) -> list[Milestone]:
    """No-LLM fallback: a generic Plan → Build → Verify phasing that fits almost
    any project, so the engine/CLI runs deterministically without a model router
    (production injects LLM hooks for goal-specific milestones)."""
    return [
        Milestone(
            id="MS1",
            name="plan",
            goal=f"Scope and plan: {goal}",
            success_criteria=["plan approved"],
        ),
        Milestone(
            id="MS2",
            name="build",
            goal=f"Build: {goal}",
            success_criteria=["implementation complete"],
            dependencies=["MS1"],
        ),
        Milestone(
            id="MS3",
            name="verify",
            goal=f"Verify and deliver: {goal}",
            success_criteria=["verified against goal"],
            dependencies=["MS2"],
        ),
    ]


def stub_decompose_tasks(ms: Milestone) -> list[Task]:
    """No-LLM fallback: a research → execution pair (a 2-node DAG).

    The research node defaults to ``team_mode="swarm"`` so a roster-aware
    engine (cowork_bridge injects ``run_task_team``) brainstorms it across the
    group; the execution node stays ``single`` unless a caller opts it into
    cluster."""
    return [
        Task(
            id=f"{ms.id}-T1",
            milestone_id=ms.id,
            type="research",
            goal=f"{ms.goal} — assess",
            team_mode="swarm",
            priority="P1",
            estimate=1.0,
            due_at=ms.due_at or "",
            acceptance_criteria=list(ms.success_criteria),
        ),
        Task(
            id=f"{ms.id}-T2",
            milestone_id=ms.id,
            type="code",
            goal=f"{ms.goal} — do",
            priority="P2",
            estimate=2.0,
            depends_on=[f"{ms.id}-T1"],
        ),
    ]
