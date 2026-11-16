export interface DeferredJsonWriter {
  /** Queue the latest snapshot for one storage key. */
  schedule(key: string, value: unknown): void;
  /** Write the queued snapshot immediately. Safe to call repeatedly. */
  flush(): void;
  /** Drop the queued snapshot without writing it. */
  cancel(): void;
}

type WritableStorage = Pick<Storage, "setItem">;

/**
 * Coalesces high-frequency JSON persists (canvas drags, resize gestures)
 * into one serialization + localStorage write after the gesture settles.
 * Serialization happens in flush, not schedule, so pointer frames stay cheap.
 */
export function createDeferredJsonWriter(
  delayMs = 400,
  storage: WritableStorage = window.localStorage,
): DeferredJsonWriter {
  let pending: { key: string; value: unknown } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    const snapshot = pending;
    pending = null;
    if (!snapshot) return;
    try {
      storage.setItem(snapshot.key, JSON.stringify(snapshot.value));
    } catch {
      // Storage quota/private mode must never interrupt an edit gesture.
    }
  };

  return {
    schedule(key, value) {
      pending = { key, value };
      clearTimer();
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      clearTimer();
      pending = null;
    },
  };
}
