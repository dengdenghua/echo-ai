---
type: "SafetySubsystem"
title: "Safety · Unified Self-evolution"
description: "统一经验、评分、反思、Prompt / Skill / 团队优化，以及候选验证、灰度与回滚。"
tags: ["backend", "safety"]
tier: "core"
---
# Safety · Unified Self-evolution

> 统一经验、评分、反思、Prompt / Skill / 团队优化，以及候选验证、灰度与回滚。

**Source**: `runtime/safety/evolution/`

## Package summary

Unified self-evolution: experience, reflection, optimization and governed rollout.

## Modules

| Module | Summary |
| --- | --- |
| `_agent_competitor_scorecard_drilldown.py` | — |
| `_agent_competitor_scorecard_evidence.py` | — |
| `_agent_competitor_scorecard_models.py` | — |
| `_agent_competitor_scorecard_scoring.py` | — |
| `_experience_ledger_formatting.py` | Sorting, formatting, and time helpers for the experience ledger. |
| `_gepa_failures.py` | Failure-sample collectors extracted from ``gepa_bridge.py``. |
| `_gepa_helpers.py` | Private helpers extracted from ``gepa_bridge.py``. |
| `_recipes_api.py` | API check/mutation helpers for browser/desktop repair recipe evidence. |
| `_recipes_cluster.py` | Cluster key derivation and recipe body builders for browser/desktop repair recipes. |
| `_recipes_common.py` | Shared schema constants and small utilities for browser/desktop repair recipes. |
| `_recipes_evidence.py` | Fresh evidence producers for browser/desktop repair recipe reruns. |
| `agent_benchmark.py` | — |
| `agent_competitor_scorecard.py` | — |
| `agent_loop_quality.py` | — |
| `auto_retire.py` | — |
| `auto_trigger.py` | — |
| `auto_verifier.py` | — |
| `auto_verifier_metrics.py` | — |
| `automation_radar.py` | — |
| `behavioral_surpass_evidence.py` | — |
| `browser_desktop_quality.py` | — |
| `browser_desktop_repair_recipes.py` | Browser/desktop repair recipe orchestration. |
| `canary.py` | — |
| `candidate_canary.py` | Candidate-scoped canary rollout, promotion, and rollback coordination. |
| `candidate_registry.py` | Typed evolution candidates and append-only lineage persistence. |
| `codex_gap.py` | — |
| `deep_evolution.py` | deep_evolution · LLM-judged self-evaluation (B2) + self-evolution (B3). |
| `digital_employee_quality.py` | — |
| `drift_monitor.py` | — |
| `dual_helix.py` | Task-level pairing evidence for Echo ↔ Codex evolution. |
| `dual_helix_policy.py` | Risk policy for optional dual-engine shadow reviews. |
| `dual_helix_shadow.py` | Opt-in, read-only shadow reviews on bounded workspace snapshots. |
| `e2e_surpass_certification.py` | — |
| `ecosystem_readiness.py` | — |
| `evolution_constraints.py` | — |
| `evolution_dataset.py` | Unified dataset builder for regeneration and prompt evolution. |
| `experience_ledger.py` | Durable ledger for TaskRun review lessons and experiment candidates. |
| `experiment_protocol.py` | Versioned experiment evidence for engine and genome comparisons. |
| `experiment_scheduler.py` | — |
| `external_importers.py` | — |
| `federation.py` | — |
| `fitness.py` | — |
| `forge_auto_tick.py` | RecipeForge auto-promote scheduler · the last-mile autonomy knob. |
| `forge_router.py` | EvolutionRouter · route evolution candidates to the right forge. |
| `genome_registry.py` | Genome Registry — versioned JSON snapshot store for system configuration. |
| `gepa_addendum_store.py` | — |
| `gepa_bridge.py` | Bridge between Echo's existing reflection layer and the GEPA prompt optimizer. |
| `gepa_optimizer.py` | GEPA-style prompt optimizer · 7th reflection path. |
| `gepa_runs.py` | — |
| `gepa_variants.py` | Multi-variant per-recipe addendums · turns GEPA from "one optimized prompt per recipe" into "N candidate prompts per recipe, traffic- split by weight, sticky per conversation". |
| `governance_audit.py` | — |
| `governance_audit_rotation.py` | — |
| `guard_judge.py` | Guard false-positive judge — semantic second-pass review. |
| `guard_judge_batch.py` | Batch runner — drains unjudged guard hits through the LLM judge. |
| `guard_telemetry.py` | Guard-hit telemetry — the P1 evolution-loop feed. |
| `intel_collector.py` | — |
| `kg_updater.py` | — |
| `kimi_swarm_certification.py` | — |
| `kimi_swarm_failure_taxonomy.py` | Provider-error classification for the Kimi Swarm load-test family. |
| `kimi_swarm_load_run.py` | Load-test execution engine for the Kimi Swarm load-test family. |
| `kimi_swarm_load_test.py` | Kimi Swarm reference load-test / certification pipeline — orchestrator. |
| `kimi_swarm_proof_lookup.py` | Control-session history / proof lookup for the Kimi Swarm load-test family. |
| `kimi_swarm_resume_planner.py` | Resume-plan computation for the Kimi Swarm load-test family. |
| `kimi_swarm_types.py` | Shared config/constant/stage-resolution types for the Kimi Swarm load-test family (kimi_swarm_load_test.py + its siblings). |
| `learning_scheduler.py` | — |
| `lightweight_shadow.py` | — |
| `loop_learning.py` | — |
| `memory_consolidator.py` | — |
| `native_evolution_eval.py` | — |
| `native_llm_replay.py` | — |
| `native_replay.py` | — |
| `native_replay_sandbox.py` | — |
| `native_turn_replay.py` | — |
| `optimizer_backends.py` | Pluggable prompt-optimizer backends for Echo evolution. |
| `pareto.py` | — |
| `parity_certification.py` | — |
| `permission_sandbox_quality.py` | — |
| `plugin_migration_readiness.py` | — |
| `policy_review_rules.py` | Signed draft rules derived from replay-backed policy review proposals. |
| `preflight.py` | Production preflight CLI — dress-rehearsal report for ops. |
| `product_experience_quality.py` | — |
| `promotion_applier.py` | Safe applier for promoted Review Queue items. |
| `prompt_evolver.py` | — |
| `prompt_mutator.py` | — |
| `prompt_optimizer.py` | — |
| `proposal_ledger.py` | — |
| `recipe_evaluator.py` | — |
| `reflex_forge.py` | ReflexForge · auto-generate reflex rules from successful turns. |
| `regression_rollback.py` | Fail-closed rollback of governed candidates after a score regression. |
| `repair_route_quality.py` | — |
| `replay_latency_budget.py` | — |
| `repo_context_quality.py` | — |
| `review_queue.py` | Durable human-review queue for TaskRun self-improvement candidates. |
| `rollback_coordinator.py` | Unified rollback coordinator for canary, ledger, and fitness subsystems. |
| `rule_extractor.py` | — |
| `run_batch_cron.py` | Cron-callable entry point for the guard-judge batch runner. |
| `runtime_deployment.py` | Runtime selection for governed evolution candidates. |
| `runtime_outcomes.py` | Durably attribute real turn outcomes to governed canary candidates. |
| `scorecard_calculations.py` | Pure score aggregation and prioritization helpers. |
| `service.py` | One host-owned lifecycle for the self-evolution subsystem. |
| `skill_curator.py` | — |
| `skill_forge.py` | — |
| `skill_usage.py` | — |
| `soul_actions.py` | Agent lessons, reflection and SOUL rollback owned by self-evolution. |
| `soul_holdout.py` | soul_holdout · pre-flight evaluation gate for ``deep_evolve``. |
| `strategy.py` | — |
| `subagent_fitness.py` | Fitness scoring for delegated subagent roles. |
| `subagent_policy.py` | Operator-managed subagent routing policy. |
| `subagent_review.py` | Turn subagent outputs into trace-linked review queue candidates. |
| `subagent_routing.py` | Routing policy that uses subagent fitness before delegated work runs. |
| `subagent_team_promotion.py` | Promote trusted subagent roles into team-topology proposals. |
| `tenant_scope.py` | Tenant-safe journal reads for learning and regeneration. |
| `topology_evolver.py` | TopologyEvolver — proposes new team topologies from the perf log. |
| `topology_forge.py` | TopologyForge — apply proposals through the gene-lock gate. |
| `turn_learning.py` | Derive pending experience candidates from scoped terminal evidence. |
| `turn_regression.py` | Periodic regression checks after scoped turn scoring. |
| `turn_scoring.py` | — |
| `variant.py` | — |
| `variant_evaluator.py` | — |
| `weekly_report.py` | Weekly guard-telemetry report — the human-facing P1 artifact. |
| `workflow_applier.py` | — |
| `workflow_rewriter.py` | — |

