import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

export interface SharedSpace {
  id: string;
  name: string;
  ready: boolean;
  path: string | null;
  detail: string;
}
export interface SyncPreview {
  token: string;
  local_path: string;
  shared_path: string;
  applied: boolean;
  actions: { path: string; direction: "push" | "pull" }[];
  conflicts: string[];
  skipped: string[];
}

async function request<T>(
  threadId: string,
  suffix = "",
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/shared-spaces${suffix}`,
    {
      method,
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Shared workspace request failed",
    );
  return data as T;
}

export const listSharedSpaces = (threadId: string) =>
  request<{ spaces: SharedSpace[] }>(threadId);
export const attachSharedSpace = (threadId: string, workspaceId: string) =>
  request(threadId, `/${encodeURIComponent(workspaceId)}`, "PUT");
export const detachSharedSpace = (threadId: string, workspaceId: string) =>
  request(threadId, `/${encodeURIComponent(workspaceId)}`, "DELETE");
export const syncSharedSpace = (
  threadId: string,
  workspaceId: string,
  token?: string,
) =>
  request<SyncPreview>(
    threadId,
    `/${encodeURIComponent(workspaceId)}/sync`,
    "POST",
    { token },
  );
