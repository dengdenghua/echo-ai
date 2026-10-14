/**
 * Execution engines installed from the store (``/api/engines``).
 *
 * The list polls once a second while an install runs. When an install ends,
 * the engine readiness the composer reads (Codex model profile, OpenCode
 * status) is refreshed so the newly installed engine becomes selectable.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { apiDelete, apiGet, apiPost, type ApiData } from "@/core/api/request";

export type EngineList = ApiData<"/api/engines", "get">;
export type EngineStatus = EngineList["engines"][number];
export type EngineAction = "install" | "uninstall";

export const ENGINES_QUERY_KEY = ["engines"] as const;

export function engineMegabytes(bytes: number | null | undefined): number {
  return Math.max(1, Math.round((bytes ?? 0) / 1_000_000));
}

export function engineProgress(engine: EngineStatus): number {
  const job = engine.job;
  if (!job?.total) return 0;
  return Math.min(100, Math.floor((job.received * 100) / job.total));
}

function refreshEngineReadiness(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["coder", "codex"] });
  void queryClient.invalidateQueries({ queryKey: ["opencode-status"] });
}

export function useEngines(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ENGINES_QUERY_KEY,
    queryFn: ({ signal }) => apiGet("/api/engines", { signal }),
    enabled,
    staleTime: 30_000,
    refetchInterval: (current) =>
      current.state.data?.engines.some(
        (engine) => engine.state === "installing",
      )
        ? 1000
        : false,
  });
  const installing = query.data?.engines.some(
    (engine) => engine.state === "installing",
  );
  const wasInstalling = useRef(false);
  useEffect(() => {
    if (wasInstalling.current && !installing) {
      refreshEngineReadiness(queryClient);
    }
    wasInstalling.current = Boolean(installing);
  }, [installing, queryClient]);
  return query;
}

export function useEngineAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: EngineAction }) =>
      action === "install"
        ? apiPost("/api/engines/{engine_id}/install", {
            path: { engine_id: id },
          })
        : apiDelete("/api/engines/{engine_id}", { path: { engine_id: id } }),
    onSuccess: (updated) => {
      queryClient.setQueryData<EngineList>(ENGINES_QUERY_KEY, (current) =>
        current
          ? {
              engines: current.engines.map((engine) =>
                engine.id === updated.id ? updated : engine,
              ),
            }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: ENGINES_QUERY_KEY });
      refreshEngineReadiness(queryClient);
    },
  });
}
