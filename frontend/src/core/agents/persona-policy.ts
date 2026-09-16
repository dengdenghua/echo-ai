import { canonicalAgentId } from "./aliases";
/**
 * The White Ghost squad are Echo's fixed conversation identities.
 *
 * Every other installed agent is an on-demand capability: it can join a task
 * roster, but it must not create another personal-history lane or replace the
 * active squad member in the sidebar.
 */
export const WHITE_GHOST_AGENT_ORDER = [
  "eve",
  "kane",
  "raven",
  "luna",
  "shion",
  "noah",
  "zero",
  "leon",
] as const;

export const WHITE_GHOST_AGENT_IDS = new Set<string>(WHITE_GHOST_AGENT_ORDER);

export const DEFAULT_PRIMARY_AGENT_ID = "eve";

export function isPrimaryPersonaAgentId(
  value: string | null | undefined,
): boolean {
  return WHITE_GHOST_AGENT_IDS.has(canonicalAgentId(value?.trim() ?? ""));
}

export function primaryPersonaAgentIdOrDefault(
  value: string | null | undefined,
): string {
  const clean = canonicalAgentId(value?.trim() ?? "");
  return isPrimaryPersonaAgentId(clean) ? clean : DEFAULT_PRIMARY_AGENT_ID;
}
