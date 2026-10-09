import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/core/api/request";

import type { Agent } from "./types";

export interface RemoteGroupAgent {
  agent_id: string;
  name: string;
  description?: string;
  status?: string;
}

export function remoteToGroupAgent(remote: RemoteGroupAgent): Agent {
  return {
    name: remote.agent_id,
    display_name: remote.name,
    description: `远程角色 · 仅 @点名时响应${remote.status === "unreachable" ? " · 连接不可用" : ""}。${remote.description ?? ""}`,
    icon: "🌐",
    model: null,
    tool_groups: null,
    capabilities: { remote_a2a: true },
  };
}

/** Group picker only: a remote role is not a local model engine. */
export function useRemoteGroupAgents(enabled = true): Agent[] {
  const { data } = useQuery({
    queryKey: ["remote-group-agents"],
    enabled,
    queryFn: async ({ signal }): Promise<RemoteGroupAgent[]> => {
      const payload = (await apiGet("/api/a2a/agents", {
        signal,
        errorMessage: () => "无法加载远程角色",
      })) as { agents: RemoteGroupAgent[] };
      return payload.agents.filter((entry) =>
        entry.agent_id.startsWith("a2a_"),
      );
    },
    staleTime: 10_000,
    refetchInterval: enabled ? 20_000 : false,
  });
  return (data ?? []).map(remoteToGroupAgent);
}