## Key classes & functions

> AST 自动提取 · 仅列公开顶层 class / function · 签名与真实代码一致。

### `_agent_competitor_scorecard_models.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ScoreDimension` |  |

### `_experience_ledger_formatting.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def source_from_review(review)` |  |
| func | `def record_sort_key(row)` |  |
| func | `def record_recall_sort_key(row)` |  |
| func | `def weekly_record_sort_key(row)` |  |
| func | `def next_actions(rows)` |  |
| func | `def quality_next_actions(stale_count, contradicted_count, low_reliability_count)` |  |
| func | `def avg(values)` |  |
| func | `def within_week(value, start, end)` |  |
| func | `def week_start(value, now)` |  |
| func | `def iso(value)` |  |
| func | `def clean_text(value, limit)` |  |
| func | `def clean_unique_list(value, limit)` |  |
| func | `def merge_unique(left, right)` |  |
| func | `def priority(value)` |  |
| func | `def higher_priority(left, right)` |  |
| func | `def tags_for(kind, item_priority, bucket)` |  |

### `_gepa_failures.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def collect_failures_from_journal(journal, recipe_id, limit, scope)` | Pull failed trajectories · optionally filter by recipe. |
| func | `def collect_failures_from_ledger(ledger_path, recipe_id, limit, scope)` | Pull realtime failed-turn records from ProposalLedger. |

### `agent_benchmark.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class AgentBenchmarkCase` |  |
| func | `def compute_agent_benchmark(root)` |  |

### `agent_competitor_scorecard.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def compute_agent_competitor_scorecard(root, target_score, surpass_margin)` |  |

### `agent_loop_quality.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class AgentLoopCheck` |  |
| func | `def compute_agent_loop_quality(root)` |  |

### `auto_retire.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class VariantRetired(NervesEvent)` |  |
| class | `class VariantBoosted(NervesEvent)` |  |
| class | `class EvolverStepTriggered(NervesEvent)` |  |
| class | `class AutoRetireConfig` |  |
| class | `class AutoRetireStats` |  |
| class | `class AutoRetireScheduler` |  |

### `auto_trigger.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class AutoTriggerConfig` |  |
| func | `def registered_evolution_agent_ids(agent_registry, configured_agent_ids)` | Return exact safe registry ids, optionally narrowed by an allowlist. |
| func | `def resolve_evolution_agent_ids(stack, agent_registry, configured_agent_ids, scope)` | Resolve the exact agents eligible for a periodic evolution check. |
| class | `class EvolutionAutoTrigger` |  |
| func | `def get_auto_trigger()` |  |

### `auto_verifier.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def run_verification_plan(plan, sandbox_policy, max_commands)` | Run a bounded verifier batch, stopping at the first failure. |
| func | `def run_highest_priority_verification(plan, sandbox_policy)` |  |
| func | `def build_verification_repair_request(plan, items, attempt, max_attempts)` | Build bounded, evidence-carrying input for a model repair round. |
| func | `def build_agent_verification_request(plan, attempt, max_attempts)` | Build a bounded, run-the-plan prompt when code changed with no recorded verification evidence. |

### `auto_verifier_metrics.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class AutoVerifierMetric` |  |
| func | `def record_auto_verifier_metric(command, kind, ok, exit_code, duration_ms, target, reason, path)` |  |
| func | `def summarize_auto_verifier_metrics(path, limit)` |  |
| func | `def queue_verifier_drift_backlog(metrics_path, review_queue_path, limit)` |  |
| func | `def rank_verification_commands(commands, path, limit)` |  |
| func | `def explain_verification_ranking(commands, path, limit)` |  |
| func | `def record_auto_verifier_decision(candidates, selected_command, path)` |  |
| func | `def record_auto_verifier_batch(candidate_count, commands, passed_count, stop_reason, path)` |  |
| func | `def record_auto_verifier_repair_attempt(attempt, max_attempts, status, failed_commands, fresh_evidence_commands, path)` |  |
| func | `def recent_auto_verifier_decisions(path, limit)` |  |
| func | `def recent_auto_verifier_batches(path, limit)` |  |
| func | `def recent_auto_verifier_repair_attempts(path, limit)` |  |
| func | `def command_family(command)` |  |

