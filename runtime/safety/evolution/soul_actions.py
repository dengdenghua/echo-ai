"""Agent lessons, reflection and SOUL rollback owned by self-evolution."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_LESSONS_HEADER = "## Lessons Learned"


def _agent_core_dir() -> Path:
    from runtime.platform.process.session import current_session

    session = current_session()
    if session is None or session.agent is None or not session.agent.agent_id:
        raise RuntimeError("self-evolution requires an active agent session")
    return _PROJECT_ROOT / "agents" / session.agent.agent_id / "agent-core"


def _current_turn_score_scope() -> Any:
    from runtime.platform.process.session import current_session

    from .tenant_scope import trusted_scope_from_session

    return trusted_scope_from_session(current_session())


def _iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _soul_history_dir() -> Path:
    """Per-agent ``.soul_history/`` snapshot directory."""
    return _agent_core_dir() / ".soul_history"


def _snapshot_soul(reason: str = "") -> Path | None:
    """Write the current SOUL.md to a timestamped snapshot.

    Returns the snapshot path, or None if there was nothing to
    snapshot (no SOUL.md exists yet). Snapshots are how
    ``revert_soul`` rolls back · without them every ``update_soul``
    is destructive. Called automatically before every successful
    write. Safe to call repeatedly — generates a unique filename
    per call (millisecond precision).
    """
    core = _agent_core_dir()
    src = core / "SOUL.md"
    if not src.exists():
        return None
    hist = _soul_history_dir()
    hist.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]  # ms precision
    slug = ""
    if reason:
        # Sanitise reason for filename (alnum/dash only, max 30 chars).
        slug = "-" + "".join(c if c.isalnum() else "-" for c in reason)[:30].strip("-")
    snap = hist / f"{ts}{slug}.md"
    snap.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return snap


def _list_soul_snapshots() -> list[Path]:
    """Return snapshots newest-first."""
    hist = _soul_history_dir()
    if not hist.exists():
        return []
    return sorted(
        (p for p in hist.glob("*.md") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )


def _update_soul(
    lesson: str = "",
    tag: str = "",
    **_kw: Any,
) -> dict[str, Any]:
    """Append a self-learned lesson to the current agent's SOUL.md.

    Lessons accumulate under a ``## Lessons Learned`` section that's
    auto-loaded into the agent's system prompt on next session boot.
    The dedupe check is exact-match within the section so the same
    lesson written twice doesn't bloat the file. Tag is optional and
    appears as a bracketed prefix.

    Every successful write FIRST snapshots the existing SOUL.md to
    ``.soul_history/<timestamp>.md`` so the change can be rolled
    back via ``revert_soul``. This is the "anti-self-harm"
    counterpart to the MiniMax-style "agent rewrites its own
    scaffold" — without versioning a bad lesson would silently
    poison every future turn.

    Use sparingly · every lesson costs context tokens forever after,
    so only durable insights belong here, not one-off observations
    (those go in `diary_write` or `remember`).
    """
    lesson = (lesson or "").strip()
    if not lesson:
        return {"ok": False, "error": "lesson required"}
    tag = (tag or "").strip()

    core = _agent_core_dir()
    core.mkdir(parents=True, exist_ok=True)
    path = core / "SOUL.md"

    line = f"- [{_iso_now()}{f' · {tag}' if tag else ''}] {lesson}"

    if not path.exists():
        # Fresh SOUL.md — write a minimal scaffold + the section.
        # No snapshot needed (nothing to roll back to yet).
        path.write_text(
            "# Soul\n\n_This file is yours to evolve. As you learn "
            "who you are, update it via the `update_soul` skill._\n"
            f"\n{_LESSONS_HEADER}\n{line}\n",
            encoding="utf-8",
        )
        return {"ok": True, "path": str(path), "appended": lesson}

    text = path.read_text(encoding="utf-8")

    # Dedupe · exact-match only. We don't try semantic dedupe ·
    # that's the agent's job before deciding to call this skill.
    if lesson in text:
        return {
            "ok": True,
            "path": str(path),
            "skipped": "lesson already recorded",
        }

    # Snapshot BEFORE the destructive change · so revert_soul can
    # restore this exact state. Failure to snapshot blocks the
    # write — better to refuse the lesson than to lose history.
    try:
        snap = _snapshot_soul(reason=tag or "lesson")
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"snapshot failed: {type(exc).__name__}: {exc}",
        }

    if _LESSONS_HEADER in text:
        # Append at end of file (section already exists).
        sep = "" if text.endswith("\n") else "\n"
        with path.open("a", encoding="utf-8") as fh:
            fh.write(f"{sep}{line}\n")
    else:
        # First lesson · add the section header.
        sep = "" if text.endswith("\n") else "\n"
        with path.open("a", encoding="utf-8") as fh:
            fh.write(f"{sep}\n{_LESSONS_HEADER}\n{line}\n")
    return {
        "ok": True,
        "path": str(path),
        "appended": lesson,
        "snapshot": str(snap) if snap else None,
    }


def _list_soul_history(limit: int = 10, **_kw: Any) -> dict[str, Any]:
    """List the most recent SOUL.md snapshots (newest first).

    Each entry: ``{timestamp, filename, size_bytes}``. Used by the
    agent (or the operator) to inspect what changed and pick a
    revert target.
    """
    snaps = _list_soul_snapshots()[: max(1, int(limit) if limit else 10)]
    out: list[dict[str, Any]] = []
    for s in snaps:
        try:
            stat = s.stat()
            out.append(
                {
                    "filename": s.name,
                    "size_bytes": stat.st_size,
                    "mtime_iso": datetime.fromtimestamp(
                        stat.st_mtime,
                    ).isoformat(timespec="seconds"),
                }
            )
        except Exception:  # noqa: BLE001
            continue
    return {"ok": True, "count": len(out), "snapshots": out}


def _recall_scores(limit: int = 20, **_kw: Any) -> dict[str, Any]:
    """Return the agent's recent per-turn scores (newest first)."""
    # Resolve current agent_id from Session — same gate the other
    # memory skills use, so unit tests / no-session callers get a
    # clean RuntimeError instead of writing into a wrong path.
    core = _agent_core_dir()
    agent_id = core.parent.name  # agents/<id>/agent-core → <id>
    from dataclasses import asdict

    from runtime.safety.evolution.turn_scoring import read_recent_scores

    rows = read_recent_scores(
        agent_id,
        limit=max(1, int(limit) if limit else 20),
        scope=_current_turn_score_scope(),
    )
    return {
        "ok": True,
        "count": len(rows),
        "scores": [asdict(r) for r in rows],
    }


