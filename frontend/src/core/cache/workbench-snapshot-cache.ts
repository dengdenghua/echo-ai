/**
 * 工作台快照持久化缓存
 *
 * 使用 IndexedDB 缓存工作台快照，支持：
 * - 页面刷新快速恢复 (<100ms)
 * - 离线查看历史快照
 * - 自动过期清理（5 分钟）
 *
 * 优化目标：
 * - 页面刷新后恢复时间从 2-3s → <100ms
 * - 降低服务器重连压力
 * - 离线场景可查看历史
 *
 * @example
 * const cache = new WorkbenchSnapshotCache();
 *
 * // 保存快照
 * await cache.save(threadId, turnId, snapshot, events);
 *
 * // 加载快照
 * const cached = await cache.load(threadId, turnId);
 * if (cached) {
 *   // 使用缓存的快照
 * }
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AgentWorkbenchSnapshot } from "@/components/workspace/agent-workbench-snapshot";
import { currentActorScope } from "@/core/auth/api";
import type { LiveToolEvent } from "@/components/workspace/live-tool-timeline";

// ============================================================================
// IndexedDB Schema
// ============================================================================

interface WorkbenchCacheDB extends DBSchema {
  snapshots: {
    key: string; // threadId:turnId
    value: {
      scope: string;
      threadId: string;
      turnId: string;
      snapshot: AgentWorkbenchSnapshot;
      events: LiveToolEvent[];
      timestamp: number;
      version: number;
    };
    indexes: {
      "by-thread": string;
      "by-timestamp": number;
    };
  };
}

const DB_NAME = "echo-workbench-cache";
// v2 namespaces snapshots by account and drops the old unscoped rows.
const DB_VERSION = 2;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
// This version covers both the serialized shape and the semantics used to
// derive it. Bump whenever phase/agent normalization changes; an event-only
// fingerprint cannot tell that an older client interpreted the same events
// differently.
const CACHE_VERSION = 2;

function openWorkbenchCacheDb(): Promise<IDBPDatabase<WorkbenchCacheDB>> {
  return openDB<WorkbenchCacheDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      const store = db.objectStoreNames.contains("snapshots")
        ? transaction.objectStore("snapshots")
        : db.createObjectStore("snapshots");
      if (!store.indexNames.contains("by-thread")) {
        store.createIndex("by-thread", "threadId");
      }
      if (!store.indexNames.contains("by-timestamp")) {
        store.createIndex("by-timestamp", "timestamp");
      }
      if (oldVersion > 0 && oldVersion < 2) void store.clear();
    },
  });
}

export function workbenchSnapshotKey(
  scope: string,
  threadId: string,
  turnId: string,
): string {
  return JSON.stringify([scope, threadId, turnId]);
}

/** Remove one account's snapshots without touching another account's rows. */
export async function clearWorkbenchCacheForScope(
  scope = currentActorScope(),
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openWorkbenchCacheDb();
  const tx = db.transaction("snapshots", "readwrite");
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.scope === scope) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

// ============================================================================
// 工作台快照缓存
// ============================================================================

export class WorkbenchSnapshotCache {
  private db: Promise<IDBPDatabase<WorkbenchCacheDB>> | null = null;
  private _enabled: boolean;

  constructor(enabled = true) {
    this._enabled =
      enabled && typeof window !== "undefined" && "indexedDB" in window;
  }

  /**
   * 延迟初始化数据库连接
   */
  private _getDB(): Promise<IDBPDatabase<WorkbenchCacheDB>> {
    if (!this._enabled) {
      return Promise.reject(new Error("IndexedDB not available"));
    }

    if (!this.db) this.db = openWorkbenchCacheDb();

    return this.db;
  }

  /**
   * 保存快照到缓存
   */
  async save(
    threadId: string,
    turnId: string,
    snapshot: AgentWorkbenchSnapshot,
    events: LiveToolEvent[],
  ): Promise<void> {
    if (!this._enabled) return;

    try {
      const db = await this._getDB();
      const scope = currentActorScope();
      const key = this._makeKey(scope, threadId, turnId);

      await db.put(
        "snapshots",
        {
          scope,
          threadId,
          turnId,
          snapshot,
          events,
          timestamp: Date.now(),
          version: CACHE_VERSION,
        },
        key,
      );
    } catch (error) {
      console.warn("[WorkbenchCache] Failed to save snapshot", error);
    }
  }

  /**
   * 从缓存加载快照
   */
  async load(
    threadId: string,
    turnId: string,
  ): Promise<{
    snapshot: AgentWorkbenchSnapshot;
    events: LiveToolEvent[];
  } | null> {
    if (!this._enabled) return null;

    try {
      const db = await this._getDB();
      const scope = currentActorScope();
      const key = this._makeKey(scope, threadId, turnId);
      const cached = await db.get("snapshots", key);

      if (!cached || cached.scope !== scope) return null;

      // 检查版本兼容性
      if (cached.version !== CACHE_VERSION) {
        await db.delete("snapshots", key);
        return null;
      }

      // 检查是否过期
      const age = Date.now() - cached.timestamp;
      if (age > CACHE_TTL_MS) {
        await db.delete("snapshots", key);
        return null;
      }

      return {
        snapshot: cached.snapshot,
        events: cached.events,
      };
    } catch (error) {
      console.warn("[WorkbenchCache] Failed to load snapshot", error);
      return null;
    }
  }