### `automation_radar.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class AutomationRadarDimension` |  |
| func | `def compute_automation_radar(root, review_queue_path, target_score)` |  |

### `behavioral_surpass_evidence.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def compute_behavioral_surpass_evidence(root, bundle_path, now, max_age_days, min_k, min_cases_per_domain, min_pass_pow_k, surpass_margin)` |  |
| func | `def validate_behavioral_system_provenance(raw, system_id)` | Validate and normalize one system's release-evidence identity policy. |
| func | `def behavioral_system_provenance_digest(provenance)` | Return the canonical digest embedded in every trajectory artifact. |

### `browser_desktop_quality.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class BrowserDesktopCheck` |  |
| func | `def compute_browser_desktop_quality(root, review_queue_path)` |  |

### `browser_desktop_repair_recipes.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def compute_browser_desktop_repair_recipes(review_queue_path, limit, min_occurrences)` |  |
| func | `def queue_browser_desktop_repair_recipes(review_queue_path, limit, min_occurrences)` |  |
| func | `def reject_stale_browser_desktop_replay_artifacts(review_queue_path, limit)` |  |
| func | `def compute_browser_desktop_repair_recipe_verifications(review_queue_path, limit)` |  |
| func | `def attach_browser_desktop_repair_recipe_evidence(item_id, passed, provided, artifacts, notes, actor, review_queue_path)` |  |
| func | `def rerun_browser_desktop_repair_recipe_evidence(item_id, review_queue_path, api_base_url, promote_source_cases, actor, api_get, api_request)` |  |
| func | `def rerun_browser_desktop_repair_recipe_batch(review_queue_path, api_base_url, promote_source_cases, actor, limit, api_get, api_request)` |  |

### `canary.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class CanaryPersistenceError(RuntimeError)` | A canary mutation could not be proven durable. |
| class | `class CanaryOutcomeConflictError(ValueError)` | One idempotency key was reused for a different outcome. |
| class | `class CanaryReceiptLimitError(CanaryPersistenceError)` | The durable receipt ledger cannot accept another unique outcome. |
| class | `class CanaryPhase(StrEnum)` |  |
| class | `class CanaryConfig` |  |
| class | `class CanaryState` |  |
| class | `class CanaryManager` |  |

### `candidate_canary.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class CandidateCanaryManager` | Bind generic traffic phases to one typed candidate deployment key. |

### `candidate_registry.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class CandidateRegistryError(RuntimeError)` | Candidate lineage storage is unavailable, corrupt, or not durable. |
| class | `class GeneType(StrEnum)` |  |
| class | `class CandidateStatus(StrEnum)` |  |
| class | `class EvolutionCandidate` |  |
| func | `def candidate_id_for(gene_type, scope, patch, parent_id, tenant_id, owner_actor_id)` |  |
| class | `class CandidateRegistry` | Append-only candidate events; latest event is the current state. |

### `codex_gap.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class GapCapability` |  |
| class | `class GapBehaviorCheck` |  |
| func | `def compute_codex_gap_report(root)` |  |

### `deep_evolution.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def set_evolve_router(router, default_model)` | Bootstrap hook · install the router used for deep_reflect / deep_evolve. Pass ``None`` to disable. |
| func | `def deep_reflect(agent_id, window, model, scope)` | LLM-judged review of recent turns. Cheap (single LLM call). |
| func | `def deep_evolve(agent_id, window, candidates_per_round, max_rounds, dry_run, model, legacy_direct_apply, candidate_registry_path, scope)` | MiniMax-style autonomous self-improvement loop. EXPENSIVE. |

### `digital_employee_quality.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class DigitalEmployeeCheck` |  |
| func | `def compute_digital_employee_quality(root)` |  |

### `drift_monitor.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class DriftConfig` |  |
| class | `class DriftEvent` |  |
| class | `class DriftReport` |  |
| class | `class DriftMonitor` |  |

### `dual_helix.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def build_dual_helix_evidence(records, limit)` |  |

### `dual_helix_policy.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ShadowTriggerDecision` | Auditable result of one automatic-shadow policy evaluation. |
| func | `def decide_shadow_trigger(auto_enabled, candidate_status, risk_level, failure_count, confidence)` | Decide if an automatic shadow review is warranted. |

### `dual_helix_shadow.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ShadowRun` |  |
| class | `class DualHelixShadowService` |  |
| func | `def materialize_shadow_snapshot(source, destination)` |  |
| func | `def build_codex_shadow_runner(stack, agent_registry)` |  |
| func | `def build_native_shadow_runner(stack)` |  |
| func | `def parse_shadow_review(value)` | Normalize new structured reviews and legacy PASS/FAIL text. |

### `e2e_surpass_certification.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class E2ECoverageDomain` |  |
| func | `def compute_e2e_surpass_certification(target_score, review_queue_path, behavioral_bundle_path)` | One operator-facing proof that Echo clears the E2E Codex bar. |

### `ecosystem_readiness.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ReadinessTopic` |  |
| func | `def compute_ecosystem_readiness(root)` |  |

### `evolution_constraints.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class EvolutionConstraintResult` |  |
| class | `class EvolutionConstraintConfig` |  |
| class | `class EvolutionConstraintValidator` | Validate evolved planner/system-prompt candidates. |
| func | `def serialize_constraint_results(results)` |  |

### `evolution_dataset.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class EvolutionExample` | One normalized example for evolution/eval. |
| class | `class EvolutionDataset` | Split dataset used by prompt evolution and downstream evals. |
| class | `class FailureCluster` | Repeated failure pattern used to prioritize reflection. |
| class | `class EvolutionDatasetBuilder` | Build datasets from the failure samples Echo already collects. |

### `experience_ledger.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ExperienceLedger` | Append-friendly, deduplicating store for agent self-improvement notes. |

### `experiment_protocol.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class TrialStatus(StrEnum)` |  |
| class | `class TaskSpec` |  |
| class | `class ExperimentTrial` |  |
| func | `def new_experiment_id(prefix)` |  |
| func | `def new_run_id(prefix)` |  |
| class | `class ExperimentStore` | Append-only JSONL store for deliberate experiment trials. |
| func | `def build_pair_evidence(trials, primary_metric, limit)` | Build strict pair evidence without treating infrastructure errors as losses. |

### `experiment_scheduler.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class CamouflageConfig` |  |
| class | `class CamouflageScheduler` |  |
| func | `def get_camouflage_scheduler()` |  |

