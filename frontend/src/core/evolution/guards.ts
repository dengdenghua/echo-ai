/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import {
  arrayOf,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
} from "@/core/utils/guards";
import type {
  AgentBenchmarkReport,
  CanaryState,
  CandidateCanaryStatus,
  CodexGapReport,
  ControlledExperimentEvidence,
  DriftReport,
  DualHelixEvidence,
  DualHelixShadowStatus,
  EvolutionCandidateList,
  EvolutionOverview,
  EvolutionStory,
  FitnessReport,
  LearningCurvePoint,
  LedgerRecord,
  MemoryGrowthPoint,
  Recommendation,
  SkillPerformance,
} from "./api";

export function isEvolutionOverview(
  value: unknown,
): value is EvolutionOverview {
  return (
    isRecord(value) &&
    isRecord(value.skills) &&
    isRecord(value.memory) &&
    isNumber(value.learning_events)
  );
}

export function isCodexGapReport(value: unknown): value is CodexGapReport {
  return (
    isRecord(value) &&
    isUnknownArray(value.capabilities) &&
    isBoolean(value.ok) &&
    isString(value.schema)
  );
}

export function isAgentBenchmarkReport(
  value: unknown,
): value is AgentBenchmarkReport {
  return (
    isRecord(value) &&
    isUnknownArray(value.cases) &&
    isBoolean(value.ok) &&
    isString(value.schema)
  );
}

export function isDualHelixEvidence(
  value: unknown,
): value is DualHelixEvidence {
  return (
    isRecord(value) &&
    isUnknownArray(value.pairs) &&
    isBoolean(value.ok) &&
    isString(value.schema)
  );
}

export function isControlledExperimentEvidence(
  value: unknown,
): value is ControlledExperimentEvidence {
  return (
    isRecord(value) &&
    isUnknownArray(value.pairs) &&
    isBoolean(value.ok) &&
    isString(value.schema)
  );
}

export function isEvolutionCandidateList(
  value: unknown,
): value is EvolutionCandidateList {
  return (
    isRecord(value) &&
    isUnknownArray(value.candidates) &&
    isBoolean(value.ok) &&
    isString(value.schema)
  );
}

export function isCandidateCanaryStatus(
  value: unknown,
): value is CandidateCanaryStatus {
  return (
    isRecord(value) &&
    isBoolean(value.ok) &&
    isString(value.schema) &&
    isRecord(value.candidate)
  );
}

export function isDualHelixShadowStatus(
  value: unknown,
): value is DualHelixShadowStatus {
  return (
    isRecord(value) &&
    isUnknownArray(value.runs) &&
    isBoolean(value.ok) &&
    isBoolean(value.enabled)
  );
}

export function hasRunId(
  value: unknown,
): value is DualHelixShadowStatus["runs"][number] & { ok?: boolean } {
  return (
    isRecord(value) &&
    isString(value.run_id) &&
    isString(value.goal) &&
    isString(value.primary_engine)
  );
}

export function isEvolutionStory(value: unknown): value is EvolutionStory {
  return (
    isRecord(value) &&
    isUnknownArray(value.changes) &&
    isUnknownArray(value.observations) &&
    isBoolean(value.has_real_change)
  );
}

export function isLearningCurvePoint(
  value: unknown,
): value is LearningCurvePoint {
  return (
    isRecord(value) &&
    isString(value.week) &&
    isNumber(value.success_rate) &&
    isNumber(value.avg_duration_ms)
  );
}

export const isLearningCurvePointList = arrayOf(isLearningCurvePoint);

export function isSkillPerformance(value: unknown): value is SkillPerformance {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isNumber(value.usage_count) &&
    isNumber(value.success_count)
  );
}

export const isSkillPerformanceList = arrayOf(isSkillPerformance);

export function isMemoryGrowthPoint(
  value: unknown,
): value is MemoryGrowthPoint {
  return (
    isRecord(value) &&
    isString(value.date) &&
    isNumber(value.fact) &&
    isNumber(value.preference)
  );
}

export const isMemoryGrowthPointList = arrayOf(isMemoryGrowthPoint);

export function isRecommendation(value: unknown): value is Recommendation {
  return (
    isRecord(value) &&
    isString(value.type) &&
    isString(value.title) &&
    isString(value.description)
  );
}

export const isRecommendationList = arrayOf(isRecommendation);

export function isFitnessReport(value: unknown): value is FitnessReport {
  return (
    isRecord(value) &&
    isString(value.agent_id) &&
    isBoolean(value.ok) &&
    isString(value.ts)
  );
}

export function isDriftReport(value: unknown): value is DriftReport {
  return (
    isRecord(value) &&
    isString(value.agent_id) &&
    isUnknownArray(value.events) &&
    isBoolean(value.ok)
  );
}

export function hasTotal(value: unknown): value is {
  total: number;
  records: LedgerRecord[];
  stats: Record<string, unknown>;
} {
  return (
    isRecord(value) &&
    isUnknownArray(value.records) &&
    isNumber(value.total) &&
    isRecord(value.stats)
  );
}

export function hasActiveCount(value: unknown): value is {
  active_count: number;
  canaries: CanaryState[];
} {
  return (
    isRecord(value) &&
    isUnknownArray(value.canaries) &&
    isNumber(value.active_count)
  );
}

export function hasOk(value: unknown): value is {
  ok: boolean;
  skill_name: string;
  phase: string;
} {
  return (
    isRecord(value) &&
    isBoolean(value.ok) &&
    isString(value.skill_name) &&
    isString(value.phase)
  );
}
