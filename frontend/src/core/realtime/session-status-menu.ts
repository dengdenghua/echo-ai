/**
 * The chat header's status menu (环境 / 上下文 / 产出 / 来源) owns context
 * compression on the pages that mount it. While one is mounted, the
 * composer's context ring links to it instead of compressing by itself.
 */
import { useSyncExternalStore } from "react";

type Opener = () => void;

const openers: Opener[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Called by the mounted menu; returns the cleanup for unmount. */
export function registerSessionStatusMenu(open: Opener): () => void {
  openers.push(open);
  emit();
  return () => {
    const index = openers.lastIndexOf(open);
    if (index >= 0) openers.splice(index, 1);
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function latestOpener(): Opener | null {
  return openers[openers.length - 1] ?? null;
}

/** Opens the most recently mounted status menu, or ``null`` when there is none. */
export function useSessionStatusMenuOpener(): Opener | null {
  return useSyncExternalStore(subscribe, latestOpener, () => null);
}
