import { apiGet } from "@/core/api/request";

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
  return (await apiGet("/api/agent-market/store/{agent_id}/readiness", {
    path: { agent_id: agentId },
    signal,
    errorMessage: (f) => `HTTP ${f.status}`,
  })) as RoleRegistrationCheck;
}
