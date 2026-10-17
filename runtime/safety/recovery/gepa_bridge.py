"""
Bridge between Echo's existing reflection layer and the
GEPA prompt optimizer.

Why
---

``gepa_optimizer.py`` is generic · it takes an ``eval_fn`` and
optimizes any prompt. This module wires it up to Echo's
specific data sources:

* Failure samples come from ``RecipeEvaluator``'s losing recipes
  (the trajectories the planner under-performed on)
* Evaluation uses an LLM-as-judge over those goals · much
  cheaper than re-executing each plan against the real arms +
  tools, which would need full sandbox infrastructure
* The winner is persisted as a planner system-prompt section
  via the same ``prompt_persistence`` machinery already used
  for ``learned_rules_section`` and ``learned_memories_section``

Trade-off acknowledged
----------------------

LLM-as-judge introduces self-referential bias · the same model
family that wrote the candidate also scores it. Mitigations:

* Use a DIFFERENT model for judging when possible (e.g.
  candidates from claude-haiku, judged by claude-sonnet)
* Eval set draws from REAL past failures, not synthetic
  scenarios · the judge has to predict whether the new prompt
  would have helped on a goal that genuinely went wrong
* The user always reviews + manually applies the winner ·
  no auto-rollout · so a bad GEPA run can't degrade prod

This is the tier we ship by default. For research-grade GEPA
with replay-based evaluation, swap to ``dspy.GEPA`` (50 MB dep
+ DSPy program shape required).
"""

from __future__ import annotations

# ╔════════════════════════════════════════════════════════════════════════╗
# ║ gepa_bridge.py · navigation map.                                       ║
# ║                                                                        ║
# ║ Bridge between Echo's reflection layer and the GEPA optimizer.         ║
# ║                                                                        ║
# ║   here:                                                                ║
# ║     optimize_for_recipe (GEPA entrypoint)                              ║
# ║     persist_winner + propose_for_losing_recipes                        ║
# ║   moved out (public names re-exported here):                           ║
# ║     _gepa_failures         failure collection (journal + ledger)       ║
# ║     _gepa_helpers          dataset merging, canary keys, replay        ║
# ║                            summaries, eval_fn + failure sampler        ║
# ║     _gepa_winner_proposal  record_winner_proposal_and_canary           ║
# ║     _gepa_winner_sidecar   applied-winner sidecar, mark applied,       ║
# ║                            canary outcome recording                    ║
# ╚════════════════════════════════════════════════════════════════════════╝
import logging
import os
from typing import TYPE_CHECKING, Any

from runtime.safety.auth.scope import TenantScope, tenant_scoped_path
from runtime.safety.recovery._gepa_failures import (
    collect_failures_from_journal,
    collect_failures_from_ledger,
)
from runtime.safety.recovery._gepa_helpers import (
    _make_eval_fn,
    _make_failure_sampler,
    _merge_failure_samples,
    _merge_positive_datasets,
)
from runtime.safety.recovery._gepa_winner_proposal import (
    record_winner_proposal_and_canary,
)
from runtime.safety.recovery._gepa_winner_sidecar import (
    mark_winner_proposal_applied,
    record_winner_canary_outcome,
    resolve_applied_winner_sidecar,
    write_applied_winner_sidecar,
)
from runtime.safety.recovery.evolution_dataset import EvolutionDatasetBuilder
from runtime.safety.recovery.external_importers import (
    build_external_session_dataset,
    collect_external_session_failures,
)
from runtime.safety.recovery.gepa_optimizer import GepaConfig, gepa_optimize
from runtime.safety.recovery.native_evolution_eval import evaluate_front_native
from runtime.safety.recovery.native_llm_replay import replay_llm_candidates
from runtime.safety.recovery.native_replay import replay_candidates
from runtime.safety.recovery.native_replay_sandbox import run_sandbox_replay
from runtime.safety.recovery.native_turn_replay import replay_turn_candidates