### `external_importers.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ImportedSessionSample` |  |
| class | `class SessionImportReport` |  |
| func | `def discover_external_session_roots(paths)` |  |
| func | `def import_external_sessions(paths, limit, max_file_bytes)` |  |
| func | `def collect_external_session_failures(paths, limit)` |  |
| func | `def build_external_session_dataset(paths, limit)` |  |

### `federation.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SharedProposal` |  |
| class | `class FederationConfig` |  |
| class | `class FederationHub` |  |

### `fitness.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class FitnessConfig` |  |
| class | `class L1Fitness` |  |
| class | `class L2Fitness` |  |
| class | `class GovernanceFitness` |  |
| class | `class FitnessReport` |  |
| func | `def compute_l1(agent_id, window, scope)` |  |
| func | `def compute_l2(agent_id, l1, model, window, scope)` |  |
| func | `def compute_governance_fitness(agent_id, audit_path, window, max_penalty, blocked_override_weight, gate_failed_weight, override_weight, failed_apply_weight, scope)` |  |
| func | `def compute_fitness(agent_id, config, publish_event, scope)` |  |

### `forge_auto_tick.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class TickResult` | One tick's outcome · per-recipe actions + timing. |
| class | `class SchedulerState` | Singleton state for the scheduler · exposed to the admin endpoint so the panel can show when the next tick is. |
| func | `def bind_stack(stack)` | Called once at backend startup · gives the scheduler access to the journal + planner router. Safe to call repeatedly · last binding wins. |
| func | `def run_tick(min_uses, min_lead, apply, journal, scope)` |  |
| func | `def enable(interval_hours, min_uses, min_lead)` | Start the scheduler thread · idempotent (repeat calls adjust config without spawning a new thread). |
| func | `def disable()` | Signal the scheduler to stop · non-blocking (returns immediately · thread exits on next stop-event check, at most 5 seconds later). |
| func | `def stop(timeout)` | Stop and join the optional recipe timer during unified host shutdown. |
| func | `def get_status()` |  |

### `forge_router.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class EvolutionVerdict` | The router's decision for one candidate. |
| class | `class EvolutionRouter` | Classify evolution candidates into reflex vs skill paths. |

### `genome_registry.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class GenomeRegistryConfig` |  |
| class | `class GenomeRegistry` |  |

### `gepa_addendum_store.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def addendum_path(recipe_id)` |  |
| func | `def legacy_global_path()` | Single-file global addendum path · returns the current name (``data/forge_planner_addendum.md``). Also auto-migrates the old ``data/gepa_pla |
| func | `def load_for_recipe(recipe_id)` | Return the per-recipe addendum content as a string · ``""`` when no file exists OR ``recipe_id`` is None / empty. |
| func | `def load_global()` | Return the legacy global addendum · ``""`` when not present. Kept separate from ``load_for_recipe`` so the planner can deliberately concaten |
| func | `def save_for_recipe(recipe_id, content)` | Atomic write · tmp file + rename. Caller already added the "## GEPA-optimized addendum" header + metadata · we just persist the bytes. |
| func | `def delete_for_recipe(recipe_id)` | Remove a per-recipe addendum · returns True if a file was deleted, False if there was nothing there to begin with. |
| func | `def list_all()` | Return one entry per stored addendum (per-recipe + legacy global). Each entry has enough metadata for the panel to render a row without furt |

### `gepa_bridge.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def write_applied_winner_sidecar(recipe_id, candidate_id, proposal_id, canary_key, avg_score, variant_id, metadata_root)` |  |
| func | `def resolve_applied_winner_sidecar(recipe_hash, metadata_root)` |  |
| func | `def mark_winner_proposal_applied(recipe_id, candidate_id, variant_id, proposal_id, canary_key, ledger_path, metadata_root, fitness_after)` |  |
| func | `def record_winner_canary_outcome(recipe_hash, success, metadata_root, canary_config)` |  |
| func | `def record_winner_proposal_and_canary(result, recipe_id, trigger, ledger_path, canary_config, run_ts, require_improvement, min_score_delta, baseline_prompt, failures, positive_dataset, replay_report, sandbox_replay_report, turn_replay_report, llm_replay_report, min_replay_score, min_sandbox_replay_score, min_turn_replay_score, min_llm_replay_score, tenant_scope)` | Materialize the optimizer winner as an auditable proposal. |
| func | `def optimize_for_recipe(seed_prompt, journal, router, recipe_id, judge_model, mutator_model, n_iter, eval_tasks, ledger_path, trigger, record_winner, scope)` | End-to-end · pulls failures, builds eval_fn, runs gepa. |
| func | `def persist_winner(result, section_path)` | Write the best candidate's prompt to ``section_path`` · LLMPlanner picks it up via ``load_section`` on next instance. |
| func | `def propose_for_losing_recipes(journal, router, seed_prompt, judge_model, mutator_model, n_iter, eval_tasks, max_recipes, ledger_path, scope)` |  |

### `gepa_optimizer.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class PromptCandidate` | One member of the optimization population. |
| func | `def dominates(a, b)` | ``a`` Pareto-dominates ``b`` iff a is no-worse on every task AND strictly better on at least one. Standard Pareto definition. |
| func | `def pareto_front(pop)` | Return non-dominated members. O(N²) is fine since populations are small (typically <30 candidates). |
| class | `class MutationContext` | Inputs to the LLM mutator · keeps the call site terse. |
| func | `def llm_mutate(parent, ctx, router, model, iter_idx)` | One mutation call · returns a new candidate or None on LLM failure. Defensive against malformed JSON · the GEPA loop treats None as "skip th |
| class | `class GepaConfig` |  |
| class | `class GepaResult` |  |
| func | `def gepa_optimize(seed_prompt, eval_fn, failure_sampler, router, model, config)` | Run the loop. Caller-supplied ``eval_fn`` makes this generic enough to optimize any prompt as long as you can score it. |

### `gepa_runs.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class GepaRunRecord` | One persisted GEPA run · summarised so the store stays small. |
| class | `class GepaRunStore` | Bounded ring buffer of recent runs · accessible from anywhere via ``get_default_store``. Records are immutable except for ``mark_applied`` w |
| func | `def get_default_store()` | Return the process-wide store · lazy-init from env. |
| func | `def record_from_result(result, trigger, recipe_id)` | Convert a ``GepaResult`` (loose-typed via Any to avoid an import cycle) into a compact record. Trims history to 30 entries so a long run doe |
| func | `def enrich_run_records(runs, ledger_path, canary_config)` | Attach current proposal/canary lifecycle state to run rows. |

