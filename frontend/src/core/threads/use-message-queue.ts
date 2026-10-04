import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { executionStorageKey } from "@/core/execution-location";

export type QueuedMessageState = "waiting" | "sending" | "failed" | "uncertain";
export interface QueuedMessage {
  id: string;
  text: string;
  state: QueuedMessageState;
  error?: string;
}
export interface MessageQueueControl {
  items: QueuedMessage[];
  paused: boolean;
  storageUnavailable: boolean;
  canSteer: boolean;
  enqueue: (text: string) => boolean;
  remove: (id: string) => void;
  edit: (id: string, text: string) => boolean;
  retry: (id: string) => void;
  steer: (id: string) => void;
  pause: () => void;
  resume: () => void;
}
interface Snapshot {
  scope: string;
  items: QueuedMessage[];
  paused: boolean;
}
const LIMIT = 20;
function newId() {
  return `itm_queue_${crypto.randomUUID()}`;
}
function storageKey(scope: string) {
  return executionStorageKey(`echo:message-queue:${scope}`);
}

export function restoreMessageQueue(scope: string): Snapshot {
  const empty = { scope, items: [], paused: false };
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(storageKey(scope)) ?? "null",
    );
    if (saved?.v !== 1 || !Array.isArray(saved.items)) return empty;
    const items: QueuedMessage[] = saved.items
      .slice(0, LIMIT)
      .filter(
        (item: QueuedMessage) =>
          !!item &&
          typeof item.id === "string" &&
          item.id.startsWith("itm_queue_") &&
          typeof item.text === "string" &&
          item.text.trim().length > 0 &&
          item.text.length <= 100_000 &&
          ["waiting", "sending", "failed", "uncertain"].includes(item.state),
      )
      .filter(
        (item: QueuedMessage, index: number, items: QueuedMessage[]) =>
          items.findIndex((candidate) => candidate.id === item.id) === index,
      )
      .map((item: QueuedMessage) => ({
        id: item.id,
        text: item.text,
        state: item.state === "sending" ? "uncertain" : item.state,
      }));
    // A restored window never starts work by itself. Reconcile receipts before
    // the user resumes; an in-flight send must not be blindly replayed.
    return { scope, items, paused: items.length > 0 };
  } catch {
    return empty;
  }
}

