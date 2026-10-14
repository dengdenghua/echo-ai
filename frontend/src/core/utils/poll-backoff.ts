/**
 * Polling that slows down while nothing changes.
 *
 * Use as a React Query ``refetchInterval``: every poll that finds the same
 * data doubles the wait, up to ``max``; a change snaps it back to ``base``.
 * React Query keeps the previous data reference when a refetch returns an
 * equal result, so reference equality tells "unchanged" apart.
 */

interface PolledQuery {
  state: { dataUpdateCount: number; data: unknown };
}

const streaks = new WeakMap<
  object,
  { updates: number; data: unknown; unchanged: number }
>();

export function unchangedBackoff(
  query: PolledQuery,
  base: number,
  max: number,
): number {
  const { dataUpdateCount: updates, data } = query.state;
  const seen = streaks.get(query);
  if (!seen) {
    streaks.set(query, { updates, data, unchanged: 0 });
    return base;
  }
  if (seen.updates !== updates) {
    seen.unchanged = data === seen.data ? seen.unchanged + 1 : 0;
    seen.updates = updates;
    seen.data = data;
  }
  return Math.min(base * 2 ** seen.unchanged, max);
}
