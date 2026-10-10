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
  MemoryAssetList,
  MemoryAssetTrace,
  MemoryConfig,
  MemoryData,
} from "./types";

export function isMemoryAssetList(value: unknown): value is MemoryAssetList {
  return (
    isRecord(value) && isUnknownArray(value.items) && isNumber(value.count)
  );
}

export function isMemoryAssetTrace(value: unknown): value is MemoryAssetTrace {
  return (
    isRecord(value) &&
    isString(value.asset_id) &&
    isUnknownArray(value.parent_ids) &&
    isString(value.layer)
  );
}

export function isMemoryData(value: unknown): value is MemoryData {
  return (
    isRecord(value) &&
    isUnknownArray(value.facts) &&
    isString(value.version) &&
    isString(value.lastUpdated)
  );
}

export function isMemoryConfig(value: unknown): value is MemoryConfig {
  return (
    isRecord(value) &&
    isBoolean(value.enabled) &&
    isString(value.storage_path) &&
    isBoolean(value.auto_capture_enabled)
  );
}
