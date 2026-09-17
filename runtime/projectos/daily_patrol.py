"""Daily read-only sweep: tell the owner which projects need them.

``build_pm_report`` already derives everything a project manager would look at
each morning — phase health, overdue work, blockers, budget pauses, and what the
next action is. Nothing calls it on a schedule, so today it only speaks when the
user opens the page or types ``/project report``. A project that stalls while
nobody is looking stays silent until someone remembers to check.

This module closes that gap in the cheapest safe way: it **reads**. No engine
run, no tool call, no spending, no authorization needed — so it is useful even
if unattended execution is never enabled, and it cannot make a stuck project
worse. It answers one question per project: is there something here the owner
would want to know about today?

What counts as worth interrupting someone for:

* a phase that is ``blocked`` — including a budget pause, which
  ``build_pm_report`` already folds into phase health;
* a phase that is ``overdue``, or tasks past their due date;
* delivery waiting on the owner's acceptance, which by definition cannot
  progress without them;
* a project that was left running by a restart (see ``restart_sweep``) and has
  had nothing driving it since.

An ``at_risk`` phase is reported but not treated as urgent on its own: a
remaining estimate that merely exceeds the time left is a forecast, and a daily
alarm for every forecast trains the owner to ignore the digest.

Honest boundary: this reports **recorded state**. It cannot tell the owner
whether a delivered artifact is any good — that stays with phase acceptance and
their own review. The digest is an anomaly notice, not a progress guarantee.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

_logger = logging.getLogger(__name__)

# Phase health values that justify a notification on their own.
_URGENT_HEALTH = frozenset({"blocked", "overdue"})

# Reported in the digest for context, never the reason one is sent.
_ADVISORY_HEALTH = frozenset({"at_risk"})


@dataclass(frozen=True, slots=True)
class ProjectAttention:
    """One project's answer to "does the owner need to look at this today?"."""

    project_id: str
    name: str
    needs_attention: bool
    reasons: tuple[str, ...] = ()
    blocked_phases: tuple[str, ...] = ()
    overdue_phases: tuple[str, ...] = ()
    at_risk_phases: tuple[str, ...] = ()
    awaiting_acceptance: int = 0
    progress: float = 0.0
    interrupted_by_restart: bool = False


@dataclass(slots=True)
class PatrolDigest:
    """What one sweep found, ready to render into a notification."""

    scanned: int = 0
    unreadable: int = 0
    attention: list[ProjectAttention] = field(default_factory=list)

    @property
    def quiet(self) -> bool:
        """Whether the sweep found nothing worth sending."""
        return not self.attention


def assess_project(
    report: dict[str, Any],
    *,
    interrupted_by_restart: bool = False,
) -> ProjectAttention:
    """Classify one ``build_pm_report`` payload.

    Pure: takes the report rather than the store so the urgency rules can be
    tested without building projects, and so a caller that already has a report
    does not derive it twice.
    """

    milestones = report.get("milestones")
    milestones = milestones if isinstance(milestones, list) else []
    blocked: list[str] = []
    overdue: list[str] = []
    at_risk: list[str] = []
    for milestone in milestones:
        if not isinstance(milestone, dict):
            continue
        health = str(milestone.get("health") or "")
        name = str(milestone.get("name") or milestone.get("id") or "")
        if health == "blocked":
            blocked.append(name)
        elif health == "overdue":
            overdue.append(name)
        elif health in _ADVISORY_HEALTH:
            at_risk.append(name)

    try:
        awaiting = int(report.get("awaiting_acceptance_count") or 0)
    except (TypeError, ValueError):
        awaiting = 0

    reasons: list[str] = []
    if interrupted_by_restart:
        reasons.append("重启后无人推进")
    if blocked:
        reasons.append(f"{len(blocked)} 个阶段阻塞")
    if overdue:
        reasons.append(f"{len(overdue)} 个阶段逾期")
    if awaiting:
        reasons.append(f"{awaiting} 项交付待你验收")
    # Overdue individual tasks matter even when their phase is still on track.
    raw_overdue_tasks = report.get("overdue")
    overdue_tasks = raw_overdue_tasks if isinstance(raw_overdue_tasks, list) else []
    if overdue_tasks and not overdue:
        reasons.append(f"{len(overdue_tasks)} 项任务逾期")

    try:
        progress = float(report.get("overall_progress") or 0.0)
    except (TypeError, ValueError):
        progress = 0.0

    return ProjectAttention(
        project_id=str(report.get("project_id") or ""),
        name=str(report.get("name") or ""),
        needs_attention=bool(reasons),
        reasons=tuple(reasons),
        blocked_phases=tuple(blocked),
        overdue_phases=tuple(overdue),
        at_risk_phases=tuple(at_risk),
        awaiting_acceptance=awaiting,
        progress=progress,
        interrupted_by_restart=interrupted_by_restart,
    )


