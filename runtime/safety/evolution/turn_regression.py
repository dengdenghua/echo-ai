"""Periodic regression checks after scoped turn scoring."""

from __future__ import annotations

import logging
from typing import Any

_logger = logging.getLogger(__name__)


def _auto_evolve_tick_safe(
    agent_id: str,
    *,
    every: int = 5,
    min_total: int = 15,
    scope: Any = None,
) -> None:
    """Every ``every`` turns, run an auto-regression check.

    Fail-closed: any exception is swallowed · this is behind the
    user's reply and must never affect it. Cost is ~2ms file read
    + the ``analyze_soul_impact`` pure math; only LLM cost if
    ``_auto_regression_check`` escalates (it doesn't — it's
    heuristic-only).

    Args:
        every: how often to tick. Default 5 = every 5 turns.
        min_total: minimum total scores before ticking at all.
            Default 15 = 10 baseline + 5 post-change minimum.
    """
    try:
        from runtime.safety.evolution.turn_scoring import read_recent_scores

        scores = read_recent_scores(
            agent_id,
            limit=max(min_total * 2, 40),
            scope=scope,
        )
        if len(scores) < min_total or len(scores) % every != 0:
            return
        # Import lazily so this tick stays optional (skill module
        # can fail to load without breaking the scoring path).
        from pathlib import Path

        # Temporarily set _agent_core_dir since we're outside a
        # Session context (the skill uses it internally).
        import runtime.safety.evolution.soul_actions as _m
        from runtime.safety.evolution.soul_actions import _auto_regression_check

        original = _m._agent_core_dir
        _m._agent_core_dir = lambda: Path("agents") / agent_id / "agent-core"
        try:
            res = _auto_regression_check(
                window=20,
                drop_threshold=0.2,
                min_samples=5,
                dry_run=False,
                _scope=scope,
            )
            action = res.get("action")
            if action == "reverted":
                _logger.info(
                    "auto-evolve tick · agent=%s reverted SOUL (delta=%s)",
                    agent_id,
                    (res.get("analysis") or {}).get("delta"),
                )
        finally:
            _m._agent_core_dir = original
    except (ImportError, AttributeError, OSError):  # noqa: BLE001 — agent_core_dir reset best-effort
        pass
