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
  AppendRecordingEventsResponse,
  RecordingStatus,
  ReplayResult,
  StartRecordingResponse,
  StopRecordingResponse,
  TemplateListResponse,
  WorkflowTemplate,
} from "./types";

export function isStartRecordingResponse(
  value: unknown,
): value is StartRecordingResponse {
  return (
    isRecord(value) &&
    isString(value.thread_id) &&
    isString(value.name) &&
    isBoolean(value.recording)
  );
}

export function isStopRecordingResponse(
  value: unknown,
): value is StopRecordingResponse {
  return isRecord(value) && isString(value.name);
}

export function isAppendRecordingEventsResponse(
  value: unknown,
): value is AppendRecordingEventsResponse {
  return (
    isRecord(value) &&
    isString(value.thread_id) &&
    isBoolean(value.recording) &&
    isNumber(value.accepted)
  );
}

export function isRecordingStatus(value: unknown): value is RecordingStatus {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isBoolean(value.recording) &&
    isNumber(value.step_count)
  );
}

export function isTemplateListResponse(
  value: unknown,
): value is TemplateListResponse {
  return (
    isRecord(value) && isUnknownArray(value.templates) && isNumber(value.total)
  );
}

export function isWorkflowTemplate(value: unknown): value is WorkflowTemplate {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isUnknownArray(value.steps)
  );
}

export function isReplayResult(value: unknown): value is ReplayResult {
  return (
    isRecord(value) &&
    isString(value.workflow_id) &&
    isUnknownArray(value.step_results) &&
    isString(value.status)
  );
}