if TYPE_CHECKING:
    from runtime.safety.recovery.gepa_optimizer import GepaResult

_LOG = logging.getLogger("echo.gepa.bridge")


# ═══════════════════════════════════════════════════════════
# Public · "run GEPA on this losing recipe"
# ═══════════════════════════════════════════════════════════


def optimize_for_recipe(
    *,
    seed_prompt: str,
    journal: Any,
    router: Any,
    recipe_id: str | None = None,
    judge_model: str = "claude-sonnet-4-6",
    mutator_model: str = "claude-sonnet-4-6",
    n_iter: int = 10,
    eval_tasks: int = 5,
    ledger_path: Any = "data/proposal_ledger.jsonl",
    trigger: str = "manual",
    record_winner: bool = True,
    scope: TenantScope | None = None,
) -> GepaResult:
    """End-to-end · pulls failures, builds eval_fn, runs gepa.

    Caller (RecipeEvaluator wiring or admin endpoint) supplies
    the seed_prompt (typically the planner's CURRENT system
    prompt) · we figure out the rest from the journal. Returns
    a ``GepaResult`` so the operator can inspect candidates
    before deciding to apply.
    """
    effective_ledger_path = (
        tenant_scoped_path(ledger_path, scope) if scope is not None else ledger_path
    )
    journal_failures = collect_failures_from_journal(
        journal,
        recipe_id=recipe_id,
        limit=eval_tasks * 2,
        scope=scope,
    )
    ledger_failures = collect_failures_from_ledger(
        ledger_path=effective_ledger_path,
        recipe_id=recipe_id,
        limit=eval_tasks * 2,
        scope=scope,
    )
    external_failures = (
        collect_external_session_failures(limit=eval_tasks * 2)
        if scope is None or scope.allow_cross_tenant
        else []
    )
    failures = _merge_failure_samples(
        _merge_failure_samples(
            journal_failures,
            ledger_failures,
            limit=eval_tasks * 3,
        ),
        external_failures,
        limit=eval_tasks * 2,
    )
    dataset_builder = EvolutionDatasetBuilder()
    clustered_failures = dataset_builder.annotate_failure_clusters(failures)
    normalized_dataset = dataset_builder.build_from_failure_samples(
        clustered_failures,
        source_name="merged_failure",
        include_synthetic=False,
    )
    failures = [
        {
            "goal": ex.task_input,
            "step_count": int(ex.metadata.get("step_count") or 0),
            "last_error": str(ex.metadata.get("last_error") or ""),
            "recipe_id": ex.metadata.get("recipe_id"),
            "source": ex.source,
            "failure_source": ex.metadata.get("failure_source"),
            "failure_cluster": ex.metadata.get("failure_cluster"),
            "failure_cluster_count": int(ex.metadata.get("failure_cluster_count") or 1),
            "proposal_id": ex.metadata.get("proposal_id"),
            "turn_id": ex.metadata.get("turn_id"),
            "thread_id": ex.metadata.get("thread_id"),
            "code_change_paths": ex.metadata.get("code_change_paths") or [],
        }
        for ex in normalized_dataset.all_examples
    ]
    if len(failures) < 2:
        # Not enough signal · don't burn LLM budget. Caller can
        # check ``iterations_run == 0`` to detect this case.
        # Surface a clear actionable hint so the operator knows
        # whether to run the system longer (no failures) or fix
        # the goal-recording path (only empty goals).
        result = GepaResult(
            iterations_run=0,
            final_front=[],
            best_avg=None,
            history=[
                {
                    "skipped": True,
                    "reason": (
                        f"only {len(failures)} usable failures available "
                        "(need ≥2). Either run longer to accumulate real "
                        "failures, or check the trajectory/turn-failure ledger."
                    ),
                    "journal_failures": len(journal_failures),
                    "ledger_failures": len(ledger_failures),
                    "external_failures": len(external_failures),
                }
            ],
            elapsed_s=0.0,
        )
        if record_winner:
            result.winner_proposal = {
                "ok": False,
                "skipped": True,
                "reason": "insufficient_failure_signal",
            }
        return result
    goals = [f["goal"] for f in failures if f.get("goal")]
    eval_fn = _make_eval_fn(goals, router=router, judge_model=judge_model)
    failure_sampler = _make_failure_sampler(failures)
    result = gepa_optimize(
        seed_prompt=seed_prompt,
        eval_fn=eval_fn,
        failure_sampler=failure_sampler,
        router=router,
        model=mutator_model,
        config=GepaConfig(n_iter=n_iter, eval_tasks=eval_tasks),
    )
    positive_dataset = dataset_builder.build_positive_examples(
        journal=journal,
        ledger_path=effective_ledger_path,
        recipe_id=recipe_id,
        limit=eval_tasks * 2,
        scope=scope,
    )
    if scope is None or scope.allow_cross_tenant:
        positive_dataset = _merge_positive_datasets(
            positive_dataset,
            build_external_session_dataset(limit=eval_tasks * 2),
            limit=eval_tasks * 3,
        )
    native_evaluation = evaluate_front_native(
        list(result.final_front or []),
        baseline_prompt=seed_prompt,
        failures=failures,
        positive_dataset=positive_dataset,
    )
    result.native_evaluation = [score.to_dict() for score in native_evaluation]
    replay_report = replay_candidates(
        list(result.final_front or []),
        baseline_prompt=seed_prompt,
        failures=failures,
        positive_dataset=positive_dataset,
    )
    result.native_replay = replay_report.to_dict()
    sandbox_replay_report = run_sandbox_replay(
        list(result.final_front or []),
        failures=failures,
        positive_dataset=positive_dataset,
        baseline_prompt=seed_prompt,
    )
    result.native_sandbox_replay = sandbox_replay_report.to_dict()
    turn_replay_report = replay_turn_candidates(
        list(result.final_front or []),
        failures=failures,
    )
    result.native_turn_replay = turn_replay_report.to_dict()
    llm_replay_report = None
    if os.environ.get("ECHO_EVOLUTION_LLM_REPLAY", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }:
        llm_replay_report = replay_llm_candidates(
            list(result.final_front or []),
            router=router,
            model=judge_model,
            failures=failures,
        )
        result.native_llm_replay = llm_replay_report.to_dict()
    if record_winner:
        try:
            lifecycle = record_winner_proposal_and_canary(
                result,
                recipe_id=recipe_id,
                trigger=trigger,
                ledger_path=ledger_path,
                baseline_prompt=seed_prompt,
                failures=failures,
                positive_dataset=positive_dataset,
                replay_report=replay_report,
                sandbox_replay_report=sandbox_replay_report,
                turn_replay_report=turn_replay_report,
                llm_replay_report=llm_replay_report,
                tenant_scope=scope,
            )
        except Exception as exc:  # noqa: BLE001
            lifecycle = {
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
            }
        result.winner_proposal = lifecycle
    return result