def _analyze_soul_impact(
    window: int = 20,
    drop_threshold: float = 0.2,
    **_kw: Any,
) -> dict[str, Any]:
    """Run the heuristic before-vs-after check on recent scores."""
    core = _agent_core_dir()
    agent_id = core.parent.name
    from runtime.safety.evolution.turn_scoring import analyze_soul_impact

    return analyze_soul_impact(
        agent_id,
        window=max(1, int(window) if window else 20),
        drop_threshold=float(drop_threshold) if drop_threshold else 0.2,
        scope=_current_turn_score_scope(),
    )


def _auto_regression_check(
    window: int = 20,
    drop_threshold: float = 0.2,
    min_samples: int = 5,
    dry_run: bool = False,
    _scope: Any = None,
    **_kw: Any,
) -> dict[str, Any]:
    """Auto-revert SOUL if the most recent lesson caused a score drop.

    The "anti-self-harm" counterpart to ``deep_evolve(dry_run=False)``:
    apply path adds a lesson, this path checks if the lesson actually
    helped and rolls back if it hurt.

    Flow:
        1. Call ``analyze_soul_impact`` with the same window/threshold.
        2. If verdict == "regressed" AND after_n >= min_samples:
           call ``_revert_soul(steps_back=1, reason=…)`` — unless
           ``dry_run=True`` in which case only report the intent.
        3. All other verdicts → no action.

    Returns:
        {
          "ok": True,
          "action": "reverted" | "would_revert" | "no_action",
          "analysis": {...analyze_soul_impact output...},
          "revert_result": {...} | None,
        }

    Design:
        Atomic (0-token) · safe by default (dry_run=False triggers real
        revert — the analyze step requires ≥5 post-change samples, so
        it's rate-limited by real usage rather than a fresh-apply
        panic). The 5-sample floor is what keeps this from auto-reverting
        after one bad turn.
    """
    core = _agent_core_dir()
    agent_id = core.parent.name
    from runtime.safety.evolution.turn_scoring import analyze_soul_impact

    scope = _current_turn_score_scope() if _scope is None else _scope
    res = analyze_soul_impact(
        agent_id,
        window=max(1, int(window) if window else 20),
        drop_threshold=float(drop_threshold) if drop_threshold else 0.2,
        scope=scope,
    )
    analysis = dict(res)
    action = "no_action"
    revert_result: dict[str, Any] | None = None

    verdict = res.get("verdict")
    after_n = int(res.get("after_n") or 0)
    delta = res.get("delta")

    # Coerce dry_run · LLMs sometimes pass strings.
    if isinstance(dry_run, str):
        dry_run = dry_run.lower() in ("true", "yes", "1")

    should_revert = (
        verdict == "regressed"
        and after_n >= int(min_samples)
        and isinstance(delta, (int, float))
        and delta < -float(drop_threshold)
    )

    if should_revert:
        reason = (
            f"auto-revert · delta={delta:+.2f} over {after_n} turns (≥ {drop_threshold} threshold)"
        )[:80]
        if dry_run:
            action = "would_revert"
            revert_result = {"dry_run": True, "planned_reason": reason}
        else:
            try:
                revert_result = _revert_soul(steps_back=1, reason=reason)
                action = "reverted"
            except Exception as exc:  # noqa: BLE001
                action = "revert_failed"
                revert_result = {
                    "error": f"{type(exc).__name__}: {exc}",
                }

    return {
        "ok": True,
        "action": action,
        "analysis": analysis,
        "revert_result": revert_result,
        "dry_run": bool(dry_run),
        "min_samples": int(min_samples),
    }


