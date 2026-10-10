import {
  apiFetch,
  apiGet,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

import type {
  CustomSkillContent,
  CustomSkillUpdateRequest,
  SkillInfo,
  SkillInstallRequest,
  SkillInstallResponse,
  SkillPerformance,
  SkillRollbackRequest,
  SkillUpdateRequest,
} from "./types";
import { looseBody } from "@/core/api/response";
import { hasSkills, isSkillPerformanceList } from "./guards";

/** Keep this module's historical ``"<label>: <statusText>"`` wording. */
function failed(label: string) {
  return (failure: ApiFailure): string => `${label}: ${failure.statusText}`;
}

/** The body's ``detail`` when present, else ``"<label>: <statusText>"``. */
function detailOr(label: string) {
  return (failure: ApiFailure): string => {
    const detail = failureDetail(failure);
    return detail === undefined || detail === null
      ? `${label}: ${failure.statusText}`
      : String(detail);
  };
}

const SKILL_ROUTE_MISSING =
  "the per-skill /api/skills/{name} routes are not in the OpenAPI snapshot";
const CUSTOM_SKILL_ROUTE_MISSING =
  "the /api/skills/custom/{name} routes are not in the OpenAPI snapshot";

export async function listSkills(): Promise<SkillInfo[]> {
  const data = await apiGet("/api/skills", {
    errorMessage: failed("Failed to list skills"),
  });
  return data.skills as SkillInfo[];
}

export async function getSkill(name: string): Promise<SkillInfo> {
  return untypedApi.get<SkillInfo>(`/api/skills/${encodeURIComponent(name)}`, {
    reason: SKILL_ROUTE_MISSING,
    errorMessage: failed("Failed to get skill"),
  });
}

export async function updateSkill(
  name: string,
  request: SkillUpdateRequest,
): Promise<SkillInfo> {
  return untypedApi.put<SkillInfo>(`/api/skills/${encodeURIComponent(name)}`, {
    reason: SKILL_ROUTE_MISSING,
    body: request,
    errorMessage: failed("Failed to update skill"),
  });
}

export async function enableSkill(
  skillName: string,
  enabled: boolean,
): Promise<void> {
  // The success body was never read; ``apiFetch`` only checks the status.
  await apiFetch(
    "post",
    enabled
      ? "/api/skills/{skill_name}/enable"
      : "/api/skills/{skill_name}/disable",
    {
      path: { skill_name: skillName },
      errorMessage: failed(`Failed to ${enabled ? "enable" : "disable"} skill`),
    },
  );
}

export async function enableMarketSkill(skillName: string): Promise<void> {
  // The success body was never read; ``apiFetch`` only checks the status.
  await apiFetch("post", "/api/skills-market/{skill_id}/enable", {
    path: { skill_id: skillName },
    errorMessage: detailOr("Failed to enable market skill"),
  });
}

export async function loadSkills(): Promise<SkillInfo[]> {
  return listSkills();
}

export async function installSkill(
  request: SkillInstallRequest,
): Promise<SkillInstallResponse> {
  return untypedApi.post<SkillInstallResponse>("/api/skills/install", {
    reason:
      "the snapshot declares no request body for POST /api/skills/install",
    body: request,
    errorMessage: detailOr("Failed to install skill"),
  });
}

export async function listCustomSkills(): Promise<SkillInfo[]> {
  const data = looseBody(
    await apiGet("/api/skills/custom", {
      errorMessage: failed("Failed to list custom skills"),
    }),
    hasSkills,
  );
  return data.skills;
}

export async function getCustomSkill(
  name: string,
): Promise<CustomSkillContent> {
  return untypedApi.get<CustomSkillContent>(
    `/api/skills/custom/${encodeURIComponent(name)}`,
    {
      reason: CUSTOM_SKILL_ROUTE_MISSING,
      errorMessage: failed("Failed to get custom skill"),
    },
  );
}

export async function updateCustomSkill(
  name: string,
  request: CustomSkillUpdateRequest,
): Promise<CustomSkillContent> {
  return untypedApi.put<CustomSkillContent>(
    `/api/skills/custom/${encodeURIComponent(name)}`,
    {
      reason: CUSTOM_SKILL_ROUTE_MISSING,
      body: request,
      errorMessage: detailOr("Failed to update custom skill"),
    },
  );
}

export async function deleteCustomSkill(
  name: string,
): Promise<{ success: boolean }> {
  return untypedApi.delete<{ success: boolean }>(
    `/api/skills/custom/${encodeURIComponent(name)}`,
    {
      reason: CUSTOM_SKILL_ROUTE_MISSING,
      errorMessage: failed("Failed to delete custom skill"),
    },
  );
}

export async function rollbackCustomSkill(
  name: string,
  request: SkillRollbackRequest,
): Promise<CustomSkillContent> {
  return untypedApi.post<CustomSkillContent>(
    `/api/skills/custom/${encodeURIComponent(name)}/rollback`,
    {
      reason: CUSTOM_SKILL_ROUTE_MISSING,
      body: request,
      errorMessage: failed("Failed to rollback skill"),
    },
  );
}

export async function getSkillPerformance(): Promise<SkillPerformance[]> {
  return looseBody(
    await apiGet("/api/skills/performance", {
      errorMessage: failed("Failed to get skill performance"),
    }),
    isSkillPerformanceList,
  );
}

export async function getDecliningSkills(): Promise<SkillPerformance[]> {
  return looseBody(
    await apiGet("/api/skills/declining", {
      errorMessage: failed("Failed to get declining skills"),
    }),
    isSkillPerformanceList,
  );
}
