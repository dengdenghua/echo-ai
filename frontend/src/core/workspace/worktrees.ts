import { apiGet, apiPost } from "@/core/api/request";
import type { components } from "@/core/api/openapi-types";

export type GitWorktree = components["schemas"]["GitWorktree"];
export type GitWorktreeList = components["schemas"]["GitWorktreeList"];
export type GitWorktreeCreated = components["schemas"]["GitWorktreeCreated"];

export function listGitWorktrees(
  path: string,
  baseUrl: string,
  signal?: AbortSignal,
) {
  return apiGet("/api/git/worktrees", { query: { path }, baseUrl, signal });
}

export function createGitWorktree(
  path: string,
  revision: string,
  baseUrl: string,
) {
  // Creation is deliberately not retried: a failed response may have followed
  // a successful checkout. Refresh the durable list before trying again.
  return apiPost("/api/git/worktrees", { body: { path, revision }, baseUrl });
}
