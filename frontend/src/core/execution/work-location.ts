import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

/** Where a conversation's turns run. */
export type WorkLocation =
  | { kind: "local" }
  | {
      kind: "node";
      node_id: string;
      workspace_id: string;
      role: string;
      /** Display only; the server re-reads the node and workspace. */
      label?: string;
      workspace_name?: string;
    };

export const LOCAL_WORK_LOCATION: WorkLocation = { kind: "local" };

export interface ExecutionNodeLocation {
  node_id: string;
  label: string;
  online: boolean;
  roles: string[];
  workspaces: { id: string; name: string; ready: boolean }[];
}

export interface WorkLocationsResponse {
  execution_nodes: ExecutionNodeLocation[];
  remote_backends: {
    enabled: boolean;
    backends: { id: string; name: string; health: string | null; has_auth: boolean }[];
  };
}

export async function fetchWorkLocations(): Promise<WorkLocationsResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/execution/locations`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as WorkLocationsResponse;
}

export function useWorkLocations(enabled: boolean) {
  return useQuery({
    queryKey: ["execution", "locations"],
    queryFn: fetchWorkLocations,
    enabled,
    staleTime: 10_000,
    // Node online state is a 45s heartbeat window; keep the menu honest.
    refetchInterval: enabled ? 20_000 : false,
  });
}

/** The per-turn context entry the server's execution_node driver reads. */
export function workLocationContext(
  location: WorkLocation,
): Record<string, string> | undefined {
  if (location.kind !== "node") return undefined;
  return {
    kind: "node",
    node_id: location.node_id,
    workspace_id: location.workspace_id,
    role: location.role,
  };
}

const STORAGE_KEY = "echo.work-location.v1";
const MAX_REMEMBERED = 200;

function readAll(): Record<string, WorkLocation> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, WorkLocation>) : {};
  } catch {
    return {};
  }
}

function isWorkLocation(value: unknown): value is WorkLocation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "local") return true;
  return (
    candidate.kind === "node" &&
    typeof candidate.node_id === "string" &&
    typeof candidate.workspace_id === "string" &&
    typeof candidate.role === "string"
  );
}

export function readWorkLocation(threadId: string | null | undefined): WorkLocation {
  if (!threadId) return LOCAL_WORK_LOCATION;
  const stored = readAll()[threadId];
  return isWorkLocation(stored) ? stored : LOCAL_WORK_LOCATION;
}

export function writeWorkLocation(threadId: string, location: WorkLocation): void {
  try {
    const all = readAll();
    delete all[threadId];
    if (location.kind !== "local") all[threadId] = location;
    // Insertion order is recency; keep the newest choices only.
    const entries = Object.entries(all).slice(-MAX_REMEMBERED);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* private mode / quota: the choice lasts for this page only */
  }
}

/** A conversation's work location, remembered per thread id. */
export function useThreadWorkLocation(
  threadId: string | null | undefined,
): [WorkLocation, (location: WorkLocation) => void] {
  const [location, setLocation] = useState<WorkLocation>(() => readWorkLocation(threadId));
  useEffect(() => {
    setLocation(readWorkLocation(threadId));
  }, [threadId]);
  const update = useCallback(
    (next: WorkLocation) => {
      setLocation(next);
      if (threadId) writeWorkLocation(threadId, next);
    },
    [threadId],
  );
  return [location, update];
}
