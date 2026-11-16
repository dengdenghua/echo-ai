// Local replay cache (P3 of docs/client-replay-design.md).
//
// Stores the persisted per-thread event log in IndexedDB so a reopening
// client can render the thread instantly (offline-capable, read-only)
// and then reconcile with an incremental ``thread/events`` fetch.
//
// Design rules:
//  - Only AUTHORITATIVE, SEQUENCED slices are cached — events from
//    ``thread/events`` responses. Live notifications carry no sequence,
//    so they never enter the cache directly; the next events fetch after
//    the cached cursor re-supplies them with their log coordinates.
//  - Writes are keyed by ``sequence`` and idempotent (put overwrites),
//    so overlapping pages can be appended without dedupe bookkeeping.
//  - The cache is a read-through optimization ONLY: every authoritative
//    decision (stream reset, drift) still defers to the server snapshot
//    path. A corrupt or stale cache costs one fallback, never wrong UI.

import { currentActorScope } from "@/core/auth/api";

import type { SequencedLoggedEvent } from "./replay";

/** Smallest sequence still present (1 when the cache holds the full
 * log). Grows when the capacity trim drops the oldest prefix — cold
 * start then renders the recent window and pages older turns via the
 * snapshot path (``loadOlderTurns``). */
export interface ReplayCacheMeta {
  streamId: string | null;
  /** Highest cached sequence == the client's resume cursor. */
  cursor: number;
  partialFrom: number;
}

export interface ReplayCacheEntry extends ReplayCacheMeta {
  events: SequencedLoggedEvent[];
}

export interface ReplayCacheStore {
  load(threadId: string): Promise<ReplayCacheEntry | null>;
  /** Append a sequenced slice (overwrites on sequence collision) and
   * advance the meta cursor/streamId. Trims the oldest prefix beyond
   * the per-thread event cap. */
  append(
    threadId: string,
    events: readonly SequencedLoggedEvent[],
    meta: { streamId: string | null; cursor: number },
  ): Promise<void>;
  clear(threadId: string): Promise<void>;
}

/**
 * Per-thread event cap. Five thousand recent events comfortably cover active
 * work while bounding cold-start JSON/IndexedDB memory. Older history remains
 * authoritative on the server and pages in through thread/resume.
 */
export const REPLAY_CACHE_MAX_EVENTS = 5_000;

// ── In-memory implementation (tests, SSR, no-IDB environments) ──

export function createMemoryReplayCache(
  maxEvents = REPLAY_CACHE_MAX_EVENTS,
  scope = currentActorScope(),
): ReplayCacheStore {
  const threads = new Map<string, ReplayCacheEntry>();
  const scopedThreadKey = (threadId: string) =>
    JSON.stringify([scope, threadId]);
  return {
    load(threadId) {
      const entry = threads.get(scopedThreadKey(threadId));
      return Promise.resolve(entry ?? null);
    },
    append(threadId, events, meta) {
      const existing = threads.get(scopedThreadKey(threadId));
      const bySequence = new Map<number, SequencedLoggedEvent>();
      for (const event of existing?.events ?? []) {
        bySequence.set(event.sequence, event);
      }
      for (const event of events) {
        bySequence.set(event.sequence, event);
      }
      const merged = [...bySequence.values()].sort(
        (a, b) => a.sequence - b.sequence,
      );
      const trimmed =
        merged.length > maxEvents
          ? merged.slice(merged.length - maxEvents)
          : merged;
      threads.set(scopedThreadKey(threadId), {
        events: trimmed,
        streamId: meta.streamId,
        cursor: Math.max(
          meta.cursor,
          trimmed[trimmed.length - 1]?.sequence ?? 0,
        ),
        partialFrom: trimmed[0]?.sequence ?? 1,
      });
      return Promise.resolve();
    },
    clear(threadId) {
      threads.delete(scopedThreadKey(threadId));
      return Promise.resolve();
    },
  };
}

// ── IndexedDB implementation ──────────────────────────────────

const DB_NAME = "echo-replay-cache";
// v3 adds the account scope to event/meta keys. It clears the unscoped
// read-through cache once rather than risk hydrating another account's rows.
const DB_VERSION = 3;
const EVENTS_STORE = "events";
const META_STORE = "meta";

// Zero-padded compound key keeps lexical order == sequence order, so the
// capacity trim can delete the oldest prefix with a simple cursor walk.
function scopedThreadKey(scope: string, threadId: string): string {
  return JSON.stringify([scope, threadId]);
}

function eventKey(scope: string, threadId: string, sequence: number): string {
  return `${scopedThreadKey(scope, threadId)}:${String(sequence).padStart(12, "0")}`;
}

function threadRange(scope: string, threadId: string): IDBKeyRange {
  const prefix = `${scopedThreadKey(scope, threadId)}:`;
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, false);
}

interface StoredEventRow {
  key: string;
  threadId: string;
  event: SequencedLoggedEvent;
}

interface StoredMetaRow extends ReplayCacheMeta {
  threadId: string;
  count: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        db.createObjectStore(EVENTS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "threadId" });
      }
      if (event.oldVersion > 0 && event.oldVersion < DB_VERSION) {
        request.transaction?.objectStore(EVENTS_STORE).clear();
        request.transaction?.objectStore(META_STORE).clear();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("indexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("indexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("indexedDB transaction aborted"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("indexedDB request failed"));
  });
}

