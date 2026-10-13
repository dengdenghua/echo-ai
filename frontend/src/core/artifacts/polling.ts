import type { StreamPhase } from "@/core/realtime/stream-vitals";

export const ACTIVE_ARTIFACT_REFRESH_MS = 3000;
export const MAX_ARTIFACT_REFRESH_MS = 15_000;

export function getWorkspaceArtifactRefetchInterval(
  isThreadLoading: boolean,
  phase?: StreamPhase,
): number | false {
  if (!isThreadLoading) return false;
  // Before the agent's first event nothing in this turn can have written an
  // output. A first response that takes minutes used to cost four requests
  // every three seconds; the run-finished refresh still lists the files.
  if (phase === "waiting") return false;
  return ACTIVE_ARTIFACT_REFRESH_MS;
}

/** Each fetch that finds the same list doubles the wait, up to the cap; a
 * changed list snaps back to the base interval. */
export function backedOffArtifactInterval(
  base: number,
  unchangedFetches: number,
): number {
  return Math.min(base * 2 ** unchangedFetches, MAX_ARTIFACT_REFRESH_MS);
}
