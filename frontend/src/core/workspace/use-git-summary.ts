import { useCallback, useEffect, useRef, useState } from "react";

import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { swallow } from "@/core/utils/log";

/**
 * Aggregated git counts for the workspace note badge.
 *
 * Mirrors ``GET /api/git/summary`` — branch position plus how much the
 * working tree moved. ``untrackedFiles`` is the reason to distrust a zero in
 * ``added`` / ``removed``: untracked files count towards ``changedFiles`` but
 * never appear in a diff, so a caller that wants to explain the missing line
 * totals must look there, not at ``diffError``.
 */
export interface GitSummary {
  branch: string;
  /**
   * ``branch`` is empty *and* this is true when HEAD is detached — git prints
   * ``HEAD (no branch)`` there, which is not a name worth showing. Render your
   * own localized wording from ``detachedHead`` instead.
   */
  detached: boolean;
  /** True when this checkout is a linked ``git worktree``, not the main one. */
  worktree: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  changedFiles: number;
  /** Counted in ``changedFiles``; invisible to ``git diff``. */
  untrackedFiles: number;
  added: number;
  removed: number;
  /** ``git`` itself failed (missing binary, timeout, not a repository). */
  error: string | null;
  /** ``git diff`` failed on its own — line totals are unusable. */
  diffError: string | null;
}

interface GitSummaryPayload {
  branch?: unknown;
  detached?: unknown;
  worktree?: unknown;
  upstream?: unknown;
  ahead?: unknown;
  behind?: unknown;
  changed_files?: unknown;
  untracked_files?: unknown;
  added?: unknown;
  removed?: unknown;
  error?: unknown;
  diff_error?: unknown;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
/**
 * A single agent turn writes dozens of files, and every write re-broadcasts
 * ``echo:workspace-changed``. Collapse that burst so the note refetches at
 * most twice a second instead of once per file.
 */
const REFETCH_THROTTLE_MS = 500;

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeGitSummary(
  payload: GitSummaryPayload | null,
): GitSummary | null {
  if (!payload) return null;
  return {
    branch: typeof payload.branch === "string" ? payload.branch : "",
    detached: payload.detached === true,
    worktree: payload.worktree === true,
    upstream: typeof payload.upstream === "string" ? payload.upstream : null,
    ahead: toCount(payload.ahead),
    behind: toCount(payload.behind),
    changedFiles: toCount(payload.changed_files),
    untrackedFiles: toCount(payload.untracked_files),
    added: toCount(payload.added),
    removed: toCount(payload.removed),
    error: typeof payload.error === "string" ? payload.error : null,
    diffError: typeof payload.diff_error === "string" ? payload.diff_error : null,
  };
}

export function useGitSummary(
  workDir: string | null | undefined,
  options: { enabled?: boolean; pollIntervalMs?: number } = {},
) {
  const { enabled = true, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = options;
  const [summary, setSummary] = useState<GitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastFetchAtRef = useRef(0);
  const active = enabled && typeof workDir === "string" && workDir.length > 0;

  const refresh = useCallback(async () => {
    if (!active || !workDir) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastFetchAtRef.current = Date.now();
    setIsLoading(true);
    try {
      const response = await fetch(
        `${getBackendBaseURL()}/api/git/summary?path=${encodeURIComponent(workDir)}`,
        { headers: authHeaders(), signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(`git summary unavailable (${response.status})`);
      }
      const payload = normalizeGitSummary(
        (await response.json()) as GitSummaryPayload,
      );
      if (controller.signal.aborted) return;
      setSummary(payload);
      setError(null);
    } catch (cause) {
      if (controller.signal.aborted) return;
      swallow(cause, "git-summary");
      // The last good reading stays on screen; only the freshness marker flips.
      setError(cause instanceof Error ? cause.message : "git summary unavailable");
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [active, workDir]);

  useEffect(() => {
    if (!active) {
      setSummary(null);
      setError(null);
      return;
    }
    void refresh();
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [active, refresh]);

  useEffect(() => {
    if (!active || pollIntervalMs <= 0) return;
    const timer = window.setInterval(() => {
      // Background tabs do not need a fresh reading — the visibility handler
      // below catches up the moment the user comes back.
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [active, pollIntervalMs, refresh]);

  useEffect(() => {
    if (!active) return;
    const onWorkspaceChanged = () => {
      if (Date.now() - lastFetchAtRef.current < REFETCH_THROTTLE_MS) return;
      void refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("echo:workspace-changed", onWorkspaceChanged);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("echo:workspace-changed", onWorkspaceChanged);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, refresh]);

  return { summary, error, isLoading, refresh };
}
