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
  DeleteTeamTaskResponse,
  ListTeamTasksResponse,
  TeamTask,
  TeamTaskProcessTimelineResponse,
} from "./types";

export function isListTeamTasksResponse(
  value: unknown,
): value is ListTeamTasksResponse {
  return (
    isRecord(value) && isUnknownArray(value.tasks) && isNumber(value.count)
  );
}

export function isTeamTask(value: unknown): value is TeamTask {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.room_id) &&
    isUnknownArray(value.assignees)
  );
}

export function isDeleteTeamTaskResponse(
  value: unknown,
): value is DeleteTeamTaskResponse {
  return (
    isRecord(value) &&
    isString(value.task_id) &&
    isBoolean(value.ok) &&
    isBoolean(value.deleted)
  );
}

export function isTeamTaskProcessTimelineResponse(
  value: unknown,
): value is TeamTaskProcessTimelineResponse {
  return isRecord(value) && isRecord(value.timeline);
}
