/**
 * Per-thread "needs your attention" markers for the sidebar.
 *
 * The live run-status light only exists while a thread's page is mounted:
 * leaving the page clears it. A thread that failed, paused or asked for an
 * approval while the user was elsewhere must keep its marker until the user
 * actually looks at it, so the attention notifier records those moments here
 * and the sidebar folds the unseen ones back into its status lights.
 *
 * Entries also carry the latest known cause (approval / pause reason), which
 * the status light uses for its label even after the thread has been seen.
 * In-memory only: a reload starts clean.
 */
import { useCallback, useSyncExternalStore } from "react";

import type { ThreadAttentionSignal } from "@/core/events";

export type ThreadAttentionKind = ThreadAttentionSignal["kind"] | "failed";
export type ThreadAttentionReason = NonNullable<
  ThreadAttentionSignal["reason"]
>;

export interface ThreadAttentionEntry {
  threadId: string;
  kind: ThreadAttentionKind;
  reason?: ThreadAttentionReason;
  /** PauseController task behind a polled pause, so a dismissed pause can
   * drop its marker. */
  taskId?: string;
  at: number;
  /** True until the user views the thread with the window focused. */
  unseen: boolean;
}

const MAX_ENTRIES = 300;

let entries: ReadonlyMap<string, ThreadAttentionEntry> = new Map();
const listeners = new Set<() => void>();

function publish(next: Map<string, ThreadAttentionEntry>) {
  entries = next;
  for (const listener of Array.from(listeners)) listener();
}

export function setThreadAttention(entry: ThreadAttentionEntry): void {
  if (!entry.threadId) return;
  const current = entries.get(entry.threadId);
  if (
    current &&
    current.kind === entry.kind &&
    current.reason === entry.reason &&
    current.taskId === entry.taskId &&
    current.unseen === entry.unseen
  ) {
    return;
  }
  const next = new Map(entries);
  next.delete(entry.threadId);
  next.set(entry.threadId, entry);
  // Insertion order is recency order; drop the oldest beyond the cap.
  while (next.size > MAX_ENTRIES) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  publish(next);
}

/** Record why a thread waits (for the marker label) without changing
 * whether the user has seen it; a new entry starts as seen. */
export function describeThreadAttention(
  threadId: string,
  kind: ThreadAttentionKind,
  reason?: ThreadAttentionReason,
): void {
  if (!threadId) return;
  const current = entries.get(threadId);
  setThreadAttention({
    threadId,
    kind,
    reason,
    taskId: current?.taskId,
    at: current?.at ?? Date.now(),
    unseen: current?.unseen ?? false,
  });
}

export function clearThreadAttention(threadId: string): void {
  if (!entries.has(threadId)) return;
  const next = new Map(entries);
  next.delete(threadId);
  publish(next);
}

/** Drop markers that came from a PauseController task that no longer
 * exists (resumed elsewhere, or the paused task was dismissed). */
export function clearThreadAttentionForTask(taskId: string): void {
  let next: Map<string, ThreadAttentionEntry> | null = null;
  for (const [threadId, entry] of entries) {
    if (entry.taskId !== taskId) continue;
    next ??= new Map(entries);
    next.delete(threadId);
  }
  if (next) publish(next);
}

export function markThreadAttentionSeen(threadId: string): void {
  const current = entries.get(threadId);
  if (!current?.unseen) return;
  const next = new Map(entries);
  next.set(threadId, { ...current, unseen: false });
  publish(next);
}

export function getThreadAttentionSnapshot(): ReadonlyMap<
  string,
  ThreadAttentionEntry
> {
  return entries;
}

export function subscribeThreadAttention(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThreadAttentionMap(): ReadonlyMap<
  string,
  ThreadAttentionEntry
> {
  return useSyncExternalStore(
    subscribeThreadAttention,
    getThreadAttentionSnapshot,
    getThreadAttentionSnapshot,
  );
}

export function useThreadAttention(
  threadId: string | undefined,
): ThreadAttentionEntry | undefined {
  const getSnapshot = useCallback(
    () => (threadId ? entries.get(threadId) : undefined),
    [threadId],
  );
  return useSyncExternalStore(
    subscribeThreadAttention,
    getSnapshot,
    getSnapshot,
  );
}

/** The store as an ``AttentionTracker`` sink. */
export const threadAttentionSink = {
  set: setThreadAttention,
  describe: describeThreadAttention,
  clear: clearThreadAttention,
  clearTask: clearThreadAttentionForTask,
};

export function resetThreadAttentionForTests(): void {
  publish(new Map());
}
