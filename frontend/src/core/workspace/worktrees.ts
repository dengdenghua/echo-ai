import { authHeaders, jsonAuthHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

export interface GitWorktree {
  path: string;
  branch: string;
  commit: string;
  locked: boolean;
  current: boolean;
}

export interface GitWorktreeList {
  root: string;
  branches: string[];
  worktrees: GitWorktree[];
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: unknown;
    } | null;
    throw new Error(
      typeof payload?.detail === "string"
        ? payload.detail
        : `Git request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

export async function listGitWorktrees(
  path: string,
  signal?: AbortSignal,
): Promise<GitWorktreeList> {
  const data = await readResponse<GitWorktreeList>(
    await fetch(
      `${getBackendBaseURL()}/api/git/worktrees?path=${encodeURIComponent(path)}`,
      {
        headers: authHeaders(),
        signal,
      },
    ),
  );
  if (
    typeof data.root !== "string" ||
    !Array.isArray(data.branches) ||
    !data.branches.every((branch) => typeof branch === "string") ||
    !Array.isArray(data.worktrees) ||
    !data.worktrees.every(
      (item) =>
        item &&
        typeof item.path === "string" &&
        typeof item.branch === "string" &&
        typeof item.commit === "string",
    )
  )
    throw new Error("Echo service returned an invalid Git workspace list");
  return data;
}

export async function createGitWorktree(
  path: string,
  revision: string,
): Promise<{ path: string; branch: string; commit: string }> {
  const data = await readResponse<{
    path: string;
    branch: string;
    commit: string;
  }>(
    await fetch(`${getBackendBaseURL()}/api/git/worktrees`, {
      method: "POST",
      headers: jsonAuthHeaders(),
      body: JSON.stringify({ path, revision }),
    }),
  );
  if (
    typeof data.path !== "string" ||
    !data.path ||
    typeof data.branch !== "string" ||
    typeof data.commit !== "string"
  ) {
    throw new Error("Echo service did not return the created workspace");
  }
  return data;
}
