/**
 * Key-field guards for the response bodies read in ``./agent-world-api``. The
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
  AgentInstallResult,
  CapabilityDeviceFlowStatus,
  CapabilityInstallPlan,
  CapabilityListResponse,
  CloudInstalledStatus,
  CloudPluginInstallResult,
  CloudPluginRollbackResult,
  CloudPluginUninstallResult,
  CloudPluginsResponse,
  CloudSkillInstallResult,
  CloudSkillsResponse,
  CloudStoreCategoriesResponse,
  CloudStoreInstallResult,
  CloudStoreResponse,
  EnterpriseAssetsResponse,
  RuntimePluginStatus,
  UnifiedAssetKind,
  UnifiedAssetsResponse,
} from "./agent-world-api";
import type {
  AgentMemory,
  AgentProfile,
  AgentRating,
  AgentRelationship,
  AgentWorldAgent,
  AgentWorldListResponse,
} from "./types";

export function isCloudStoreResponse(
  value: unknown,
): value is CloudStoreResponse {
  return (
    isRecord(value) &&
    isUnknownArray(value.agents) &&
    isNumber(value.total) &&
    isNumber(value.page)
  );
}

export function isCloudStoreCategoriesResponse(
  value: unknown,
): value is CloudStoreCategoriesResponse {
  return isRecord(value) && isUnknownArray(value.categories);
}

export function isCloudStoreInstallResult(
  value: unknown,
): value is CloudStoreInstallResult {
  return isRecord(value) && isBoolean(value.installed);
}

export function isCloudPluginsResponse(
  value: unknown,
): value is CloudPluginsResponse {
  return (
    isRecord(value) && isUnknownArray(value.items) && isNumber(value.total)
  );
}

export function isCloudSkillsResponse(
  value: unknown,
): value is CloudSkillsResponse {
  return (
    isRecord(value) && isUnknownArray(value.items) && isNumber(value.total)
  );
}

export function isCloudInstalledStatus(
  value: unknown,
): value is CloudInstalledStatus {
  return (
    isRecord(value) &&
    isUnknownArray(value.skills) &&
    isUnknownArray(value.plugins)
  );
}

export function hasPlugins(
  value: unknown,
): value is Pick<CloudInstalledStatus, "plugins" | "plugin_states"> {
  return isRecord(value) && isUnknownArray(value.plugins);
}

export function isCloudSkillInstallResult(
  value: unknown,
): value is CloudSkillInstallResult {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isBoolean(value.installed) &&
    isString(value.path)
  );
}

export function isCloudPluginInstallResult(
  value: unknown,
): value is CloudPluginInstallResult {
  return (
    isRecord(value) &&
    isString(value.plugin_id) &&
    isBoolean(value.installed) &&
    isString(value.path)
  );
}

export function isCloudPluginUninstallResult(
  value: unknown,
): value is CloudPluginUninstallResult {
  return (
    isRecord(value) && isString(value.plugin_id) && isBoolean(value.uninstalled)
  );
}

export function isRuntimePluginStatus(
  value: unknown,
): value is RuntimePluginStatus {
  return (
    isRecord(value) && isBoolean(value.installed) && isBoolean(value.enabled)
  );
}

export const isRuntimePluginStatusList = arrayOf(isRuntimePluginStatus);

export function isCloudPluginRollbackResult(
  value: unknown,
): value is CloudPluginRollbackResult {
  return (
    isRecord(value) &&
    isString(value.plugin_id) &&
    isString(value.transaction_id) &&
    isBoolean(value.ok)
  );
}

export function isAgentWorldListResponse(
  value: unknown,
): value is AgentWorldListResponse {
  return (
    isRecord(value) &&
    isUnknownArray(value.agents) &&
    isNumber(value.total) &&
    isNumber(value.page)
  );
}

export function isEnterpriseAssetsResponse(
  value: unknown,
): value is EnterpriseAssetsResponse {
  return (
    isRecord(value) && isUnknownArray(value.items) && isBoolean(value.available)
  );
}

export function hasInstalled(
  value: unknown,
): value is { installed: boolean; agent_id: string; name?: string } {
  return (
    isRecord(value) && isString(value.agent_id) && isBoolean(value.installed)
  );
}

export function isAgentWorldAgent(value: unknown): value is AgentWorldAgent {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isUnknownArray(value.tags)
  );
}

export function isAgentInstallResult(
  value: unknown,
): value is AgentInstallResult {
  return (
    isRecord(value) && isString(value.agent_id) && isBoolean(value.installed)
  );
}

export function isAgentProfile(value: unknown): value is AgentProfile {
  return (
    isRecord(value) &&
    isUnknownArray(value.tags) &&
    isUnknownArray(value.capabilities) &&
    isString(value.agent_name)
  );
}

export function hasMemories(
  value: unknown,
): value is { memories: AgentMemory[] } {
  return isRecord(value) && isUnknownArray(value.memories);
}

export function hasRatings(
  value: unknown,
): value is { ratings: AgentRating[] } {
  return isRecord(value) && isUnknownArray(value.ratings);
}

export function hasRelationships(
  value: unknown,
): value is { relationships: AgentRelationship[] } {
  return isRecord(value) && isUnknownArray(value.relationships);
}

export function isCapabilityInstallPlan(
  value: unknown,
): value is CapabilityInstallPlan {
  return (
    isRecord(value) &&
    isString(value.capability_id) &&
    isString(value.plan_id) &&
    isUnknownArray(value.permissions)
  );
}

export function isCapabilityListResponse(
  value: unknown,
): value is CapabilityListResponse {
  return (
    isRecord(value) &&
    isUnknownArray(value.capabilities) &&
    isNumber(value.total)
  );
}

export function hasConnected(
  value: unknown,
): value is { connected: boolean; auth_mode?: string } {
  return isRecord(value) && isBoolean(value.connected);
}

export function isCapabilityDeviceFlowStatus(
  value: unknown,
): value is CapabilityDeviceFlowStatus {
  return (
    isRecord(value) && isString(value.connector_id) && isBoolean(value.active)
  );
}

export function isUnifiedAssetsResponse(
  value: unknown,
): value is UnifiedAssetsResponse {
  return (
    isRecord(value) &&
    isUnknownArray(value.items) &&
    isRecord(value.summary) &&
    isNumber(value.total)
  );
}

export function hasRoot(value: unknown): value is {
  root: string;
  counts: Partial<Record<UnifiedAssetKind, number>>;
  files_copied: number;
  updated_at: string;
} {
  return (
    isRecord(value) &&
    isString(value.root) &&
    isRecord(value.counts) &&
    isNumber(value.files_copied)
  );
}
