/**
 * Which HUB agent entries are the same agent, and which one to show: identity keys, display scoring and de-duplication.
 */
import type { AgentWorldAgent } from "@/core/agents/types";
import { LOCAL_AGENT_IDS } from "./agent-world-data";

export const ECHO_CHARACTER_DISPLAY_NAMES = new Set([
  "eve",
  "kane",
  "leon",
  "luna",
  "mira voss",
  "noah",
  "raven",
  "shion",
  "zero",
]);

export function normalizeAgentNameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function agentWorldIdentityKey(agent: AgentWorldAgent): string {
  const profile = agent.character_profile;
  const profileName =
    typeof profile?.name === "string"
      ? normalizeAgentNameKey(profile.name)
      : "";
  if (profileName) return profileName;

  const displayName = agent.display_name || agent.name || agent.id;
  const slashBaseName = displayName.split(/\s*\/\s*/)[0] ?? "";
  const slashBaseKey = normalizeAgentNameKey(slashBaseName);
  if (
    displayName.includes("/") &&
    ECHO_CHARACTER_DISPLAY_NAMES.has(slashBaseKey)
  ) {
    return slashBaseKey;
  }

  return normalizeAgentNameKey(displayName);
}

export function scoreAgentForDisplay(agent: AgentWorldAgent): number {
  let score = 0;
  if (agent.is_installed) score += 1_000_000_000;
  if (LOCAL_AGENT_IDS.has(agent.id)) score += 100_000_000;
  if (agent.is_official) score += 10_000_000;
  if (agent.is_featured) score += 1_000_000;
  score += Math.max(0, agent.downloads ?? 0);
  score += Math.max(0, agent.rating_count ?? 0) * 10;
  score += Math.round(Math.max(0, agent.rating ?? 0) * 100);
  return score;
}

/**
 * Resolve a `?agent=` HUD target to the row the HUD actually renders.
 *
 * The bottom-left switcher and the HUD dedupe by different rules, so an exact
 * name match is not enough: the switcher's Noah row is `market_researcher`,
 * while the HUD collapses every Noah into `echo_noah`. Matching on name alone
 * missed and the HUD silently opened on an arbitrary role. So fall back to the
 * shared identity key — look the requested name up in the full list, then find
 * whichever agent survived dedupe under the same identity.
 */
export function resolveHudAgent(
  all: AgentWorldAgent[],
  deduped: AgentWorldAgent[],
  requestedName: string,
): AgentWorldAgent | null {
  const wanted = requestedName.trim();
  if (!wanted) return null;

  const exact = deduped.find((a) => a.name === wanted || a.id === wanted);
  if (exact) return exact;

  const raw = all.find((a) => a.name === wanted || a.id === wanted);
  if (!raw) return null;
  const key = agentWorldIdentityKey(raw);
  if (!key) return null;
  return deduped.find((a) => agentWorldIdentityKey(a) === key) ?? null;
}

export function dedupeAgentWorldAgents(
  agents: AgentWorldAgent[],
): AgentWorldAgent[] {
  const byName = new Map<string, AgentWorldAgent>();
  for (const agent of agents) {
    const key = agentWorldIdentityKey(agent);
    if (!key) continue;
    const current = byName.get(key);
    if (
      !current ||
      scoreAgentForDisplay(agent) > scoreAgentForDisplay(current)
    ) {
      byName.set(key, agent);
    }
  }
  return Array.from(byName.values());
}
