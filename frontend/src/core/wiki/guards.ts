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
import type { WikiDocList, WikiStatus, WikiUpdateResult } from "./types";

export function isWikiStatus(value: unknown): value is WikiStatus {
  return (
    isRecord(value) &&
    isUnknownArray(value.generated_files) &&
    isBoolean(value.exists) &&
    isString(value.status)
  );
}

export function isWikiDocList(value: unknown): value is WikiDocList {
  return isRecord(value) && isUnknownArray(value.docs) && isString(value.lang);
}

export function isWikiUpdateResult(value: unknown): value is WikiUpdateResult {
  return isRecord(value);
}