export function createIndexedDbReplayCache(
  maxEvents = REPLAY_CACHE_MAX_EVENTS,
  scope = currentActorScope(),
): ReplayCacheStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    dbPromise ??= openDb();
    return dbPromise;
  };

  return {
    async load(threadId) {
      const database = await db();
      const tx = database.transaction([EVENTS_STORE, META_STORE], "readonly");
      const scopedKey = scopedThreadKey(scope, threadId);
      const rows = await requestToPromise(
        tx.objectStore(EVENTS_STORE).getAll(threadRange(scope, threadId)),
      );
      const meta = (await requestToPromise(
        tx.objectStore(META_STORE).get(scopedKey),
      )) as StoredMetaRow | undefined;
      await txDone(tx);
      if (!meta || rows.length === 0) return null;
      const events = (rows as StoredEventRow[])
        .map((row) => row.event)
        .sort((a, b) => a.sequence - b.sequence);
      return {
        events,
        streamId: meta.streamId,
        cursor: meta.cursor,
        partialFrom: meta.partialFrom,
      };
    },

    async append(threadId, events, meta) {
      const database = await db();
      const tx = database.transaction([EVENTS_STORE, META_STORE], "readwrite");
      const eventsStore = tx.objectStore(EVENTS_STORE);
      const metaStore = tx.objectStore(META_STORE);
      const scopedKey = scopedThreadKey(scope, threadId);
      for (const event of events) {
        eventsStore.put({
          key: eventKey(scope, threadId, event.sequence),
          threadId,
          event,
        } satisfies StoredEventRow);
      }
      const range = threadRange(scope, threadId);
      const count = await requestToPromise(eventsStore.count(range));
      if (count > maxEvents) {
        // Trim the oldest prefix. Cursor keys sort by padded sequence,
        // so the first (count - maxEvents) entries are the oldest.
        let toDelete = count - maxEvents;
        const oldestKeys: IDBValidKey[] = [];
        await new Promise<void>((resolve, reject) => {
          const cursorRequest = eventsStore.openCursor(range);
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor || toDelete <= 0) {
              resolve();
              return;
            }
            oldestKeys.push(cursor.primaryKey);
            toDelete -= 1;
            cursor.continue();
          };
          cursorRequest.onerror = () =>
            reject(cursorRequest.error ?? new Error("indexedDB cursor failed"));
        });
        for (const key of oldestKeys) {
          eventsStore.delete(key);
        }
      }
      // partialFrom is always derived from the actual oldest key — the
      // zero-padded suffix is the sequence (threadIds may contain ":").
      const firstRemaining = await requestToPromise(eventsStore.getKey(range));
      const partialFrom =
        typeof firstRemaining === "string"
          ? Number(firstRemaining.split(":").pop()) || 1
          : 1;
      const existingMeta = (await requestToPromise(metaStore.get(scopedKey))) as
        | StoredMetaRow
        | undefined;
      const lastSequence = events[events.length - 1]?.sequence ?? 0;
      metaStore.put({
        threadId: scopedKey,
        streamId: meta.streamId,
        cursor: Math.max(meta.cursor, existingMeta?.cursor ?? 0, lastSequence),
        partialFrom,
        count: Math.min(count, maxEvents),
      } satisfies StoredMetaRow);
      await txDone(tx);
    },

    async clear(threadId) {
      const database = await db();
      const tx = database.transaction([EVENTS_STORE, META_STORE], "readwrite");
      tx.objectStore(EVENTS_STORE).delete(threadRange(scope, threadId));
      tx.objectStore(META_STORE).delete(scopedThreadKey(scope, threadId));
      await txDone(tx);
    },
  };
}

/** Erase every persisted thread row owned by one account at sign-out. */
export async function clearReplayCacheForActor(
  scope = currentActorScope(),
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDb();
  const tx = database.transaction([EVENTS_STORE, META_STORE], "readwrite");
  const eventsStore = tx.objectStore(EVENTS_STORE);
  const metaStore = tx.objectStore(META_STORE);
  await new Promise<void>((resolve, reject) => {
    const request = metaStore.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      try {
        const parsed: unknown = JSON.parse(String(cursor.primaryKey));
        if (
          Array.isArray(parsed) &&
          parsed[0] === scope &&
          typeof parsed[1] === "string"
        ) {
          eventsStore.delete(threadRange(scope, parsed[1]));
          cursor.delete();
        }
      } catch {
        // Malformed legacy key: leave it for the version-upgrade sweep.
      }
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error("indexedDB cursor failed"));
  });
  await txDone(tx);
}

/** Default store: IndexedDB where available, in-memory otherwise (tests,
 * SSR, exotic embedders). Failures of the real backend are the caller's
 * signal to fall back — the cache must never break the thread flow. */
export function createDefaultReplayCache(): ReplayCacheStore {
  if (typeof indexedDB !== "undefined") {
    return createIndexedDbReplayCache();
  }
  return createMemoryReplayCache();
}
