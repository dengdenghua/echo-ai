/**
 * Warms the Codex App Server a conversation's next chat reply will use.
 *
 * A conversation's first Codex reply paid a cold App Server start (6.5s to
 * the first word, measured 2026-10-17). The backend keeps one process for a
 * person's chat replies across conversations; asking for it when a Codex
 * conversation opens, or comes back into view, lets the first message land
 * on a running process. Best effort: a failure stays silent and the turn
 * itself reports any account or engine problem.
 */
import { useEffect } from "react";

import { apiPost } from "@/core/api/request";

import { PREWARM_RENEW_MS } from "./opencode-prewarm";

let lastAsked: number | undefined;

export function prewarmCodex(now: number = Date.now()): void {
  if (lastAsked !== undefined && now - lastAsked < PREWARM_RENEW_MS) return;
  lastAsked = now;
  void apiPost("/api/codex/prewarm").catch(() => undefined);
}

/** Only for tests: forget when the process was last warmed. */
export function resetCodexPrewarm(): void {
  lastAsked = undefined;
}

export function useCodexPrewarm(engine: string, enabled = true): void {
  useEffect(() => {
    if (!enabled || engine !== "codex") return;
    prewarmCodex();
    const onVisible = () => {
      if (document.visibilityState === "visible") prewarmCodex();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, engine]);
}
