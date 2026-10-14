import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, apiGet } from "@/core/api/request";

export interface ReachChannel {
  platform: string;
  available: boolean;
  backend: string;
  detail?: string;
  requires_login?: boolean;
}

export interface ReachStatus {
  ok: boolean;
  healthy: number;
  total: number;
  collection_count: number;
  channels: ReachChannel[];
}

const REACH_STATUS_KEY = ["reach-status"] as const;

async function fetchReachStatus(signal?: AbortSignal): Promise<ReachStatus> {
  return (await apiGet("/api/reach/status", {
    signal,
    errorMessage: (failure) => `reach status failed: ${failure.status}`,
  })) as ReachStatus;
}

export function useReachStatus() {
  const query = useQuery({
    queryKey: REACH_STATUS_KEY,
    queryFn: ({ signal }) => fetchReachStatus(signal),
    refetchInterval: 30_000,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  return {
    status: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

export function useClearReachCache() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      await apiFetch("delete", "/api/reach/cache", {
        errorMessage: (failure) =>
          `clear reach cache failed: ${failure.status}`,
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: REACH_STATUS_KEY }),
  });
  return { clear: mutation.mutateAsync, isPending: mutation.isPending };
}
