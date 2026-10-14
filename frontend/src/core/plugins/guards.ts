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
  DiscoveredPlugin,
  HubPluginInfo,
  PluginInfo,
  PluginLifecycleHistory,
  PluginMigrationReadiness,
  PluginPublisherTrustReport,
  PluginRegistryUpdates,
  PluginRuntimeProfile,
  PluginSmokeSummary,
} from "./types";
import type { AutomationDiagnostics } from "./api";

export function isPluginInfo(value: unknown): value is PluginInfo {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isUnknownArray(value.capabilities)
  );
}

export const isPluginInfoList = arrayOf(isPluginInfo);

export function isPluginSmokeSummary(
  value: unknown,
): value is PluginSmokeSummary {
  return (
    isRecord(value) &&
    isUnknownArray(value.failed) &&
    isUnknownArray(value.review_required) &&
    isUnknownArray(value.warnings)
  );
}

export function isPluginMigrationReadiness(
  value: unknown,
): value is PluginMigrationReadiness {
  return (
    isRecord(value) &&
    isUnknownArray(value.plugins) &&
    isUnknownArray(value.next_actions) &&
    isString(value.schema)
  );
}

export function isPluginPublisherTrustReport(
  value: unknown,
): value is PluginPublisherTrustReport {
  return (
    isRecord(value) &&
    isUnknownArray(value.publishers) &&
    isUnknownArray(value.next_actions) &&
    isString(value.schema)
  );
}

export function isPluginLifecycleHistory(
  value: unknown,
): value is PluginLifecycleHistory {
  return (
    isRecord(value) &&
    isUnknownArray(value.items) &&
    isString(value.schema) &&
    isNumber(value.total)
  );
}

export function isPluginRegistryUpdates(
  value: unknown,
): value is PluginRegistryUpdates {
  return (
    isRecord(value) &&
    isUnknownArray(value.plugins) &&
    isString(value.schema) &&
    isNumber(value.total)
  );
}

export function hasPluginId(
  value: unknown,
): value is { plugin_id: string; status: string; version: string } {
  return (
    isRecord(value) &&
    isString(value.plugin_id) &&
    isString(value.status) &&
    isString(value.version)
  );
}

export function hasTrust(
  value: unknown,
): value is { status: string; trust: PluginPublisherTrustReport } {
  return isRecord(value) && isString(value.status) && isRecord(value.trust);
}

export function isPluginRuntimeProfile(
  value: unknown,
): value is PluginRuntimeProfile {
  return (
    isRecord(value) &&
    isString(value.plugin_id) &&
    isUnknownArray(value.capabilities) &&
    isUnknownArray(value.skills)
  );
}

export function isAutomationDiagnostics(
  value: unknown,
): value is AutomationDiagnostics {
  return (
    isRecord(value) &&
    isString(value.plugin_id) &&
    isUnknownArray(value.checks) &&
    isBoolean(value.lifecycle_active)
  );
}

export function isHubPluginInfo(value: unknown): value is HubPluginInfo {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isUnknownArray(value.capabilities)
  );
}

export const isHubPluginInfoList = arrayOf(isHubPluginInfo);

export function isDiscoveredPlugin(value: unknown): value is DiscoveredPlugin {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isUnknownArray(value.tags)
  );
}

export const isDiscoveredPluginList = arrayOf(isDiscoveredPlugin);

export function hasOk(value: unknown): value is { ok: boolean } {
  return isRecord(value) && isBoolean(value.ok);
}
