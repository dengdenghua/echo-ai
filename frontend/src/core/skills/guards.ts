/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import {
  arrayOf,
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
} from "@/core/utils/guards";
import type { SkillInfo, SkillPerformance } from "./types";

export function hasSkills(value: unknown): value is { skills: SkillInfo[] } {
  return isRecord(value) && isUnknownArray(value.skills);
}

export function isSkillPerformance(value: unknown): value is SkillPerformance {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isNumber(value.usage_count) &&
    isNumber(value.success_count)
  );
}

export const isSkillPerformanceList = arrayOf(isSkillPerformance);
