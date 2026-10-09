import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { authHeaders, jsonAuthHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

export type RemoteTransport = "ssh_tunnel" | "wsl";

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
    }
  | {
      /** An Echo on another host (SSH) or in a local WSL distro. */
      kind: "remote";
      backend_id: string;
      transport: RemoteTransport;
      label?: string;
    };

export const LOCAL_WORK_LOCATION: WorkLocation = { kind: "local" };

export interface ExecutionNodeLocation {
  node_id: string;
  label: string;
  online: boolean;
  roles: string[];
  workspaces: { id: string; name: string; ready: boolean }[];
}

export interface RemoteConnection {
  id: string;
  name: string;
  transport: RemoteTransport;
  /** ``user@host:port`` for SSH, the distro name for WSL. */
  target: string;
  health: "ok" | "error" | null;
  health_detail: string | null;
  has_auth: boolean;
}

export interface WslDistro {
  name: string;
  state: string;
  version: number | null;
  default: boolean;
}

export interface WorkLocationsResponse {
  execution_nodes: ExecutionNodeLocation[];
  remote: {
    enabled: boolean;
    can_manage: boolean;
    connections: RemoteConnection[];
  };
  wsl: { available: boolean; distros: WslDistro[] };
  cloud: { available: boolean };
}

export async function fetchWorkLocations(): Promise<WorkLocationsResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/execution/locations`,
    {
      headers: authHeaders(),
    },
  );
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

/** The per-turn context entry the server's location drivers read. */
export function workLocationContext(
  location: WorkLocation,
): Record<string, string> | undefined {
  if (location.kind === "remote") {
    return { kind: "remote", backend_id: location.backend_id };
  }
  if (location.kind !== "node") return undefined;
  return {
    kind: "node",
    node_id: location.node_id,
    workspace_id: location.workspace_id,
    role: location.role,
  };
}

/** A connection the user is filling in on the "add SSH / WSL" dialog. */
export interface RemoteConnectionDraft {
  name: string;
  url: string;
  ssh?: {
    host: string;
    user: string | null;
    port: number;
    identity_file: string | null;
  };
  wsl?: { distro: string };
  auth_token?: string;
}

async function postConnection<T>(
  path: string,
  draft: Omit<RemoteConnectionDraft, "name"> & { name?: string },
): Promise<T> {
  const response = await fetch(`${getBackendBaseURL()}${path}`, {
    method: "POST",
    headers: jsonAuthHeaders(),
    body: JSON.stringify({
      ...draft,
      auth_token: draft.auth_token || undefined,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      detail =
        typeof parsed.detail === "string"
          ? parsed.detail
          : JSON.stringify(parsed.detail ?? parsed);
    } catch {
      /* plain-text error */
    }
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Probe an unsaved connection: opens the SSH forward / WSL loopback and hits /api/health. */
export function testRemoteConnection(
  draft: Omit<RemoteConnectionDraft, "name">,
): Promise<{ status: "ok" | "error"; detail: string | null }> {
  return postConnection("/api/remote-backends/test", draft);
}

export async function addRemoteConnection(
  draft: RemoteConnectionDraft,
): Promise<{ id: string; name: string }> {
  const body = await postConnection<{ backend: { id: string; name: string } }>(
    "/api/remote-backends",
    draft,
  );
  return body.backend;
}

/** ``user@host`` or a ~/.ssh/config alias → the registry's host / user fields. */
export function splitSshTarget(raw: string): {
  host: string;
  user: string | null;
} {
  const text = raw.trim();
  const at = text.lastIndexOf("@");
  if (at <= 0) return { host: text, user: null };
  return { host: text.slice(at + 1), user: text.slice(0, at) };
}

const STORAGE_KEY = "echo.work-location.v1";
const MAX_REMEMBERED = 200;

function readAll(): Record<string, WorkLocation> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, WorkLocation>)
      : {};
  } catch {
    return {};
  }
}

function isWorkLocation(value: unknown): value is WorkLocation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "local") return true;
  if (candidate.kind === "remote") {
    return (
      typeof candidate.backend_id === "string" &&
      (candidate.transport === "ssh_tunnel" || candidate.transport === "wsl")
    );
  }
  return (
    candidate.kind === "node" &&
    typeof candidate.node_id === "string" &&
    typeof candidate.workspace_id === "string" &&
    typeof candidate.role === "string"
  );
}

export function readWorkLocation(
  threadId: string | null | undefined,
): WorkLocation {
  if (!threadId) return LOCAL_WORK_LOCATION;
  const stored = readAll()[threadId];
  return isWorkLocation(stored) ? stored : LOCAL_WORK_LOCATION;
}

export function writeWorkLocation(
  threadId: string,
  location: WorkLocation,
): void {
  try {
    const all = readAll();
    delete all[threadId];
    if (location.kind !== "local") all[threadId] = location;
    // Insertion order is recency; keep the newest choices only.
    const entries = Object.entries(all).slice(-MAX_REMEMBERED);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    /* private mode / quota: the choice lasts for this page only */
  }
}

/** A conversation's work location, remembered per thread id. */
export function useThreadWorkLocation(
  threadId: string | null | undefined,
): [WorkLocation, (location: WorkLocation) => void] {
  const [location, setLocation] = useState<WorkLocation>(() =>
    readWorkLocation(threadId),
  );
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