# ═══════════════════════════════════════════════════════════
# Persistence · winner becomes a planner prompt section
# ═══════════════════════════════════════════════════════════


def persist_winner(
    result: GepaResult,
    *,
    section_path: Any,  # str | Path
) -> dict[str, Any]:
    """Write the best candidate's prompt to ``section_path`` ·
    LLMPlanner picks it up via ``load_section`` on next instance.

    Returns a small dict with what was written so the admin UI
    can show ``"applied vN, score=0.78"``.
    """
    if not result.best_avg:
        return {"ok": False, "error": "no winner to persist"}
    try:
        from runtime.core.cerebrum.prompt_persistence import dump_section

        section = (
            "## GEPA-optimized addendum\n\n"
            f"<!-- candidate {result.best_avg.candidate_id} · "
            f"avg_score {result.best_avg.avg_score:.3f} · "
            f"iter {result.best_avg.born_at_iter} · "
            f"rationale: {result.best_avg.rationale} -->\n\n" + result.best_avg.prompt
        )
        dump_section(section_path, section, label="gepa")
        return {
            "ok": True,
            "candidate_id": result.best_avg.candidate_id,
            "avg_score": result.best_avg.avg_score,
            "iter": result.best_avg.born_at_iter,
            "rationale": result.best_avg.rationale,
        }
    except (OSError, ValueError, TypeError, AttributeError, ImportError) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


