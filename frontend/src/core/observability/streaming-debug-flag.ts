import { useSyncExternalStore } from "react";

/**
 * Whether the floating streaming debugger is shown. It is a developer tool:
 * on in dev builds unless turned off, off in production unless turned on
 * (Settings → 可观测性, or `localStorage["echo:debug:streaming"] = "1"`).
 */
export const STREAMING_DEBUG_KEY = "echo:debug:streaming";
const CHANGE_EVENT = "echo:streaming-debug-change";

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STREAMING_DEBUG_KEY);
  } catch {
    return null;
  }
}

export function isStreamingDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const stored = readStored();
  if (stored === "1") return true;
  if (stored === "0") return false;
  return Boolean(import.meta.env.DEV);
}

export function setStreamingDebugEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STREAMING_DEBUG_KEY, enabled ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode); the toggle just won't stick.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useStreamingDebugEnabled(): boolean {
  return useSyncExternalStore(subscribe, isStreamingDebugEnabled, () => false);
}
