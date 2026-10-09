import { apiFetch, apiGet, apiPut, type ApiFailure } from "@/core/api/request";

/** ``"<label>: <status> <body or statusText>"`` — the historical wording. */
function failedWithBody(label: string) {
  return (f: ApiFailure): string =>
    `${label}: ${f.status} ${f.text || f.statusText}`;
}

export interface ArmOption {
  arm_id: string;
  display_name: string;
  description: string;
  affinity: string[];
  icon: string;
  skills: string[];
}

export interface ToolRegistry {
  arms: string[];
  extra_affinity: string[];
  private_skills: string[];
}

export interface CapabilityPermission {
  id: string;
  enabled: boolean;
  available: boolean;
  skill_names: string[];
}

export async function listArms(): Promise<ArmOption[]> {
  return (await apiGet("/api/arms", {
    errorMessage: (f) => `Failed to list arms: ${f.statusText}`,
  })) as ArmOption[];
}

export async function getAgentToolRegistry(
  agentId: string,
): Promise<ToolRegistry> {
  return (await apiGet("/api/agents/{agent_id}/tool-registry", {
    path: { agent_id: agentId },
    errorMessage: (f) => `Failed to load tool-registry: ${f.statusText}`,
  })) as ToolRegistry;
}

export async function saveAgentToolRegistry(
  agentId: string,
  body: ToolRegistry,
): Promise<void> {
  // The success body is ignored, so only the status is checked.
  await apiFetch("put", "/api/agents/{agent_id}/tool-registry", {
    path: { agent_id: agentId },
    body,
    errorMessage: failedWithBody("Failed to save tool-registry"),
  });
}

export async function listCapabilityPermissions(): Promise<
  CapabilityPermission[]
> {
  const body = await apiGet("/api/capability-permissions", {
    errorMessage: (f) =>
      `Failed to list capability permissions: ${f.statusText}`,
  });
  return body.permissions as CapabilityPermission[];
}

export async function updateCapabilityPermission(
  group: string,
  enabled: boolean,
): Promise<CapabilityPermission> {
  return (await apiPut("/api/capability-permissions/{group}", {
    path: { group },
    body: { enabled },
    errorMessage: failedWithBody("Failed to update capability permission"),
  })) as CapabilityPermission;
}
