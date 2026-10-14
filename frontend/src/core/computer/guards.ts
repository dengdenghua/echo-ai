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
  AutomationTarget,
  ComputerActionPlan,
  ComputerAppshot,
  ComputerExecuteResult,
  ComputerLeaseReleaseResult,
  ComputerPreview,
  ComputerScreenshot,
  ComputerStatus,
  ComputerTargetsResponse,
} from "./api";

export function isComputerStatus(value: unknown): value is ComputerStatus {
  return (
    isRecord(value) &&
    isUnknownArray(value.skills) &&
    isBoolean(value.ok) &&
    isBoolean(value.pyautogui_available)
  );
}

export function isComputerScreenshot(
  value: unknown,
): value is ComputerScreenshot {
  return isRecord(value) && isBoolean(value.ok);
}

export function isComputerAppshot(value: unknown): value is ComputerAppshot {
  return (
    isRecord(value) &&
    isString(value.snapshot_id) &&
    isString(value.schema) &&
    isBoolean(value.ok)
  );
}

export function isComputerTargetsResponse(
  value: unknown,
): value is ComputerTargetsResponse {
  return (
    isRecord(value) &&
    isUnknownArray(value.targets) &&
    isString(value.schema) &&
    isNumber(value.count)
  );
}

export function hasOk(value: unknown): value is {
  ok: boolean;
  data_url?: string;
  target?: AutomationTarget;
  error?: string;
} {
  return isRecord(value) && isBoolean(value.ok);
}

export function isComputerPreview(value: unknown): value is ComputerPreview {
  return (
    isRecord(value) &&
    isBoolean(value.ok) &&
    isString(value.token) &&
    isRecord(value.risk)
  );
}

export function isComputerActionPlan(
  value: unknown,
): value is ComputerActionPlan {
  return (
    isRecord(value) &&
    isUnknownArray(value.suggestions) &&
    isUnknownArray(value.limitations) &&
    isBoolean(value.ok)
  );
}

export function isComputerExecuteResult(
  value: unknown,
): value is ComputerExecuteResult {
  return (
    isRecord(value) &&
    isBoolean(value.ok) &&
    isRecord(value.risk) &&
    isRecord(value.result)
  );
}

export function isComputerLeaseReleaseResult(
  value: unknown,
): value is ComputerLeaseReleaseResult {
  return isRecord(value) && isBoolean(value.ok) && isRecord(value.lease);
}