def run_patrol(store: Any, *, now: datetime | None = None) -> PatrolDigest:
    """Read every live project and collect the ones needing the owner.

    Best-effort per project: one unreadable project is counted and skipped
    rather than aborting the sweep, because a daily digest that silently stops
    at the first bad row is worse than one that says "1 unreadable".
    """

    from runtime.projectos.pm import build_pm_report
    from runtime.projectos.restart_sweep import RESTART_INTERRUPTED_KIND

    digest = PatrolDigest()
    list_projects = getattr(store, "list_projects", None)
    if not callable(list_projects):
        return digest
    try:
        projects = list(list_projects())
    except Exception:  # noqa: BLE001 - a read-only sweep never breaks startup
        _logger.debug("daily patrol could not list projects", exc_info=True)
        return digest

    for project in projects:
        status = str(getattr(project, "status", "") or "")
        # Finished and unstarted projects have nothing to chase.
        if status not in {"running", "blocked"}:
            continue
        project_id = str(getattr(project, "id", "") or "")
        if not project_id:
            continue
        digest.scanned += 1
        try:
            report = build_pm_report(store, project_id, now=now)
        except Exception:  # noqa: BLE001 - report one bad project, keep sweeping
            _logger.debug("daily patrol could not report %s", project_id, exc_info=True)
            digest.unreadable += 1
            continue
        if not isinstance(report, dict):
            digest.unreadable += 1
            continue
        attention = assess_project(
            report,
            interrupted_by_restart=_awaiting_restart_continue(
                store,
                project_id,
                RESTART_INTERRUPTED_KIND,
            ),
        )
        if attention.needs_attention:
            digest.attention.append(attention)
    return digest


def _awaiting_restart_continue(store: Any, project_id: str, marker_kind: str) -> bool:
    """Whether the newest run-related event is a restart interruption.

    Mirrors ``restart_sweep``: history comes back oldest-first, so read it from
    the tail and stop at whichever of the two markers is newer.
    """

    events_for_project = getattr(store, "events_for_project", None)
    if not callable(events_for_project):
        return False
    try:
        events = list(events_for_project(project_id, limit=500))
    except Exception:  # noqa: BLE001 - absence of evidence is not an alarm
        return False
    for event in reversed(events):
        if not isinstance(event, dict):
            continue
        kind = str(event.get("kind") or "")
        if kind == marker_kind:
            return True
        if kind == "project.run":
            return False
    return False


def render_digest(digest: PatrolDigest, *, max_projects: int = 10) -> str | None:
    """The message body, or ``None`` when there is nothing to say.

    Returning ``None`` for a quiet sweep is deliberate: a daily "all fine" note
    is the fastest way to train someone to stop reading these.
    """

    if digest.quiet:
        return None
    lines = [f"{len(digest.attention)} 个项目需要你处理：", ""]
    for item in digest.attention[:max_projects]:
        label = item.name or item.project_id
        lines.append(f"· {label}（交付进度 {round(item.progress * 100)}%）")
        lines.append(f"  {'；'.join(item.reasons)}")
        if item.blocked_phases:
            lines.append(f"  阻塞阶段：{'、'.join(item.blocked_phases)}")
        if item.overdue_phases:
            lines.append(f"  逾期阶段：{'、'.join(item.overdue_phases)}")
        if item.at_risk_phases:
            # Advisory only — never the reason this digest was sent.
            lines.append(f"  有风险（仅提示）：{'、'.join(item.at_risk_phases)}")
    remaining = len(digest.attention) - max_projects
    if remaining > 0:
        lines.append(f"· 其余 {remaining} 个项目已省略。")
    if digest.unreadable:
        lines.append("")
        lines.append(f"另有 {digest.unreadable} 个项目状态读取失败，需要在应用内查看。")
    lines.append("")
    lines.append("这里只反映已记录的状态，不代表交付质量已通过验收。")
    return "\n".join(lines)
