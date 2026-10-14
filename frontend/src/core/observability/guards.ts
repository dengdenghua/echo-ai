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
  ActiveAlert,
  AlertRule,
  MetricsSummary,
  Span,
  TelemetryStats,
  TraceSummary,
} from "./types";
import type {
  EvolutionStatus,
  ReflectionReport,
  ToolEffectAuthorizationResponse,
  ToolEffectsSnapshot,
} from "./api";

export function isMetricsSummary(value: unknown): value is MetricsSummary {
  return (
    isRecord(value) &&
    isUnknownArray(value.alerts) &&
    isRecord(value.metrics) &&
    isRecord(value.health)
  );
}

export function isTraceSummary(value: unknown): value is TraceSummary {
  return (
    isRecord(value) &&
    isString(value.trace_id) &&
    isNumber(value.span_count) &&
    isNumber(value.first_seen)
  );
}

export const isTraceSummaryList = arrayOf(isTraceSummary);

export function isSpan(value: unknown): value is Span {
  return (
    isRecord(value) &&
    isString(value.span_id) &&
    isString(value.name) &&
    isNumber(value.start_time)
  );
}

export const isSpanList = arrayOf(isSpan);

export function isActiveAlert(value: unknown): value is ActiveAlert {
  return (
    isRecord(value) &&
    isString(value.rule_name) &&
    isString(value.severity) &&
    isString(value.message)
  );
}

export const isActiveAlertList = arrayOf(isActiveAlert);

export function isAlertRule(value: unknown): value is AlertRule {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.metric) &&
    isString(value.condition)
  );
}

export const isAlertRuleList = arrayOf(isAlertRule);

export function hasSuccess(
  value: unknown,
): value is { success: boolean; name: string } {
  return isRecord(value) && isString(value.name) && isBoolean(value.success);
}

export function isTelemetryStats(value: unknown): value is TelemetryStats {
  return (
    isRecord(value) &&
    isBoolean(value.enabled) &&
    isString(value.metrics_exporter) &&
    isString(value.logs_exporter)
  );
}

export function isToolEffectsSnapshot(
  value: unknown,
): value is ToolEffectsSnapshot {
  return (
    isRecord(value) &&
    isUnknownArray(value.receipts) &&
    isString(value.backend) &&
    isBoolean(value.shared_across_hosts)
  );
}

export function isToolEffectAuthorizationResponse(
  value: unknown,
): value is ToolEffectAuthorizationResponse {
  return (
    isRecord(value) &&
    isBoolean(value.ok) &&
    isString(value.effect_key) &&
    isString(value.state)
  );
}

export function isEvolutionStatus(value: unknown): value is EvolutionStatus {
  return isRecord(value) && isBoolean(value.enabled);
}

export function isReflectionReport(value: unknown): value is ReflectionReport {
  return isRecord(value);
}

export function hasDropped(
  value: unknown,
): value is { dropped: string; remaining: number } {
  return (
    isRecord(value) && isString(value.dropped) && isNumber(value.remaining)
  );
}
