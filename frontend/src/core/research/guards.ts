/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import { isRecord, isString, isUnknownArray } from "@/core/utils/guards";
import type { ResearchJob } from "./api";

export function isResearchJob(value: unknown): value is ResearchJob {
  return (
    isRecord(value) &&
    isString(value.job_id) &&
    isUnknownArray(value.materials) &&
    isUnknownArray(value.sources)
  );
}

export function hasJobs(value: unknown): value is { jobs?: ResearchJob[] } {
  return isRecord(value);
}
