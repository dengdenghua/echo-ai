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
  BrowserConfig,
  BrowserSessionResponse,
  BrowserSessionsResponse,
  BrowserSystemInfoResponse,
  RelayStatus,
} from "./api";

export function isBrowserSystemInfoResponse(
  value: unknown,
): value is BrowserSystemInfoResponse {
  return (
    isRecord(value) && isUnknownArray(value.browsers) && isRecord(value.system)
  );
}

export function isBrowserConfig(value: unknown): value is BrowserConfig {
  return (
    isRecord(value) &&
    isNumber(value.max_open_tabs) &&
    isNumber(value.max_saved_tabs) &&
    isString(value.connection_mode)
  );
}

export function isBrowserSessionResponse(
  value: unknown,
): value is BrowserSessionResponse {
  return isRecord(value) && isString(value.status) && isRecord(value.session);
}

export function isBrowserSessionsResponse(
  value: unknown,
): value is BrowserSessionsResponse {
  return (
    isRecord(value) && isUnknownArray(value.sessions) && isNumber(value.count)
  );
}

export function isRelayStatus(value: unknown): value is RelayStatus {
  return (
    isRecord(value) &&
    isBoolean(value.connected) &&
    isString(value.extension_version) &&
    isNumber(value.pending_commands)
  );
}

export function hasDataUrl(value: unknown): value is {
  dataUrl?: string;
  data?: string;
} {
  return isRecord(value);
}

export function hasOpened(
  value: unknown,
): value is { opened: boolean; path: string } {
  return isRecord(value) && isBoolean(value.opened) && isString(value.path);
}

export function hasPath(
  value: unknown,
): value is { path: string; exists: boolean } {
  return isRecord(value) && isString(value.path) && isBoolean(value.exists);
}
