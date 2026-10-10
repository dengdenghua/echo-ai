/**
 * Remote workspace collaboration API client.
 *
 * Wraps the ``/api/workspaces`` endpoints exposed by
 * ``runtime/sensing/gateway/workspace_api_router.py``. The route is
 * gated by the ``ui.remote_workspace`` feature flag on the backend —
 * callers should also defensively handle 404 / 501 responses.
 */

import {
  apiFetch,
  apiGet,
  apiPost,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

import type {
  AcquireLeaseParams,
  CreateWorkspaceParams,
  FileLease,
  Workspace,
  WorkspaceHealth,
  WorkspaceMember,
} from "./types";
import { looseBody } from "@/core/api/response";
import {
  hasReady,
  isFileLease,
  isFileLeaseList,
  isWorkspaceBody,
  isWorkspaceList,
  isWorkspaceMemberList,
} from "./guards";

/**
 * Historical wording: the JSON ``detail`` (or the raw text / status text for
 * a non-JSON body), else ``"<label>: <status>"``.
 */
function workspaceError(label: string) {
  return (failure: ApiFailure): string => {
    const { payload } = failure;
    const detail: unknown =
      payload !== undefined && payload !== null
        ? (failureDetail(failure) ?? "")
        : failure.text || failure.statusText;
    return detail ? String(detail) : `${label}: ${failure.status}`;
  };
}

export async function listWorkspaces(): Promise<Workspace[]> {
  // Identity comes from the bearer token / HttpOnly cookie. A separately
  // persisted user id can drift from the JWT subject and cause a false 403.
  const data = looseBody(
    await apiGet("/api/workspaces", {
      errorMessage: workspaceError("Failed to load workspaces"),
    }),
    isWorkspaceList,
  );
  return Array.isArray(data) ? data : (data.workspaces ?? []);
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const data = looseBody(
    await apiGet("/api/workspaces/{workspace_id}", {
      path: { workspace_id: id },
      errorMessage: workspaceError("Failed to load workspace"),
    }),
    isWorkspaceBody,
  );
  return "workspace" in data ? data.workspace : data;
}

export async function createWorkspace(
  params: CreateWorkspaceParams,
): Promise<Workspace> {
  const data = looseBody(
    await apiPost("/api/workspaces", {
      body: params,
      errorMessage: workspaceError("Failed to create workspace"),
    }),
    isWorkspaceBody,
  );
  return "workspace" in data ? data.workspace : data;
}

// Calls below that return ``void`` never read the success body, so they use
// ``apiFetch`` (status check only) rather than a JSON-parsing helper.

export async function deleteWorkspace(id: string): Promise<void> {
  await apiFetch("delete", "/api/workspaces/{workspace_id}", {
    path: { workspace_id: id },
    errorMessage: workspaceError("Failed to delete workspace"),
  });
}

export async function listMembers(
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const data = looseBody(
    await apiGet("/api/workspaces/{workspace_id}/members", {
      path: { workspace_id: workspaceId },
      errorMessage: workspaceError("Failed to load workspace members"),
    }),
    isWorkspaceMemberList,
  );
  return Array.isArray(data) ? data : (data.members ?? []);
}

export async function addMember(
  workspaceId: string,
  memberId: string,
  role: string,
): Promise<void> {
  await apiFetch("post", "/api/workspaces/{workspace_id}/members", {
    path: { workspace_id: workspaceId },
    body: { member_id: memberId, role },
    errorMessage: workspaceError("Failed to add workspace member"),
  });
}

export async function removeMember(
  workspaceId: string,
  memberId: string,
): Promise<void> {
  await apiFetch(
    "delete",
    "/api/workspaces/{workspace_id}/members/{member_id}",
    {
      path: { workspace_id: workspaceId, member_id: memberId },
      errorMessage: workspaceError("Failed to remove workspace member"),
    },
  );
}

export async function acquireLease(
  workspaceId: string,
  params: AcquireLeaseParams,
): Promise<FileLease> {
  return looseBody(await apiPost("/api/workspaces/{workspace_id}/lease", {
    path: { workspace_id: workspaceId },
    body: params,
    errorMessage: workspaceError("Failed to acquire file lease"),
  }), isFileLease);
}

export async function releaseLease(
  workspaceId: string,
  leaseId: string,
): Promise<void> {
  await apiFetch(
    "delete",
    "/api/workspaces/{workspace_id}/lease/{lease_id}",
    {
      path: { workspace_id: workspaceId, lease_id: leaseId },
      errorMessage: workspaceError("Failed to release file lease"),
    },
  );
}

export async function renewLease(
  workspaceId: string,
  leaseId: string,
  ttl?: number,
): Promise<FileLease> {
  const body: { ttl_seconds?: number } = {};
  if (typeof ttl === "number") body.ttl_seconds = ttl;
  return looseBody(await apiPost(
    "/api/workspaces/{workspace_id}/lease/{lease_id}/renew",
    {
      path: { workspace_id: workspaceId, lease_id: leaseId },
      body,
      errorMessage: workspaceError("Failed to renew file lease"),
    },
  ), isFileLease);
}

export async function listLeases(workspaceId: string): Promise<FileLease[]> {
  const data = looseBody(
    await apiGet("/api/workspaces/{workspace_id}/leases", {
      path: { workspace_id: workspaceId },
      errorMessage: workspaceError("Failed to load file leases"),
    }),
    isFileLeaseList,
  );
  return Array.isArray(data) ? data : (data.leases ?? []);
}

export async function checkHealth(
  workspaceId: string,
): Promise<WorkspaceHealth> {
  const data = await untypedApi.post<WorkspaceHealth & { ok?: boolean }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/health`,
    {
      reason: "the snapshot declares no body, but the client sends {}",
      body: {},
      errorMessage: workspaceError("Workspace health check failed"),
    },
  );
  return { healthy: data.healthy ?? data.ok ?? false, detail: data.detail };
}

// Re-export for callers that want a single import site.
export type {
  AcquireLeaseParams,
  CreateWorkspaceParams,
  FileLease,
  LeaseKind,
  MemberRole,
  MountType,
  Workspace,
  WorkspaceHealth,
  WorkspaceMember,
} from "./types";

export async function getWorkspaceExecutionDirectory(
  workspaceId: string,
): Promise<string> {
  const data = looseBody(await apiGet(
    "/api/workspaces/{workspace_id}/execution-directory",
    {
      path: { workspace_id: workspaceId },
      errorMessage: workspaceError("Workspace directory unavailable"),
    },
  ), hasReady);
  if (!data.ready || !data.filesystem_path)
    throw new Error(
      data.detail ||
        "Mount the shared workspace on the executing Echo device first.",
    );
  return data.filesystem_path;
}
