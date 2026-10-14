/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
} from "@/core/utils/guards";
import type {
  InstallResult,
  PluginInstallResult,
  RegistryPluginsResponse,
  RegistryRolesResponse,
  RegistrySkillsResponse,
  RoleInstallResult,
} from "./api";

export function isRegistrySkillsResponse(
  value: unknown,
): value is RegistrySkillsResponse {
  return (
    isRecord(value) &&
    isUnknownArray(value.skills) &&
    isNumber(value.total) &&
    isNumber(value.offset)
  );
}

export function isInstallResult(value: unknown): value is InstallResult {
  return (
    isRecord(value) &&
    isString(value.installed) &&
    isNumber(value.registered_now)
  );
}

export function isRegistryRolesResponse(
  value: unknown,
): value is RegistryRolesResponse {
  return (
    isRecord(value) &&
    isUnknownArray(value.roles) &&
    isNumber(value.total) &&
    isNumber(value.offset)
  );
}

export function isRoleInstallResult(
  value: unknown,
): value is RoleInstallResult {
  return (
    isRecord(value) &&
    isString(value.agent_id) &&
    isString(value.name) &&
    isBoolean(value.installed)
  );
}

export function isRegistryPluginsResponse(
  value: unknown,
): value is RegistryPluginsResponse {
  return (
    isRecord(value) &&
    isUnknownArray(value.plugins) &&
    isNumber(value.total) &&
    isNumber(value.offset)
  );
}

export function isPluginInstallResult(
  value: unknown,
): value is PluginInstallResult {
  return (
    isRecord(value) &&
    isString(value.installed) &&
    isString(value.installed_name) &&
    isString(value.path)
  );
}