# ═══════════════════════════════════════════════════════════
# Auto-propose · run GEPA on every losing recipe in one batch
# ═══════════════════════════════════════════════════════════


def propose_for_losing_recipes(
    *,
    journal: Any,
    router: Any,
    seed_prompt: str,
    judge_model: str = "claude-sonnet-4-6",
    mutator_model: str = "claude-sonnet-4-6",
    n_iter: int = 6,
    eval_tasks: int = 4,
    max_recipes: int = 3,
    ledger_path: Any = "data/proposal_ledger.jsonl",
    scope: TenantScope | None = None,
) -> list[dict[str, Any]]:
    from runtime.safety.recovery.gepa_runs import (
        get_default_store,
        record_from_result,
    )
    from runtime.safety.recovery.recipe_evaluator import (
        RecipeEvaluator,
        RecipeEvaluatorConfig,
    )

    # 1. Find recipes RecipeEvaluator considers losing.
    try:
        evaluator = RecipeEvaluator(
            journal,
            RecipeEvaluatorConfig(),
            scope=scope,
        )
        report = evaluator.evaluate()
    except Exception as exc:  # noqa: BLE001
        return [
            {
                "ok": False,
                "error": f"recipe evaluator failed: {type(exc).__name__}: {exc}",
            }
        ]
    losing = [s for s in report.scores if s.verdict == "losing"]
    if not losing:
        return [
            {
                "ok": False,
                "skipped": True,
                "reason": (
                    f"no losing recipes (scanned {report.recipes_found} "
                    f"recipes from {report.trajectories_scanned} trajectories)"
                ),
            }
        ]

    # 2. Run GEPA on each, capped at max_recipes. Sort by worst
    # score first · tackle the most-broken recipe first when budget
    # is tight.
    losing.sort(key=lambda s: s.score)
    out: list[dict[str, Any]] = []
    store = get_default_store()
    for s in losing[:max_recipes]:
        try:
            result = optimize_for_recipe(
                seed_prompt=seed_prompt,
                journal=journal,
                router=router,
                recipe_id=s.recipe_id,
                judge_model=judge_model,
                mutator_model=mutator_model,
                n_iter=n_iter,
                eval_tasks=eval_tasks,
                ledger_path=ledger_path,
                trigger="auto_propose",
                scope=scope,
            )
            rec = record_from_result(
                result,
                trigger="auto_propose",
                recipe_id=s.recipe_id,
            )
            store.add(rec)
            out.append(
                {
                    "ok": True,
                    "recipe_id": s.recipe_id,
                    "ts": rec.ts,
                    "iterations_run": rec.iterations_run,
                    "best_avg_score": rec.best_avg_score,
                    "front_size": rec.front_size,
                    "winner_proposal": getattr(result, "winner_proposal", None),
                }
            )
        except Exception as exc:  # noqa: BLE001
            out.append(
                {
                    "ok": False,
                    "recipe_id": s.recipe_id,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
    return out


__all__ = [
    "collect_failures_from_ledger",
    "collect_failures_from_journal",
    "optimize_for_recipe",
    "persist_winner",
    "propose_for_losing_recipes",
    "mark_winner_proposal_applied",
    "record_winner_canary_outcome",
    "record_winner_proposal_and_canary",
    "resolve_applied_winner_sidecar",
    "write_applied_winner_sidecar",
]
