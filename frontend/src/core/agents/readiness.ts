import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

export interface RoleRegistrationCheck {
  agent_id: string;
  scope: "configured_skill_registration";
  status: "checked" | "needs_attention" | "unknown";
  checks: Array<{
    name: string;
    status: "registered" | "disabled" | "missing" | "unknown";
  }>;
  unchecked: string[];
  dependencies?: { connectors: string[]; mcp_servers: string[] };
}

export async function fetchRoleRegistration(
  agentId: string,
  signal?: AbortSignal,
): Promise<RoleRegistrationCheck> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/agent-market/store/${encodeURIComponent(agentId)}/readiness`,
    { headers: authHeaders(), signal },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<RoleRegistrationCheck>;
}