### `gepa_variants.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def variant_path(recipe_id, variant_id)` | ``data/gepa_addendums/<recipe>__<variant>.md`` |
| func | `def manifest_path(recipe_id)` |  |
| class | `class VariantEntry` | One row in a recipe's variant manifest. |
| class | `class VariantManifest` | Per-recipe manifest · what variants exist, their weights, plus ``default_weight`` (the "no addendum" control group). |
| func | `def load_manifest(recipe_id)` |  |
| func | `def save_manifest(m)` | Atomic write · tmp + rename. Caller bumps ``updated_at`` before calling so a reader can detect 'manifest changed since last poll' if it cach |
| func | `def add_variant(recipe_id, variant_id, content, weight, candidate_id, rationale, avg_score)` | Save a variant file + register in manifest. If the variant_id already exists, REPLACES the content + updates metadata (existing weight is pr |
| func | `def remove_variant(recipe_id, variant_id)` | Drop a variant · removes the file AND the manifest entry. Returns True when something was actually removed. |
| func | `def set_weights(recipe_id, weights, default_weight)` | Bulk-update weights · operator's "shift more traffic to vB" knob. ``weights`` is ``{variant_id: new_weight}`` for each one you want to chang |
| func | `def list_variants(recipe_id)` | Return manifest + per-variant content preview for the UI. |
| func | `def select_variant(recipe_id, conversation_id)` | Pick a variant for this turn · returns (variant_id, content). |
| func | `def list_all_manifests()` | Scan the addendum dir for every ``*_manifest.json`` · return one summary per recipe with a live manifest. Powers the "all recipes with A/B r |

### `governance_audit.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def promotion_audit_signals(row)` |  |
| func | `def append_governance_audit_event(event_type, target, status, artifact, decision_context, agent_id, audit_path, audit_chain_path, audit_chain_secret, now)` | Append a non-promotion governance event to the audit stream. |
| func | `def verify_governance_audit_chain(audit_path, audit_chain_path, audit_chain_secret, limit)` | Verify the tamper-evident governance audit chain. |
| func | `def export_governance_audit_bundle(audit_path, audit_chain_path)` | Return a self-contained governance audit export bundle. |

### `governance_audit_rotation.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def configure_governance_audit_rotation(enabled, cron_expression, retention_count, actor, audit_path, config_path, now)` | Persist a safe, shell-free schedule for governance audit exports. |
| func | `def governance_audit_rotation_status(audit_path, config_path, export_dir, state_path, now)` |  |
| func | `def run_due_governance_audit_rotation(force, actor, audit_path, audit_chain_path, config_path, export_dir, state_path, now)` | Create a verified export when due and rotate old bundles by policy. |
| func | `def register_governance_audit_rotation_task(runner)` | Attach the policy-driven rotation tick to the persistent scheduler. |

### `guard_judge.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class GuardJudgeVerdict` | Verdict for one guard hit. |
| func | `def null_guard_judge(label, guard_message, trajectory_excerpt)` | Default — always uncertain. Used when no LLM is wired so the digest aggregator silently treats every hit as unjudged. |
| func | `def build_guard_judge_from_router(router, model, system_provider, max_tokens, temperature, max_excerpt_chars, prompt_template)` | Build a guard-accuracy judge backed by ``router``. |

### `guard_judge_batch.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class BatchResult` | Summary of one ``run_judge_batch`` call. |
| func | `def run_judge_batch(sink, judge, trajectory_provider, max_hits, failure_streak_limit, guard_message_provider, dry_run)` | Drain unjudged hits through the configured judge. |
| func | `def render_batch_result(result)` | Human-readable one-screen summary — for cron logs. |
| func | `def batch_result_to_dict(result)` | Used by the upcoming weekly digest writer. |

### `guard_telemetry.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class GuardHitRecord` | One guard firing against a candidate Final Answer. |
| class | `class GuardVerdictRecord` | A judge's verdict on a previously-recorded guard hit. |
| class | `class GuardTelemetry` | Append-only JSONL sink for guard hits, with category aggregation. |
| func | `def default_guard_digest_provider()` | Return the current GuardTelemetry digest, or None on any failure. |

### `intel_collector.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class IntelSource(BaseModel)` |  |
| class | `class IntelRunReport(BaseModel)` |  |
| class | `class CollectorConfig` |  |
| class | `class IntelCollector` |  |

### `kg_updater.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class KGUpdateReport(BaseModel)` |  |
| class | `class KGUpdater` |  |
| func | `def persist_kg_from_journal(journal, kg_db_path, multi_valued_predicates, scope)` | Distil triples from a journal and PERSIST them to a durable KG. |

### `kimi_swarm_certification.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class KimiSwarmEvidenceCheck` |  |
| func | `def compute_kimi_swarm_certification(root, data_dir, provider_configured)` |  |

### `kimi_swarm_load_run.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def run_kimi_swarm_load_test(config, store, provider_caller)` | Run a Kimi Swarm reference load test and persist replay evidence. |

### `kimi_swarm_load_test.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def build_kimi_swarm_load_test_preflight(config, provider_configured, store, data_dir)` | Return a no-side-effect readiness report for a Kimi-scale load test. |
| func | `def run_kimi_swarm_quota_probe(config, store, provider_caller)` |  |
| func | `def export_kimi_swarm_proof_bundle(store, data_dir)` | Build a tamper-evident proof bundle for the best full-reference run. |
| func | `def recommend_kimi_swarm_next_stage(provider_id, model, agent_count, step_count, max_concurrency, provider_configured, store, data_dir)` | Return the next safe stage payload needed to reach full proof. |

### `kimi_swarm_proof_lookup.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def latest_kimi_swarm_load_test(store, data_dir)` |  |
| func | `def kimi_swarm_load_test_history(store, data_dir, limit)` |  |
| func | `def best_kimi_swarm_load_test_proof(store, data_dir)` |  |
| func | `def latest_successful_stage_proof(provider_id, model, requested_agent_count, requested_step_count, stage_id, store, data_dir)` |  |

### `kimi_swarm_resume_planner.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def build_kimi_swarm_resume_plan(provider_id, model, agent_count, step_count, max_concurrency, store, data_dir)` | Return a replay-backed plan to resume a failed full-reference run. |

### `kimi_swarm_types.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class KimiSwarmLoadTestConfig` |  |
| class | `class KimiSwarmQuotaProbeConfig` |  |

### `learning_scheduler.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class GovernedSkillForgeUnavailable(RuntimeError)` | The installed SkillForge cannot guarantee candidate-only rollout. |
| class | `class SchedulerConfig` |  |
| class | `class RegenerationScheduler` |  |
| func | `def get_scheduler()` |  |

### `lightweight_shadow.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ShadowConfig` |  |
| class | `class ShadowResult` |  |
| func | `def lightweight_shadow_validate(candidate, registry, config)` |  |

### `loop_learning.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def build_loop_repair_candidate_spec(run)` | Build a typed prompt candidate only from sealed, local repair evidence. |
| func | `def build_loop_run_review(run)` |  |

### `memory_consolidator.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ConsolidatedMemory(BaseModel)` |  |
| class | `class ConsolidationReport(BaseModel)` |  |
| class | `class ConsolidatorConfig` |  |
| class | `class MemoryConsolidator` |  |
| func | `def filter_memories_for_agent(memories, agent_id, groups)` |  |
| func | `def format_memories_for_prompt(memories, header, max_total_chars, only_hot)` |  |

### `native_evolution_eval.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class NativeEvolutionWeights` |  |
| class | `class NativeEvolutionScore` |  |
| func | `def score_candidate_native(candidate, baseline_prompt, failures, positive_dataset, weights, validator)` |  |
| func | `def evaluate_front_native(candidates, baseline_prompt, failures, positive_dataset)` |  |

### `native_llm_replay.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class LLMReplayCaseResult` |  |
| class | `class LLMReplayCandidateReport` |  |
| class | `class LLMReplayReport` |  |
| func | `def replay_llm_candidates(candidates, router, model, failures, cases, workspace_root, max_cases, max_tool_rounds, min_case_score)` |  |

### `native_replay.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ReplayCase` |  |
| class | `class ReplayCaseResult` |  |
| class | `class ReplayCandidateReport` |  |
| class | `class ReplayReport` |  |
| func | `def build_replay_cases(failures, positive_dataset, failure_limit, positive_limit)` |  |
| func | `def replay_candidate(candidate, cases, baseline_prompt, failures, positive_dataset)` |  |
| func | `def replay_candidates(candidates, baseline_prompt, failures, positive_dataset, failure_limit, positive_limit)` |  |

### `native_replay_sandbox.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SandboxReplayCaseResult` |  |
| class | `class SandboxReplayCandidateReport` |  |
| class | `class SandboxReplayReport` |  |
| func | `def run_sandbox_replay(candidates, failures, positive_dataset, cases, baseline_prompt, workspace_root, keep_workspaces, min_pass_score)` |  |

### `native_turn_replay.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class TurnReplayCase` |  |
| class | `class TurnReplayCaseResult` |  |
| class | `class TurnReplayCandidateReport` |  |
| class | `class TurnReplayReport` |  |
| func | `def build_turn_replay_cases(failures, limit)` |  |
| func | `def replay_turn_candidates(candidates, failures, cases, min_case_score)` |  |

### `optimizer_backends.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class OptimizerRunConfig` |  |
| class | `class OptimizerRunContext` |  |
| class | `class OptimizerBackend(Protocol)` |  |
| class | `class NativeGepaBackend` |  |
| class | `class DspyGepaBackend` |  |
| class | `class ExternalGepaBackend` |  |
| func | `def available_optimizer_backends()` |  |
| func | `def get_optimizer_backend(name)` |  |
| func | `def optimize_with_backend(seed_prompt, journal, router, config)` |  |

### `pareto.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def pareto_frontier_by_name(points, metrics, maximize)` |  |

### `parity_certification.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class CertificationRequirement` |  |
| func | `def compute_parity_certification(root)` |  |

### `permission_sandbox_quality.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class PermissionSandboxCheck` |  |
| func | `def compute_permission_sandbox_quality(root)` |  |

### `plugin_migration_readiness.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def compute_plugin_migration_readiness(plugins, root)` |  |

### `policy_review_rules.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def build_policy_review_rule_drafts(ledger_path, records, limit)` | Return signed, non-applied static-policy rule drafts. |
| func | `def build_plugin_permission_rule_drafts(plugins, limit)` | Return signed deny-rule drafts for plugin lifecycle risks. |
| func | `def build_automation_policy_rule_drafts(targets, limit)` | Return signed deny-rule drafts for browser and desktop automation. |
| func | `def compute_automation_policy_rule_coverage(targets, limit)` | Return a release-gate proof for high-risk automation policy drafts. |
| func | `def verify_policy_review_rule_draft(draft)` |  |
| func | `def install_policy_review_rule_draft(draft, policy_path, confirm_install)` |  |

### `preflight.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class PreflightResult` | Structured rehearsal output. Renderable as text or JSON. |
| func | `def run_preflight()` |  |
| func | `def render_text(result)` |  |
| func | `def render_json(result)` | Machine-readable form for CI / dashboards. |
| func | `def main(argv)` |  |

### `product_experience_quality.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ProductExperienceCheck` |  |
| func | `def compute_product_experience_quality(root)` |  |

### `promotion_applier.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class PromotionApplier` | Apply human-promoted review items with dry-run and audit records. |

### `prompt_evolver.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class EvolutionPolicy` |  |
| class | `class EvolutionStep` |  |
| class | `class PromptEvolver` |  |

### `prompt_mutator.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class MutationProposal` |  |
| class | `class PromptMutator` |  |

### `prompt_optimizer.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class PromptVariant` |  |
| class | `class VariantReport` |  |
| class | `class PromptOptimizer` |  |
| func | `def load_variants_from_yaml(path)` |  |
| func | `def dump_variants_to_yaml(variants)` |  |

### `proposal_ledger.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ProposalStatus(StrEnum)` |  |
| class | `class ProposalRecord` |  |
| class | `class ProposalLedger` |  |

### `recipe_evaluator.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class RecipeScore(BaseModel)` |  |
| class | `class RecipeEvaluationReport(BaseModel)` |  |
| class | `class RecipeEvaluatorConfig` |  |
| class | `class RecipeEvaluator` |  |
| func | `def format_recipe_report(report, max_rows)` |  |

### `reflex_forge.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ForgedReflexCandidate(BaseModel)` | One proposed reflex rule derived from a prompt-reply cluster. |
| class | `class ReflexForgeResult(BaseModel)` | Outcome of one ``ReflexForge.run()`` tick. |
| class | `class ReflexForgeConfig` |  |
| class | `class ReflexForge` | Forge reflex rules from FuzzyCacheTier (prompt, reply) pairs. |

### `regression_rollback.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class RegressionRollbackError(RuntimeError)` | The rollback could not be proven safe or durable. |
| class | `class RegressionRollbackResult` | Outcome of one exact-partition recovery decision. |
| func | `def rollback_active_candidates_for_regression(agent_id, scope, reason)` | Roll back active candidates for one agent and exact ownership scope. |

### `repair_route_quality.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def compute_repair_route_quality(ledger_path, review_queue_path, limit)` |  |
| func | `def queue_repair_route_promotion_candidates(ledger_path, review_queue_path, limit)` |  |

### `replay_latency_budget.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def compute_replay_latency_budget(corpus_size, candidate_count, max_latency_ms, max_evaluation_us)` | Measure the deterministic turn-replay path against a release budget. |

### `repo_context_quality.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class RepoContextCheck` |  |
| func | `def compute_repo_context_quality(root)` |  |
| func | `def classify_dirty_worktree(lines)` | Classify porcelain short-status rows without losing overlapping risks. |

### `review_queue.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ReviewQueue` | Deduplicating review queue before lessons become durable behavior. |

### `rollback_coordinator.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class RollbackResult` |  |
| class | `class RollbackVerification` |  |
| class | `class RollbackRecord` |  |
| class | `class RollbackCoordinator` |  |

### `rule_extractor.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class LearnedRule(BaseModel)` |  |
| class | `class RuleExtractionReport(BaseModel)` |  |
| class | `class ExtractorConfig` |  |
| class | `class RuleExtractor` |  |
| func | `def format_rules_for_prompt(rules, header, max_total_chars)` |  |

### `run_batch_cron.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def main(argv)` |  |

### `runtime_deployment.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class CandidateRuntimeSelector` | Resolve the newest active candidate for one runtime scope. |
| func | `def default_runtime_selector()` |  |
| func | `def is_rollout_candidate_visible(candidate_id)` |  |
| func | `def load_governed_candidate_skills(runtime_registry)` |  |

### `runtime_outcomes.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class RuntimeOutcomePersistenceError(RuntimeError)` | The activation inbox could not be proven valid and durable. |
| class | `class RuntimeOutcomeConflictError(ValueError)` | One turn was presented with two different terminal outcomes. |
| func | `def record_runtime_candidate_activation(candidate_id, turn_id, inbox_path)` | Persist that one canary candidate materially affected the turn. |
| func | `def active_runtime_candidates(turn_id, inbox_path)` | Return a stable diagnostic snapshot without consuming it. |
| func | `def settle_runtime_candidate_outcomes(turn_id, success, registry, state_dir, inbox_path)` | Settle persisted activations exactly once by the authoritative turn id. |

### `scorecard_calculations.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def weighted_score(dimensions, competitor, score_field)` | Compute the integer weighted score for one competitor. |
| func | `def scorecard_verdict(overall, focal_competitor)` | Classify the focal competitor relative to the strongest peer. |
| func | `def next_focus(rows, limit)` | Select the highest-impact next action from each largest score gap. |

### `service.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def learning_config()` |  |
| class | `class EvolutionService` | Coordinate existing algorithms without duplicating their durable state. |
| func | `def get_evolution_service()` |  |

### `skill_curator.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SkillState(StrEnum)` |  |
| class | `class CuratorAction(StrEnum)` |  |
| class | `class SkillInfo` |  |
| class | `class CuratorProposal` |  |
| class | `class CuratorConfig` |  |
| class | `class CuratorReport` |  |
| class | `class SkillCurator` |  |

### `skill_forge.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def pattern_signature(traj)` |  |
| func | `def path_of(traj)` |  |
| class | `class ForgedSkillCandidate(BaseModel)` |  |
| class | `class SkillForgeResult(BaseModel)` |  |
| class | `class UnsafeSkillPromotionError(ValueError)` | Raised when a forged public skill would wrap dangerous tools. |
| class | `class ForgeConfig` |  |
| class | `class SkillForge` |  |

### `skill_usage.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SkillUsageRecord` |  |
| class | `class SkillUsageStats` |  |
| class | `class SkillUsageTracker` |  |

### `soul_holdout.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class HoldoutEntry` | One holdout prompt + its expected output marker. |
| class | `class HoldoutResult` | Aggregate result of running a SOUL against the holdout set. |
| class | `class GatePolicy` | Pass/fail thresholds for the holdout gate. |
| func | `def load_holdout(agent_id, journal_root, auto_seed, scope)` | Load holdout entries for ``agent_id``. |
| func | `def auto_seed_holdout(agent_id, journal_root, target_count, scope)` | Build a holdout file from the agent's recent successes. |
| func | `def evaluate_against_holdout(agent_id, soul_text, runner, entries, journal_root, scope)` | Run each holdout prompt with ``soul_text`` via ``runner``. |
| func | `def gate(new_result, old_result, policy)` | Apply pass/fail policy. |

### `strategy.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class StrategyDecision` |  |
| class | `class StrategyConfig` |  |
| class | `class StrategyEngine` |  |
| func | `def run_strategy_cycle(agent_id, scope)` | Decision-only evolution cycle, for external orchestrators. |

### `subagent_fitness.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def compute_subagent_fitness(review_queue_path, deep_research_job_store_path, include_deep_research_routes, role, limit)` |  |

### `subagent_policy.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SubagentPolicyStore` |  |
| func | `def evaluate_agent_policy(assignments, path, store)` | Report operator policies that affect a role->agent assignment map. |

### `subagent_review.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def queue_subagent_review_candidate(agent_id, role, prompt, result, context, session, review_queue, review_queue_path)` | Persist one successful subagent output as a pending review candidate. |

### `subagent_routing.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SubagentRouteDecision` |  |
| func | `def decide_subagent_route(role, risk_level, review_queue_path, subagent_policy_path, enabled)` |  |

### `subagent_team_promotion.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def build_subagent_team_promotion_proposals(registry, review_queue_path, subagent_policy_path, min_score, min_promoted, min_confidence, limit)` | Return topology proposals derived from strong subagent evidence. |
| func | `def merged_topology_proposals(persisted, registry, review_queue_path, subagent_policy_path, promotion_lift_report)` | Merge persisted topology proposals with live subagent promotions. |

### `tenant_scope.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def authoritative_scope_context(scope)` | Serialize a server-resolved scope for trusted in-process context. |
| func | `def trusted_scope_from_user_context(user_context)` | Recover only the private scope marker stamped by a server boundary. |
| func | `def trusted_scope_from_session(session)` | Recover a complete principal tuple from a server-owned Session. |
| func | `def is_legacy_unscoped_event(event)` | Return ``True`` only when an event carries no ownership identity. |
| func | `def read_learning_events(journal, event_type, scope)` | Read journal events without implicitly crossing tenant boundaries. |
| func | `def read_learning_journal(journal, scope)` | Read every learnable event under the same fail-closed policy. |

### `topology_evolver.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class TopologyStats` |  |
| class | `class Proposal` |  |
| class | `class EvolverReport` |  |
| class | `class TopologyEvolver` | Run one evolution tick over the performance log. |

### `topology_forge.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class PromoteResult` |  |
| func | `def load_registry(path)` |  |
| func | `def save_registry(registry, path)` |  |
| class | `class TopologyForge` |  |

### `turn_learning.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def queue_finished_turn_review(runtime, turn, status, scope)` | Reuse evidence-derived reviews; never invent or automatically activate lessons. |

### `turn_scoring.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class TurnScore` | One scored turn · serialized to a single jsonl line. |
| func | `def score_turn_outcome(has_final_reply, tool_error_count, rounds_used, rounds_max, interrupted, duration_ms, timeout_ms)` | Pure scoring function · no I/O · easy to unit test. |
| func | `def is_safe_agent_id(agent_id)` | Return whether ``agent_id`` is safe as an exact storage component. |
| func | `def record_turn_score(agent_id, score, reason, rounds, input_tokens, output_tokens, duration_ms, thread_id, turn_id, scope)` | Append a TurnScore to the agent's `.scores.jsonl`. Returns the path written, or None if the agent_id is empty / disk failure. |
| func | `def read_recent_scores(agent_id, limit, scope)` | Return up to ``limit`` most recent TurnScore entries (newest first) visible to ``scope``. |
| func | `def analyze_soul_impact(agent_id, window, drop_threshold, scope)` | Compare avg score before vs after the most recent SOUL change. |

### `variant.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class Variant` |  |
| class | `class VariantStats` |  |
| class | `class ABSplitter` |  |

### `variant_evaluator.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class VariantStat` | Per-variant aggregate · one entry per (base_recipe, variant). |
| class | `class VariantComparison` | All variants sharing one base recipe · the comparison the operator (or auto-promote) reasons over. |
| func | `def collect_variant_stats(journal, base_recipe_id, scope)` | Scan trajectory events · group by (base, variant) · return one comparison per base recipe. |
| class | `class PromoteProposal` | Suggested weight reshuffle · returned to the operator who decides whether to call ``set_weights`` to commit. |
| func | `def propose_weights(comparison, min_uses, min_lead)` | Look at the per-variant stats and decide whether the data supports promoting a winner. Returns None when the comparison isn't actionable (in |

### `weekly_report.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class WeeklyReport` | Header metadata for one weekly report — drives both the Markdown writer and machine-readable summary. |
| func | `def write_weekly_report(sink, report_dir, tuning_threshold, min_precision_for_tuning, now, skip_if_empty)` | Generate this week's guard-telemetry report and return the path. |

### `workflow_applier.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ApplyOutcome` |  |
| class | `class ApplyResult` |  |
| func | `def apply_proposals_to_rules(rules, proposals, min_confidence, min_severity, priority_policy, priority_step)` |  |

### `workflow_rewriter.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class RewriteProposal(BaseModel)` |  |
| class | `class RewriteReport(BaseModel)` |  |
| class | `class RewriterConfig` |  |
| class | `class WorkflowRewriter` |  |
| func | `def format_proposals_for_review(proposals, header, max_total_chars)` |  |


## Who imports this

**78** file(s) reference this package:

- **`runtime/_cli_commands.py/`** · 1 file(s)
  - `runtime/_cli_commands.py`
- **`runtime/cli_guard_health.py/`** · 1 file(s)
  - `runtime/cli_guard_health.py`
- **`runtime/cli_reflect.py/`** · 1 file(s)
  - `runtime/cli_reflect.py`
- **`runtime/cli_serve.py/`** · 1 file(s)
  - `runtime/cli_serve.py`
- **`runtime/core/`** · 6 file(s)
  - `runtime/core/cerebrum/_react_prompt_assembly_bootstrap.py`
  - `runtime/core/cerebrum/llm_planner.py`
  - `runtime/core/cerebrum/planner.py`
  - `runtime/core/cerebrum/react_loop_controls.py`
  - `runtime/core/cerebrum/react_terminal.py`
  - `runtime/core/graph_runtime/runtime.py`
- **`runtime/execution/`** · 13 file(s)
  - `runtime/execution/agents/loader.py`
  - `runtime/execution/cron_context.py`
  - `runtime/execution/loops/_controller_prompt.py`
  - `runtime/execution/loops/controller.py`
  - `runtime/execution/parallel_agents/_orchestrator_models.py`
  - _… and 8 more_
- **`runtime/memory/`** · 5 file(s)
  - `runtime/memory/__init__.py`
  - `runtime/memory/diagnostics/_trace_store_models.py`
  - `runtime/memory/diagnostics/wiki_compiler.py`
  - `runtime/memory/hemolymph/composer.py`
  - `runtime/memory/skills_lib/ambient_suggestions.py`
- **`runtime/platform/`** · 13 file(s)
  - `runtime/platform/capabilities/tenant_context.py`
  - `runtime/platform/config/builder.py`
  - `runtime/platform/plugins/plugin_lifecycle.py`
  - `runtime/platform/ui/_app_agents.py`
  - `runtime/platform/ui/_app_routers.py`
  - _… and 8 more_
- **`runtime/safety/`** · 3 file(s)
  - `runtime/safety/organization/promotion_lift.py`
  - `runtime/safety/organization/team_runner.py`
  - `runtime/safety/validation/trust_signal.py`
- **`runtime/sensing/`** · 33 file(s)
  - `runtime/sensing/gateway/_agent_trace_router_promotion.py`
  - `runtime/sensing/gateway/_agent_trace_router_stores.py`
  - `runtime/sensing/gateway/_agents_endpoints_system.py`
  - `runtime/sensing/gateway/_evolution_candidate_endpoints.py`
  - `runtime/sensing/gateway/_evolution_certification_endpoints.py`
  - _… and 28 more_
- **`runtime/tour.py/`** · 1 file(s)
  - `runtime/tour.py`