  /**
   * 清除线程的所有缓存
   */
  async clearThread(threadId: string): Promise<void> {
    if (!this._enabled) return;

    try {
      const db = await this._getDB();
      const scope = currentActorScope();
      const keys = await db.getAllKeysFromIndex(
        "snapshots",
        "by-thread",
        threadId,
      );
      const rows = await Promise.all(keys.map((key) => db.get("snapshots", key)));
      const ownedKeys = keys.filter((_, index) => rows[index]?.scope === scope);

      const tx = db.transaction("snapshots", "readwrite");
      await Promise.all([
        ...ownedKeys.map((key) => tx.store.delete(key)),
        tx.done,
      ]);
    } catch (error) {
      console.warn("[WorkbenchCache] Failed to clear thread", error);
    }
  }

  /**
   * 清除过期的缓存
   */
  async clearExpired(): Promise<number> {
    if (!this._enabled) return 0;

    try {
      const db = await this._getDB();
      const threshold = Date.now() - CACHE_TTL_MS;

      const tx = db.transaction("snapshots", "readwrite");
      const index = tx.store.index("by-timestamp");

      let deletedCount = 0;
      let cursor = await index.openCursor(IDBKeyRange.upperBound(threshold));

      while (cursor) {
        await cursor.delete();
        deletedCount++;
        cursor = await cursor.continue();
      }

      await tx.done;
      return deletedCount;
    } catch (error) {
      console.warn("[WorkbenchCache] Failed to clear expired", error);
      return 0;
    }
  }

  /**
   * 获取缓存统计
   */
  async getStats(): Promise<{
    totalCount: number;
    totalSizeBytes: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  }> {
    if (!this._enabled) {
      return {
        totalCount: 0,
        totalSizeBytes: 0,
        oldestTimestamp: null,
        newestTimestamp: null,
      };
    }

    try {
      const db = await this._getDB();
      const all = await db.getAll("snapshots");

      const totalCount = all.length;
      const totalSizeBytes = JSON.stringify(all).length;
      const timestamps = all
        .map((item) => item.timestamp)
        .sort((a, b) => a - b);

      return {
        totalCount,
        totalSizeBytes,
        oldestTimestamp: timestamps[0] ?? null,
        newestTimestamp: timestamps[timestamps.length - 1] ?? null,
      };
    } catch (error) {
      console.warn("[WorkbenchCache] Failed to get stats", error);
      return {
        totalCount: 0,
        totalSizeBytes: 0,
        oldestTimestamp: null,
        newestTimestamp: null,
      };
    }
  }

  /**
   * 清除所有缓存
   */
  async clearAll(): Promise<void> {
    if (!this._enabled) return;

    try {
      const db = await this._getDB();
      await db.clear("snapshots");
    } catch (error) {
      console.warn("[WorkbenchCache] Failed to clear all", error);
    }
  }

  /**
   * 生成缓存键
   */
  private _makeKey(
    scope: string,
    threadId: string,
    turnId: string,
  ): string {
    return workbenchSnapshotKey(scope, threadId, turnId);
  }
}

/**
 * 全局单例实例
 */
export const globalWorkbenchCache = new WorkbenchSnapshotCache();

/**
 * React Hook: 使用持久化缓存的快照
 */
import { useState, useEffect, useRef } from "react";
import type { AgentWorkbenchSnapshotOptions } from "@/components/workspace/agent-workbench-snapshot";
import { buildAgentWorkbenchSnapshot } from "@/components/workspace/agent-workbench-snapshot";

export function useCachedWorkbenchSnapshot(
  threadId: string,
  turnId: string,
  events: LiveToolEvent[],
  options: AgentWorkbenchSnapshotOptions,
): {
  snapshot: AgentWorkbenchSnapshot | null;
  isLoadingFromCache: boolean;
} {
  const cache = useRef(globalWorkbenchCache);
  const [cachedSnapshot, setCachedSnapshot] =
    useState<AgentWorkbenchSnapshot | null>(null);
  const [isLoadingFromCache, setIsLoadingFromCache] = useState(true);

  // 尝试从缓存加载
  useEffect(() => {
    let cancelled = false;

    void cache.current.load(threadId, turnId).then((cached) => {
      if (cancelled) return;

      if (cached) {
        setCachedSnapshot(cached.snapshot);
      }
      setIsLoadingFromCache(false);
    });

    return () => {
      cancelled = true;
    };
  }, [threadId, turnId]);

  // 计算最新快照
  const computedSnapshot = buildAgentWorkbenchSnapshot(events, options);

  // 保存到缓存
  useEffect(() => {
    if (computedSnapshot && !isLoadingFromCache) {
      void cache.current.save(threadId, turnId, computedSnapshot, events);
    }
  }, [threadId, turnId, computedSnapshot, events, isLoadingFromCache]);

  // 返回缓存快照或计算快照
  const snapshot = cachedSnapshot ?? computedSnapshot;

  return { snapshot, isLoadingFromCache };
}

/**
 * React Hook: 定期清理过期缓存
 */
export function useWorkbenchCacheCleanup(intervalMs = 60_000) {
  const cache = useRef(globalWorkbenchCache);

  useEffect(() => {
    const timer = setInterval(() => {
      // clearExpired never rejects — it catches and warns internally — so the
      // count is only of interest to a debugger, not to the running app.
      void cache.current.clearExpired();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs]);
}
