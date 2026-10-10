/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import {
  isBoolean,
  isRecord,
  isString,
  isUnknownArray,
} from "@/core/utils/guards";
import type { MCPConfig, MCPConfigUpdateResponse } from "./types";
import type {
  MCPOAuthAuthorizeResult,
  MCPTrustEntry,
  OAuthAppInfo,
} from "./api";

export function isMCPConfig(value: unknown): value is MCPConfig {
  return isRecord(value) && isRecord(value.mcp_servers);
}

export function isMCPConfigUpdateResponse(
  value: unknown,
): value is MCPConfigUpdateResponse {
  return isRecord(value) && isRecord(value.mcp_servers);
}

export function isMCPOAuthAuthorizeResult(
  value: unknown,
): value is MCPOAuthAuthorizeResult {
  return (
    isRecord(value) && isBoolean(value.ok) && isString(value.authorize_url)
  );
}

export function isOAuthAppInfo(value: unknown): value is OAuthAppInfo {
  return (
    isRecord(value) &&
    isString(value.provider) &&
    isString(value.provider_name) &&
    isBoolean(value.has_app)
  );
}

export function hasServer(
  value: unknown,
): value is { server: string; authorized: boolean } {
  return (
    isRecord(value) && isString(value.server) && isBoolean(value.authorized)
  );
}

export function hasEntries(
  value: unknown,
): value is { entries: MCPTrustEntry[] } {
  return isRecord(value) && isUnknownArray(value.entries);
}

export function hasTrustEntry(
  value: unknown,
): value is { ok: boolean; entry: MCPTrustEntry } {
  return isRecord(value) && isBoolean(value.ok) && isRecord(value.entry);
}

export function hasServerName(
  value: unknown,
): value is { ok: boolean; server_name: string } {
  return isRecord(value) && isBoolean(value.ok) && isString(value.server_name);
}
