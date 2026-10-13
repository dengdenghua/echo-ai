import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { backedOffArtifactInterval } from "./polling";
import { listWorkspaceArtifactRefs } from "./workspace-outputs";

/**
 * Shared React Query hook for workspace artifacts. Consolidates the query
 * configuration that was previously duplicated across chat-box.tsx and
 * context.tsx, reducing redundant API calls.
 */
export function useWorkspaceArtifacts(
  threadId: string | null | undefined,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  },
) {
  const enabled =
    options?.enabled !== false && Boolean(threadId && threadId !== "new");
  const baseInterval = options?.refetchInterval ?? false;
  // One listing is four requests (final / deploy / stages / output). While a
  // run keeps finding the same files, poll less often; React Query keeps the
  // previous data reference when a refetch returns an equal list.
  const streak = useRef<{
    fetches: number;
    data: string[] | undefined;
    unchanged: number;
  }>({ fetches: -1, data: undefined, unchanged: 0 });
  useEffect(() => {
    streak.current.unchanged = 0;
  }, [baseInterval, threadId]);

  return useQuery({
    queryKey: ["workspace-artifacts", threadId],
    queryFn: ({ signal }) => listWorkspaceArtifactRefs(threadId!, signal),
    enabled,
    refetchInterval: (query) => {
      if (baseInterval === false) return false;
      const current = streak.current;
      const fetches = query.state.dataUpdateCount;
      if (fetches !== current.fetches) {
        current.unchanged =
          current.fetches >= 0 && query.state.data === current.data
            ? current.unchanged + 1
            : 0;
        current.fetches = fetches;
        current.data = query.state.data;
      }
      return backedOffArtifactInterval(baseInterval, current.unchanged);
    },
    // Artifact discovery is presentation state, not task execution. The
    // backend keeps working while the tab is hidden; refresh once the tab is
    // visible again instead of polling every three seconds in the background.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 3000,
    gcTime: 30000,
  });
}
