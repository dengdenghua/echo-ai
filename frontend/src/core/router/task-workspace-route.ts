import { DEFAULT_PRIMARY_AGENT_ID } from "@/core/agents/persona-policy";
import { canonicalAgentId } from "@/core/agents/aliases";

export function taskWorkspaceRoute({
  agentId,
  prompt,
  workspacePath,
}: {
  agentId?: string | null;
  prompt?: string | null;
  workspacePath?: string | null;
} = {}) {
  const params = new URLSearchParams();
  const cleanPrompt = prompt?.trim() ?? "";
  const cleanAgent = agentId?.trim() ?? "";
  const cleanWorkspacePath = workspacePath?.trim() ?? "";
  if (cleanPrompt) params.set("prompt", cleanPrompt);
  // The default persona is implicit in `/workspace/realtime/new`, so it never
  // needs to ride along as a query param. Compare against the canonical id:
  // callers hand us either the legacy runtime id (`general`) or the already
  // normalized persona (`eve`, via `primaryPersonaAgentIdOrDefault`), and both
  // must collapse to the same bare route.
  if (cleanAgent && canonicalAgentId(cleanAgent) !== DEFAULT_PRIMARY_AGENT_ID) {
    params.set("agent", cleanAgent);
  }
  if (cleanWorkspacePath) params.set("workspace_path", cleanWorkspacePath);
  const query = params.toString() ? `?${params.toString()}` : "";
  return `/workspace/realtime/new${query}`;
}