def _deep_reflect(
    window: int = 20,
    model: str = "",
    **_kw: Any,
) -> dict[str, Any]:
    """LLM-judged review of recent turns (B2 · ~2-3¢ haiku call)."""
    core = _agent_core_dir()
    agent_id = core.parent.name
    from runtime.safety.evolution.deep_evolution import deep_reflect

    return deep_reflect(
        agent_id=agent_id,
        window=max(1, int(window) if window else 20),
        model=(model or None),
        scope=_current_turn_score_scope(),
    )


def _deep_evolve(
    window: int = 20,
    candidates_per_round: int = 3,
    max_rounds: int = 1,
    dry_run: bool = True,
    model: str = "",
    **_kw: Any,
) -> dict[str, Any]:
    """MiniMax-style autonomous self-improvement loop (B3 · expensive).

    Default ``dry_run=True`` returns a preview only. Pass
    ``dry_run=False`` to register a typed evolution candidate; it still
    requires structured shadow review and staged canary before SOUL changes.
    """
    core = _agent_core_dir()
    agent_id = core.parent.name
    from runtime.safety.evolution.deep_evolution import deep_evolve

    # Coerce dry_run · LLMs sometimes pass strings.
    if isinstance(dry_run, str):
        dry_run = dry_run.lower() not in ("false", "no", "0", "")
    return deep_evolve(
        agent_id=agent_id,
        window=max(1, int(window) if window else 20),
        candidates_per_round=max(
            1,
            min(5, int(candidates_per_round) if candidates_per_round else 3),
        ),
        max_rounds=max(1, min(10, int(max_rounds) if max_rounds else 1)),
        dry_run=bool(dry_run),
        model=(model or None),
        scope=_current_turn_score_scope(),
    )


def _revert_soul(
    steps_back: int = 1,
    reason: str = "",
    **_kw: Any,
) -> dict[str, Any]:
    """Roll the agent's SOUL.md back N snapshots.

    Args:
        steps_back: how many snapshots to step back (default 1 ·
            "undo last change"). 2 = undo last two writes.
        reason: free-text why · stored in a snapshot of the CURRENT
            state before the rollback so this revert is itself
            reversible. Convention: write what went wrong (e.g.
            "lesson caused over-cautious behavior").

    Restores SOUL.md from the Nth-newest snapshot. The current
    state gets snapshotted first under reason "pre-revert" so the
    operator can re-apply if the rollback was a mistake.
    """
    steps_back = max(1, int(steps_back) if steps_back else 1)
    reason = (reason or "").strip() or "manual"

    snaps = _list_soul_snapshots()
    if not snaps:
        return {
            "ok": False,
            "error": "no snapshots available · update_soul has never run",
        }
    if steps_back > len(snaps):
        return {
            "ok": False,
            "error": (f"can't step back {steps_back} · only {len(snaps)} snapshots exist"),
        }
    target = snaps[steps_back - 1]

    # Snapshot the CURRENT state first so this revert is reversible.
    try:
        pre_revert = _snapshot_soul(reason=f"pre-revert-{reason}")
    except Exception:  # noqa: BLE001
        pre_revert = None

    core = _agent_core_dir()
    soul_path = core / "SOUL.md"
    soul_path.write_text(
        target.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    return {
        "ok": True,
        "restored_from": target.name,
        "pre_revert_snapshot": pre_revert.name if pre_revert else None,
        "reason": reason,
    }
