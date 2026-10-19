"""Unified self-evolution: experience, reflection, optimization and governed rollout.

Hosts enter through ``get_evolution_service``. Algorithms and stores belong
here; transport, execution and memory packages only supply evidence/adapters.
Exports are lazy so importing a store never starts workers or model services.
"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .auto_retire import (  # noqa: F401
        AutoRetireConfig,
        AutoRetireScheduler,
        AutoRetireStats,
        EvolverStepTriggered,
        VariantBoosted,
        VariantRetired,
    )
    from .auto_trigger import (  # noqa: F401
        AutoTriggerConfig,
        EvolutionAutoTrigger,
        get_auto_trigger,
    )
    from .canary import (  # noqa: F401
        CanaryConfig,
        CanaryManager,
        CanaryState,
    )
    from .deep_evolution import (  # noqa: F401
        deep_evolve,
        deep_reflect,
    )
    from .drift_monitor import (  # noqa: F401
        DriftConfig,
        DriftMonitor,
        DriftReport,
    )
    from .evolution_constraints import (  # noqa: F401
        EvolutionConstraintConfig,
        EvolutionConstraintResult,
        EvolutionConstraintValidator,
        serialize_constraint_results,
    )
    from .evolution_dataset import (  # noqa: F401
        EvolutionDataset,
        EvolutionDatasetBuilder,
        EvolutionExample,
        FailureCluster,
    )
    from .experience_ledger import (  # noqa: F401
        ExperienceLedger,
    )
    from .external_importers import (  # noqa: F401
        ImportedSessionSample,
        SessionImportReport,
        build_external_session_dataset,
        collect_external_session_failures,
        discover_external_session_roots,
        import_external_sessions,
    )
    from .federation import (  # noqa: F401
        FederationConfig,
        FederationHub,
        SharedProposal,
    )
    from .fitness import (  # noqa: F401
        FitnessConfig,
        FitnessReport,
        L1Fitness,
        L2Fitness,
        compute_fitness,
        compute_l1,
        compute_l2,
    )
    from .genome_registry import (  # noqa: F401
        GenomeRegistry,
        GenomeRegistryConfig,
    )
    from .intel_collector import (  # noqa: F401
        CollectorConfig,
        IntelCollector,
        IntelRunReport,
        IntelSource,
    )
    from .kg_updater import (  # noqa: F401
        KGUpdater,
        KGUpdateReport,
        persist_kg_from_journal,
    )
    from .lightweight_shadow import (  # noqa: F401
        ShadowConfig,
        ShadowResult,
        lightweight_shadow_validate,
    )
    from .memory_consolidator import (  # noqa: F401
        ConsolidatedMemory,
        ConsolidationReport,
        ConsolidatorConfig,
        MemoryConsolidator,
        MemoryScope,
        filter_memories_for_agent,
        format_memories_for_prompt,
    )
    from .native_evolution_eval import (  # noqa: F401
        NativeEvolutionScore,
        NativeEvolutionWeights,
        evaluate_front_native,
        score_candidate_native,
    )
    from .native_llm_replay import (  # noqa: F401
        LLMReplayCandidateReport,
        LLMReplayCaseResult,
        LLMReplayReport,
        replay_llm_candidates,
    )
    from .native_replay import (  # noqa: F401
        ReplayCandidateReport,
        ReplayCase,
        ReplayCaseResult,
        ReplayReport,
        build_replay_cases,
        replay_candidate,
        replay_candidates,
    )
    from .native_replay_sandbox import (  # noqa: F401
        SandboxReplayCandidateReport,
        SandboxReplayCaseResult,
        SandboxReplayReport,
        run_sandbox_replay,
    )
    from .native_turn_replay import (  # noqa: F401
        TurnReplayCandidateReport,
        TurnReplayCase,
        TurnReplayCaseResult,
        TurnReplayReport,
        build_turn_replay_cases,
        replay_turn_candidates,
    )
    from .optimizer_backends import (  # noqa: F401
        OptimizerBackend,
        OptimizerRunConfig,
        OptimizerRunContext,
        available_optimizer_backends,
        get_optimizer_backend,
        optimize_with_backend,
    )
    from .pareto import (  # noqa: F401
        pareto_frontier_by_name,
    )
    from .promotion_applier import (  # noqa: F401
        PromotionApplier,
    )
    from .prompt_evolver import (  # noqa: F401
        EvolutionPolicy,
        EvolutionStep,
        PromptEvolver,
    )
    from .prompt_mutator import (  # noqa: F401
        MutationProposal,
        PromptMutator,
    )
    from .prompt_optimizer import (  # noqa: F401
        PromptOptimizer,
        PromptVariant,
        VariantReport,
        dump_variants_to_yaml,
        load_variants_from_yaml,
    )
    from .proposal_ledger import (  # noqa: F401
        ProposalLedger,
        ProposalRecord,
        ProposalStatus,
    )
    from .recipe_evaluator import (  # noqa: F401
        RecipeEvaluationReport,
        RecipeEvaluator,
        RecipeEvaluatorConfig,
        RecipeScore,
        format_recipe_report,
    )
    from .review_queue import (  # noqa: F401
        ReviewQueue,
    )
    from .rollback_coordinator import (  # noqa: F401
        RollbackCoordinator,
        RollbackRecord,
        RollbackResult,
        RollbackVerification,
    )
    from .rule_extractor import (  # noqa: F401
        ExtractorConfig,
        LearnedRule,
        RuleExtractionReport,
        RuleExtractor,
        format_rules_for_prompt,
    )
    from .service import (  # noqa: F401
        EvolutionService,
        get_evolution_service,
    )
    from .skill_curator import (  # noqa: F401
        CuratorAction,
        CuratorConfig,
        CuratorProposal,
        CuratorReport,
        SkillCurator,
        SkillInfo,
        SkillState,
    )
    from .skill_forge import (  # noqa: F401
        ForgeConfig,
        ForgedSkillCandidate,
        SkillForge,
        SkillForgeResult,
        UnsafeSkillPromotionError,
        pattern_signature,
    )
    from .skill_usage import (  # noqa: F401
        SkillUsageRecord,
        SkillUsageStats,
        SkillUsageTracker,
    )
    from .strategy import (  # noqa: F401
        StrategyConfig,
        StrategyDecision,
        StrategyEngine,
        run_strategy_cycle,
    )
    from .variant import (  # noqa: F401
        ABSplitter,
        Variant,
        VariantStats,
    )
    from .workflow_applier import (  # noqa: F401
        ApplyOutcome,
        ApplyResult,
        apply_proposals_to_rules,
    )
    from .workflow_rewriter import (  # noqa: F401
        RewriteProposal,
        RewriterConfig,
        RewriteReport,
        WorkflowRewriter,
        format_proposals_for_review,
    )


_EXPORTS = {
    "ABSplitter": ("variant", "ABSplitter"),
    "ApplyOutcome": ("workflow_applier", "ApplyOutcome"),
    "ApplyResult": ("workflow_applier", "ApplyResult"),
    "AutoRetireConfig": ("auto_retire", "AutoRetireConfig"),
    "AutoRetireScheduler": ("auto_retire", "AutoRetireScheduler"),
    "AutoRetireStats": ("auto_retire", "AutoRetireStats"),
    "AutoTriggerConfig": ("auto_trigger", "AutoTriggerConfig"),
    "CanaryConfig": ("canary", "CanaryConfig"),
    "CanaryManager": ("canary", "CanaryManager"),
    "CanaryState": ("canary", "CanaryState"),
    "CollectorConfig": ("intel_collector", "CollectorConfig"),
    "ConsolidatedMemory": ("memory_consolidator", "ConsolidatedMemory"),
    "ConsolidationReport": ("memory_consolidator", "ConsolidationReport"),
    "ConsolidatorConfig": ("memory_consolidator", "ConsolidatorConfig"),
    "CuratorAction": ("skill_curator", "CuratorAction"),
    "CuratorConfig": ("skill_curator", "CuratorConfig"),
    "CuratorProposal": ("skill_curator", "CuratorProposal"),
    "CuratorReport": ("skill_curator", "CuratorReport"),
    "DriftConfig": ("drift_monitor", "DriftConfig"),
    "DriftMonitor": ("drift_monitor", "DriftMonitor"),
    "DriftReport": ("drift_monitor", "DriftReport"),
    "EvolutionAutoTrigger": ("auto_trigger", "EvolutionAutoTrigger"),
    "EvolutionConstraintConfig": ("evolution_constraints", "EvolutionConstraintConfig"),
    "EvolutionConstraintResult": ("evolution_constraints", "EvolutionConstraintResult"),
    "EvolutionConstraintValidator": ("evolution_constraints", "EvolutionConstraintValidator"),
    "EvolutionDataset": ("evolution_dataset", "EvolutionDataset"),
    "EvolutionDatasetBuilder": ("evolution_dataset", "EvolutionDatasetBuilder"),
    "EvolutionExample": ("evolution_dataset", "EvolutionExample"),
    "EvolutionPolicy": ("prompt_evolver", "EvolutionPolicy"),
    "EvolutionService": ("service", "EvolutionService"),
    "EvolutionStep": ("prompt_evolver", "EvolutionStep"),
    "EvolverStepTriggered": ("auto_retire", "EvolverStepTriggered"),
    "ExperienceLedger": ("experience_ledger", "ExperienceLedger"),
    "ExtractorConfig": ("rule_extractor", "ExtractorConfig"),
    "FailureCluster": ("evolution_dataset", "FailureCluster"),
    "FederationConfig": ("federation", "FederationConfig"),
    "FederationHub": ("federation", "FederationHub"),
    "FitnessConfig": ("fitness", "FitnessConfig"),
    "FitnessReport": ("fitness", "FitnessReport"),
    "ForgeConfig": ("skill_forge", "ForgeConfig"),
    "ForgedSkillCandidate": ("skill_forge", "ForgedSkillCandidate"),
    "GenomeRegistry": ("genome_registry", "GenomeRegistry"),
    "GenomeRegistryConfig": ("genome_registry", "GenomeRegistryConfig"),
    "ImportedSessionSample": ("external_importers", "ImportedSessionSample"),
    "IntelCollector": ("intel_collector", "IntelCollector"),
    "IntelRunReport": ("intel_collector", "IntelRunReport"),
    "IntelSource": ("intel_collector", "IntelSource"),
    "KGUpdateReport": ("kg_updater", "KGUpdateReport"),
    "KGUpdater": ("kg_updater", "KGUpdater"),
    "L1Fitness": ("fitness", "L1Fitness"),
    "L2Fitness": ("fitness", "L2Fitness"),
    "LLMReplayCandidateReport": ("native_llm_replay", "LLMReplayCandidateReport"),
    "LLMReplayCaseResult": ("native_llm_replay", "LLMReplayCaseResult"),
    "LLMReplayReport": ("native_llm_replay", "LLMReplayReport"),
    "LearnedRule": ("rule_extractor", "LearnedRule"),
    "MemoryConsolidator": ("memory_consolidator", "MemoryConsolidator"),
    "MemoryScope": ("memory_consolidator", "MemoryScope"),
    "MutationProposal": ("prompt_mutator", "MutationProposal"),
    "NativeEvolutionScore": ("native_evolution_eval", "NativeEvolutionScore"),
    "NativeEvolutionWeights": ("native_evolution_eval", "NativeEvolutionWeights"),
    "OptimizerBackend": ("optimizer_backends", "OptimizerBackend"),
    "OptimizerRunConfig": ("optimizer_backends", "OptimizerRunConfig"),
    "OptimizerRunContext": ("optimizer_backends", "OptimizerRunContext"),
    "PromotionApplier": ("promotion_applier", "PromotionApplier"),
    "PromptEvolver": ("prompt_evolver", "PromptEvolver"),
    "PromptMutator": ("prompt_mutator", "PromptMutator"),
    "PromptOptimizer": ("prompt_optimizer", "PromptOptimizer"),
    "PromptVariant": ("prompt_optimizer", "PromptVariant"),
    "ProposalLedger": ("proposal_ledger", "ProposalLedger"),
    "ProposalRecord": ("proposal_ledger", "ProposalRecord"),
    "ProposalStatus": ("proposal_ledger", "ProposalStatus"),
    "RecipeEvaluationReport": ("recipe_evaluator", "RecipeEvaluationReport"),
    "RecipeEvaluator": ("recipe_evaluator", "RecipeEvaluator"),
    "RecipeEvaluatorConfig": ("recipe_evaluator", "RecipeEvaluatorConfig"),
    "RecipeScore": ("recipe_evaluator", "RecipeScore"),
    "ReplayCandidateReport": ("native_replay", "ReplayCandidateReport"),
    "ReplayCase": ("native_replay", "ReplayCase"),
    "ReplayCaseResult": ("native_replay", "ReplayCaseResult"),
    "ReplayReport": ("native_replay", "ReplayReport"),
    "ReviewQueue": ("review_queue", "ReviewQueue"),
    "RewriteProposal": ("workflow_rewriter", "RewriteProposal"),
    "RewriteReport": ("workflow_rewriter", "RewriteReport"),
    "RewriterConfig": ("workflow_rewriter", "RewriterConfig"),
    "RollbackCoordinator": ("rollback_coordinator", "RollbackCoordinator"),
    "RollbackRecord": ("rollback_coordinator", "RollbackRecord"),
    "RollbackResult": ("rollback_coordinator", "RollbackResult"),
    "RollbackVerification": ("rollback_coordinator", "RollbackVerification"),
    "RuleExtractionReport": ("rule_extractor", "RuleExtractionReport"),
    "RuleExtractor": ("rule_extractor", "RuleExtractor"),
    "SandboxReplayCandidateReport": ("native_replay_sandbox", "SandboxReplayCandidateReport"),
    "SandboxReplayCaseResult": ("native_replay_sandbox", "SandboxReplayCaseResult"),
    "SandboxReplayReport": ("native_replay_sandbox", "SandboxReplayReport"),
    "SessionImportReport": ("external_importers", "SessionImportReport"),
    "ShadowConfig": ("lightweight_shadow", "ShadowConfig"),
    "ShadowResult": ("lightweight_shadow", "ShadowResult"),
    "SharedProposal": ("federation", "SharedProposal"),
    "SkillCurator": ("skill_curator", "SkillCurator"),
    "SkillForge": ("skill_forge", "SkillForge"),
    "SkillForgeResult": ("skill_forge", "SkillForgeResult"),
    "SkillInfo": ("skill_curator", "SkillInfo"),
    "SkillState": ("skill_curator", "SkillState"),
    "SkillUsageRecord": ("skill_usage", "SkillUsageRecord"),
    "SkillUsageStats": ("skill_usage", "SkillUsageStats"),
    "SkillUsageTracker": ("skill_usage", "SkillUsageTracker"),
    "StrategyConfig": ("strategy", "StrategyConfig"),
    "StrategyDecision": ("strategy", "StrategyDecision"),
    "StrategyEngine": ("strategy", "StrategyEngine"),
    "TurnReplayCandidateReport": ("native_turn_replay", "TurnReplayCandidateReport"),
    "TurnReplayCase": ("native_turn_replay", "TurnReplayCase"),
    "TurnReplayCaseResult": ("native_turn_replay", "TurnReplayCaseResult"),
    "TurnReplayReport": ("native_turn_replay", "TurnReplayReport"),
    "UnsafeSkillPromotionError": ("skill_forge", "UnsafeSkillPromotionError"),
    "Variant": ("variant", "Variant"),
    "VariantBoosted": ("auto_retire", "VariantBoosted"),
    "VariantReport": ("prompt_optimizer", "VariantReport"),
    "VariantRetired": ("auto_retire", "VariantRetired"),
    "VariantStats": ("variant", "VariantStats"),
    "WorkflowRewriter": ("workflow_rewriter", "WorkflowRewriter"),
    "apply_proposals_to_rules": ("workflow_applier", "apply_proposals_to_rules"),
    "available_optimizer_backends": ("optimizer_backends", "available_optimizer_backends"),
    "build_external_session_dataset": ("external_importers", "build_external_session_dataset"),
    "build_replay_cases": ("native_replay", "build_replay_cases"),
    "build_turn_replay_cases": ("native_turn_replay", "build_turn_replay_cases"),
    "collect_external_session_failures": (
        "external_importers",
        "collect_external_session_failures",
    ),
    "compute_fitness": ("fitness", "compute_fitness"),
    "compute_l1": ("fitness", "compute_l1"),
    "compute_l2": ("fitness", "compute_l2"),
    "deep_evolve": ("deep_evolution", "deep_evolve"),
    "deep_reflect": ("deep_evolution", "deep_reflect"),
    "discover_external_session_roots": ("external_importers", "discover_external_session_roots"),
    "dump_variants_to_yaml": ("prompt_optimizer", "dump_variants_to_yaml"),
    "evaluate_front_native": ("native_evolution_eval", "evaluate_front_native"),
    "filter_memories_for_agent": ("memory_consolidator", "filter_memories_for_agent"),
    "format_memories_for_prompt": ("memory_consolidator", "format_memories_for_prompt"),
    "format_proposals_for_review": ("workflow_rewriter", "format_proposals_for_review"),
    "format_recipe_report": ("recipe_evaluator", "format_recipe_report"),
    "format_rules_for_prompt": ("rule_extractor", "format_rules_for_prompt"),
    "get_auto_trigger": ("auto_trigger", "get_auto_trigger"),
    "get_evolution_service": ("service", "get_evolution_service"),
    "get_optimizer_backend": ("optimizer_backends", "get_optimizer_backend"),
    "import_external_sessions": ("external_importers", "import_external_sessions"),
    "lightweight_shadow_validate": ("lightweight_shadow", "lightweight_shadow_validate"),
    "load_variants_from_yaml": ("prompt_optimizer", "load_variants_from_yaml"),
    "optimize_with_backend": ("optimizer_backends", "optimize_with_backend"),
    "pareto_frontier_by_name": ("pareto", "pareto_frontier_by_name"),
    "pattern_signature": ("skill_forge", "pattern_signature"),
    "persist_kg_from_journal": ("kg_updater", "persist_kg_from_journal"),
    "replay_candidate": ("native_replay", "replay_candidate"),
    "replay_candidates": ("native_replay", "replay_candidates"),
    "replay_llm_candidates": ("native_llm_replay", "replay_llm_candidates"),
    "replay_turn_candidates": ("native_turn_replay", "replay_turn_candidates"),
    "run_sandbox_replay": ("native_replay_sandbox", "run_sandbox_replay"),
    "run_strategy_cycle": ("strategy", "run_strategy_cycle"),
    "score_candidate_native": ("native_evolution_eval", "score_candidate_native"),
    "serialize_constraint_results": ("evolution_constraints", "serialize_constraint_results"),
}

__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
    target = _EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module, symbol = target
    value = getattr(import_module(f".{module}", __name__), symbol)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
