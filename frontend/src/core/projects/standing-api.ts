import type { components } from "@/core/api/openapi-types";
import { apiDelete, apiGet, apiPost } from "@/core/api/request";

export type StandingReview = components["schemas"]["StandingReviewResponse"];
export type StandingGrant = components["schemas"]["StandingGrantResponse"];
const path = "/api/projects/{project_id}/standing-authorization" as const;

export async function getStandingGrant(
  project_id: string,
  signal?: AbortSignal,
) {
  return (await apiGet(path, { path: { project_id }, signal })).grant;
}
export function reviewStandingGrant(
  project_id: string,
  phase_ids: string[],
  limit_usd: number,
  signal?: AbortSignal,
) {
  return apiPost("/api/projects/{project_id}/standing-authorization/review", {
    path: { project_id },
    body: { phase_ids, limit_usd },
    signal,
  });
}
export function confirmStandingGrant(
  project_id: string,
  review_id: string,
  signal?: AbortSignal,
) {
  return apiPost("/api/projects/{project_id}/standing-authorization/confirm", {
    path: { project_id },
    body: { review_id, confirmed: true },
    signal,
  });
}
export function revokeStandingGrant(project_id: string, signal?: AbortSignal) {
  return apiDelete(path, { path: { project_id }, signal });
}