export function useMessageQueue({
  scope,
  running,
  ready,
  blocked,
  interrupted,
  receipts,
  failures,
  send,
  discard,
}: {
  scope: string;
  running: boolean;
  ready: boolean;
  blocked: boolean;
  interrupted: boolean;
  receipts: ReadonlySet<string>;
  failures: ReadonlyMap<string, string>;
  send: (item: QueuedMessage, intent: "start" | "steer") => void;
  discard: (id: string) => void;
}): MessageQueueControl {
  const [snapshot, setSnapshot] = useState(() => restoreMessageQueue(scope));
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const current = useRef(snapshot);
  const visible =
    snapshot.scope === scope ? snapshot : { scope, items: [], paused: false };
  useLayoutEffect(() => {
    if (current.current.scope === scope) return;
    current.current = restoreMessageQueue(scope);
    setSnapshot(current.current);
    setStorageUnavailable(false);
  }, [scope]);
  const commit = useCallback(
    (update: (old: Snapshot) => Snapshot) => {
      if (current.current.scope !== scope) return;
      const next = update(current.current);
      if (next === current.current) return;
      current.current = next;
      setSnapshot(next);
      try {
        if (next.items.length)
          sessionStorage.setItem(
            storageKey(scope),
            JSON.stringify({ v: 1, items: next.items, paused: next.paused }),
          );
        else sessionStorage.removeItem(storageKey(scope));
        setStorageUnavailable(false);
      } catch {
        setStorageUnavailable(true);
      }
    },
    [scope],
  );
  const pause = useCallback(
    () => commit((old) => (old.paused ? old : { ...old, paused: true })),
    [commit],
  );
  const resume = useCallback(
    () => commit((old) => ({ ...old, paused: false })),
    [commit],
  );
  const enqueue = useCallback(
    (text: string) => {
      if (
        current.current.scope !== scope ||
        !text.trim() ||
        text.length > 100_000 ||
        current.current.items.length >= LIMIT
      )
        return false;
      commit((old) => ({
        ...old,
        items: [
          ...old.items,
          { id: newId(), text: text.trim(), state: "waiting" },
        ],
      }));
      return true;
    },
    [commit, scope],
  );
  const remove = useCallback(
    (id: string) => {
      if (current.current.scope !== scope) return;
      const item = current.current.items.find((item) => item.id === id);
      if (!item || item.state === "sending") return;
      discard(id);
      commit((old) => ({
        ...old,
        items: old.items.filter((item) => item.id !== id),
      }));
    },
    [commit, discard, scope],
  );
  const edit = useCallback(
    (id: string, text: string) => {
      if (current.current.scope !== scope) return false;
      const item = current.current.items.find((item) => item.id === id);
      if (
        !item ||
        !text.trim() ||
        text.length > 100_000 ||
        !["waiting", "failed"].includes(item.state)
      )
        return false;
      discard(id);
      commit((old) => ({
        ...old,
        items: old.items.map((item) =>
          item.id === id
            ? { id: newId(), text: text.trim(), state: "waiting" }
            : item,
        ),
      }));
      return true;
    },
    [commit, discard, scope],
  );
  const retry = useCallback(
    (id: string) => {
      if (current.current.scope !== scope) return;
      const item = current.current.items.find((item) => item.id === id);
      if (!item || !["failed", "uncertain"].includes(item.state)) return;
      discard(id);
      commit((old) => ({
        ...old,
        paused: false,
        items: old.items.map((item) =>
          item.id === id && ["failed", "uncertain"].includes(item.state)
            ? { ...item, state: "waiting", error: undefined }
            : item,
        ),
      }));
    },
    [commit, discard, scope],
  );
  const submit = useCallback(
    (item: QueuedMessage, intent: "start" | "steer") => {
      if (current.current.scope !== scope || !ready) return;
      const fresh = current.current.items.find(
        (candidate) => candidate.id === item.id,
      );
      if (!fresh || fresh.state !== "waiting") return;
      commit((old) => ({
        ...old,
        items: old.items.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, state: "sending" }
            : candidate,
        ),
      }));
      try {
        send(item, intent);
      } catch (error) {
        commit((old) => ({
          ...old,
          paused: true,
          items: old.items.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, state: "failed", error: String(error) }
              : candidate,
          ),
        }));
      }
    },
    [commit, ready, scope, send],
  );
  const steer = useCallback(
    (id: string) => {
      const item = current.current.items.find((item) => item.id === id);
      if (running && !blocked && item) submit(item, "steer");
    },
    [blocked, running, submit],
  );

  useEffect(() => {
    commit((old) => {
      let changed = false,
        pauseQueue = old.paused;
      const items = old.items
        .filter((item) => {
          if (receipts.has(item.id)) {
            changed = true;
            return false;
          }
          return true;
        })
        .map((item) => {
          if (item.state !== "sending") return item;
          const error = failures.get(item.id);
          if (error || !ready) {
            changed = true;
            pauseQueue = true;
            return {
              ...item,
              state: error ? ("failed" as const) : ("uncertain" as const),
              error,
            };
          }
          return item;
        });
      return changed ? { ...old, items, paused: pauseQueue } : old;
    });
  }, [commit, failures, ready, receipts]);
  useEffect(() => {
    if (interrupted && current.current.items.length) pause();
  }, [interrupted, pause, scope]);
  useEffect(() => {
    const next = current.current.items[0];
    if (
      !running &&
      ready &&
      !blocked &&
      !current.current.paused &&
      next?.state === "waiting"
    )
      submit(next, "start");
  }, [blocked, ready, running, snapshot, submit]);
  return useMemo(
    () => ({
      items: visible.items,
      paused: visible.paused,
      storageUnavailable,
      canSteer: running && ready && !blocked,
      enqueue,
      remove,
      edit,
      retry,
      steer,
      pause,
      resume,
    }),
    [
      visible.items,
      visible.paused,
      storageUnavailable,
      running,
      ready,
      blocked,
      enqueue,
      remove,
      edit,
      retry,
      steer,
      pause,
      resume,
    ],
  );
}
