import {
  failureDetail,
  untypedApi,
  type ApiFailure,
  type HttpMethod,
} from "@/core/api/request";

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
  method: Uppercase<HttpMethod> = "GET",
  body?: unknown,
): Promise<T> {
  const verb = method.toLowerCase() as HttpMethod;
  return untypedApi[verb]<T>(
    `/api/threads/${encodeURIComponent(threadId)}/shared-spaces${suffix}`,
    {
      reason: "thread shared-space routes are not in the OpenAPI snapshot",
      body,
      // Historically sent on every call, including bodiless GET/DELETE.
      headers: { "Content-Type": "application/json" },
      errorMessage: (failure: ApiFailure) => {
        const detail = failureDetail(failure);
        return typeof detail === "string"
          ? detail
          : "Shared workspace request failed";
      },
    },
  );
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
