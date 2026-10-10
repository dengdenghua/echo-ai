/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import { isBoolean, isRecord, isString } from "@/core/utils/guards";
import type { NASServiceStartResponse } from "./api";

export function isNASServiceStartResponse(
  value: unknown,
): value is NASServiceStartResponse {
  return (
    isRecord(value) &&
    isBoolean(value.ok) &&
    isString(value.status) &&
    isString(value.base_url)
  );
}
