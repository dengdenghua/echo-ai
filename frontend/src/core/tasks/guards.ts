/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import { isBoolean, isNumber, isRecord, isString } from "@/core/utils/guards";
import type { PauseRequest, ResumeTaskResponse, TaskDetail } from "./api";

export function isTaskDetail(value: unknown): value is TaskDetail {
  return (
    isRecord(value) &&
    isString(value.task_id) &&
    isBoolean(value.is_pending_pause) &&
    isBoolean(value.is_paused)
  );
}

export function hasPauseRequest(
  value: unknown,
): value is { ok: boolean; request: PauseRequest } {
  return isRecord(value) && isBoolean(value.ok) && isRecord(value.request);
}

export function isResumeTaskResponse(
  value: unknown,
): value is ResumeTaskResponse {
  return (
    isRecord(value) &&
    isString(value.task_id) &&
    isBoolean(value.ok) &&
    isNumber(value.extra_tokens)
  );
}
