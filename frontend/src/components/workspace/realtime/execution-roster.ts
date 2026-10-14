import { canonicalAgentId } from "@/core/agents/aliases";
import { builtinPersonaDisplayName } from "@/core/agents/persona-display";
import type { LiveToolEvent } from "../live-tool-timeline";
import type { ChatCollaborationRosterEntry } from "./task-collaborator-control";

/** Display projection only: summoned workers do not change saved team membership. */
export function executionRoster(
  roster: ChatCollaborationRosterEntry[],
  events: LiveToolEvent[],
  profiles: { name: string; display_name?: string | null; avatar_url?: string | null; icon?: string | null }[],
) {
  const members = new Map(roster.map(member => [canonicalAgentId(member.agent_id), member]));
  const focusIds = new Map<string, string>();
  for (const event of events) {
    if (!event.lifecycle && !event.subAgentRole && !event.subagentCodename) continue;
    const rawId = event.agentId ?? event.subagentCodename ?? event.subAgentRole;
    if (!rawId) continue;
    const id = canonicalAgentId(rawId);
    focusIds.set(id, rawId);
    if (members.has(id)) continue;
    const profile = profiles.find(p => canonicalAgentId(p.name) === id);
    members.set(id, {
      agent_id: id,
      name: id,
      display_name: profile?.display_name ?? builtinPersonaDisplayName(id) ?? event.subagentCodename ?? event.agentName ?? id,
      avatar_url: profile?.avatar_url ?? event.subagentAvatarUrl ?? (builtinPersonaDisplayName(id) ? `/api/agents/${encodeURIComponent(id)}/avatar` : null),
      icon: profile?.icon ?? event.subagentAvatar,
      role: "member",
    });
  }
  return { members: [...members.values()], focusIds };
}
