/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import {
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
} from "@/core/utils/guards";
import type {
  BatchRecoverySnapshot,
  BatchResult,
  OrchestratorStatus,
  SplitResult,
} from "./api";

export function isOrchestratorStatus(
  value: unknown,
): value is OrchestratorStatus {
  return (
    isRecord(value) &&
    isNumber(value.active_count) &&
    isNumber(value.pending_count) &&
    isNumber(value.completed_count)
  );
}

export function isBatchResult(value: unknown): value is BatchResult {
  return (
    isRecord(value) &&
    isString(value.batch_id) &&
    isUnknownArray(value.results) &&
    isUnknownArray(value.conflicts)
  );
}

export function isBatchRecoverySnapshot(
  value: unknown,
): value is BatchRecoverySnapshot {
  return (
    isRecord(value) &&
    isString(value.batch_id) &&
    isUnknownArray(value.tasks) &&
    isUnknownArray(value.artifact_paths)
  );
}

export function isSplitResult(value: unknown): value is SplitResult {
  return (
    isRecord(value) &&
    isUnknownArray(value.tasks) &&
    isUnknownArray(value.dag_levels) &&
    isNumber(value.total_levels)
  );
}
