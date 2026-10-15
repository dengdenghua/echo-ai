/**
 * Warms the OpenCode engine a conversation's next reply will use.
 *
 * The first reply after the backend's engine pool went idle paid
 * `opencode serve`'s cold start (~2.7s measured 2026-10-15). A conversation
 * that opens on OpenCode, or comes back into view, asks the backend to start
 * that engine while the user is still typing. Best effort: a failure stays
 * silent and the turn itself reports any engine or model problem.
 */
import { useEffect } from "react";

import { apiPost } from "@/core/api/request";

/** The backend keeps an idle engine for 10 minutes; renew well inside it. */
export const PREWARM_RENEW_MS = 5 * 60_000;

const lastAsked = new Map<string, number>();

export function prewarmOpencode(
  model: string | null | undefined,
  now: number = Date.now(),
): void {
  const key = model ?? "";
  const last = lastAsked.get(key);
  if (last !== undefined && now - last < PREWARM_RENEW_MS) return;
  lastAsked.set(key, now);
  void apiPost("/api/opencode/prewarm", {
    query: model ? { model } : {},
  }).catch(() => undefined);
}

/** Only for tests: forget when each model was last warmed. */
export function resetOpencodePrewarm(): void {
  lastAsked.clear();
}

export function useOpencodePrewarm(
  engine: string,
  model: string | null | undefined,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || engine !== "opencode") return;
    prewarmOpencode(model);
    const onVisible = () => {
      if (document.visibilityState === "visible") prewarmOpencode(model);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, engine, model]);
}
