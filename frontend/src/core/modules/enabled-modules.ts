/**
 * Which modules the user keeps in their sidebar.
 *
 * Storage is behind a tiny provider seam (`ModuleStateProvider`) so a backend
 * per-user preference endpoint can replace localStorage without touching any
 * caller. There is no such endpoint today — `IdentityStore` is read-only
 * (loaded from YAML, no write path), so cross-device sync is a follow-up.
 *
 * Persisted shape is a *disabled* list, not an enabled one: that way modules
 * added to the catalog in a later release default to visible instead of
 * silently staying hidden for existing users.
 */
import { useSyncExternalStore } from "react";

import {
  defaultEnabledModuleIds,
  moduleById,
  pinnedModuleIds,
} from "./catalog";
import { WORKBENCH_BUILTIN_APPS } from "@/core/workbench/apps";
import { defaultModuleIdsForAgent } from "@/core/workspace/workspace-presets";

export type PersonaModuleOverrides = Record<string, Record<string, boolean>>;

export interface ModuleStateProvider {
  readDisabled(): string[];
  writeDisabled(ids: string[]): void;
  readOverrides?(): PersonaModuleOverrides;
  writeOverrides?(overrides: PersonaModuleOverrides): void;
  /** Last known install state, so the next launch renders it without waiting. */
  readAvailability?(): Record<string, boolean> | null;
  writeAvailability?(availability: Record<string, boolean>): void;
}

const STORAGE_KEY = "echo.modules.disabled";
const OVERRIDES_STORAGE_KEY = "echo.modules.persona-overrides.v1";
const AVAILABILITY_STORAGE_KEY = "echo.modules.availability.v1";

/** Modules delivered as separately installed packages rather than with the shell. */
const INSTALLABLE_MODULE_IDS: ReadonlySet<string> = new Set(
  WORKBENCH_BUILTIN_APPS.filter((app) => app.delivery === "remote").map(
    (app) => app.moduleId,
  ),
);

export function isInstallableModule(id: string): boolean {
  return INSTALLABLE_MODULE_IDS.has(id);
}

const localStorageProvider: ModuleStateProvider = {
  readDisabled() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  },
  writeDisabled(ids) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* private mode / quota — this session only */
    }
  },
  readOverrides() {
    try {
      const raw = window.localStorage.getItem(OVERRIDES_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? (parsed as PersonaModuleOverrides)
        : {};
    } catch {
      return {};
    }
  },
  writeOverrides(overrides) {
    try {
      window.localStorage.setItem(
        OVERRIDES_STORAGE_KEY,
        JSON.stringify(overrides),
      );
    } catch {
      /* private mode / quota — this session only */
    }
  },
  readAvailability() {
    try {
      const raw = window.localStorage.getItem(AVAILABILITY_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, boolean>)
        : null;
    } catch {
      return null;
    }
  },
  writeAvailability(availability) {
    try {
      window.localStorage.setItem(
        AVAILABILITY_STORAGE_KEY,
        JSON.stringify(availability),
      );
    } catch {
      /* private mode / quota — this session only */
    }
  },
};

let provider: ModuleStateProvider = localStorageProvider;

/** Swap the persistence backend (tests, or a future server-backed provider). */
export function setModuleStateProvider(next: ModuleStateProvider): void {
  provider = next;
  cache = null;
  overridesCache = null;
  availabilityHydrated = false;
  snapshots.clear();
  notify();
}

let cache: Set<string> | null = null;
let overridesCache: PersonaModuleOverrides | null = null;
/**
 * Runtime availability is deliberately separate from the user's sidebar
 * preference. `undefined` means the backend has not answered yet; once a
 * module is known to be unavailable, no persona override can resurrect it.
 */
let availabilityCache: ReadonlyMap<string, boolean> | null = null;
let availabilityHydrated = false;
const listeners = new Set<() => void>();

function toAvailabilityMap(
  availability: Readonly<Record<string, unknown>>,
): Map<string, boolean> {
  return new Map(
    Object.entries(availability).filter(
      (entry): entry is [string, boolean] =>
        moduleById(entry[0]) !== undefined && typeof entry[1] === "boolean",
    ),
  );
}

/** Seed install state from the last session once, before the backend answers. */
function hydrateAvailability(): void {
  if (availabilityHydrated) return;
  availabilityHydrated = true;
  if (availabilityCache) return;
  const stored = provider.readAvailability?.();
  if (stored) availabilityCache = toAvailabilityMap(stored);
}

function persistAvailability(): void {
  if (availabilityCache) {
    provider.writeAvailability?.(Object.fromEntries(availabilityCache));
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Pinned modules can never be disabled, whatever storage claims. */
function readDisabledSet(): Set<string> {
  const pinned = new Set(pinnedModuleIds());
  const stored = provider
    .readDisabled()
    // Drop ids that no longer exist so a removed module can't haunt storage.
    .filter((id) => moduleById(id) !== undefined && !pinned.has(id));
  return new Set(stored);
}

function getDisabledSet(): Set<string> {
  if (cache) return cache;
  cache = readDisabledSet();
  return cache;
}

function getOverrides(): PersonaModuleOverrides {
  if (overridesCache) return overridesCache;
  const raw = provider.readOverrides?.() ?? {};
  const cleaned: PersonaModuleOverrides = {};
  for (const [agentId, values] of Object.entries(raw)) {
    if (!values || typeof values !== "object") continue;
    const next: Record<string, boolean> = {};
    for (const [moduleId, enabled] of Object.entries(values)) {
      if (moduleById(moduleId) && typeof enabled === "boolean") {
        next[moduleId] = enabled;
      }
    }
    if (Object.keys(next).length > 0) cleaned[agentId] = next;
  }
  overridesCache = cleaned;
  return overridesCache;
}

export function isModuleEnabled(id: string, agentId?: string | null): boolean {
  return enabledModuleIds(agentId).includes(id);
}

function computeModuleIds(
  agentId?: string | null,
  respectAvailability = true,
): string[] {
  const allIds = defaultEnabledModuleIds();
  const defaults = agentId ? defaultModuleIdsForAgent(allIds, agentId) : allIds;
  const enabled = new Set(defaults);
  const disabled = getDisabledSet();
  for (const id of disabled) enabled.delete(id);

  if (agentId) {
    const personaOverrides = getOverrides()[agentId] ?? {};
    for (const [id, isEnabled] of Object.entries(personaOverrides)) {
      if (isEnabled) enabled.add(id);
      else enabled.delete(id);
    }
  }

  for (const id of pinnedModuleIds()) enabled.add(id);
  hydrateAvailability();
  if (respectAvailability && availabilityCache) {
    for (const [id, available] of availabilityCache) {
      if (!available) enabled.delete(id);
    }
  }
  return allIds.filter((id) => enabled.has(id));
}

export function enabledModuleIds(agentId?: string | null): string[] {
  return computeModuleIds(agentId, true);
}

/** User preference only; unavailable remote apps keep their deep-link error page. */
export function userEnabledModuleIds(agentId?: string | null): string[] {
  return computeModuleIds(agentId, false);
}

/** Replace the server-backed availability snapshot for installable modules. */
export function setModuleAvailabilitySnapshot(
  availability: Readonly<Record<string, boolean>> | null,
): void {
  availabilityHydrated = true;
  availabilityCache = availability ? toAvailabilityMap(availability) : null;
  persistAvailability();
  snapshots.clear();
  notify();
}

/** Update one module after an install/enable/disable/uninstall mutation. */
export function setModuleAvailable(id: string, available: boolean): void {
  if (!moduleById(id)) return;
  hydrateAvailability();
  const next = new Map(availabilityCache ?? []);
  next.set(id, available);
  availabilityCache = next;
  persistAvailability();
  snapshots.clear();
  notify();
}

export function isModuleAvailabilityKnown(): boolean {
  hydrateAvailability();
  return availabilityCache !== null;
}

const NO_MODULE_IDS: readonly string[] = [];
let unavailableSnapshot: readonly string[] = NO_MODULE_IDS;

function getUnavailableSnapshot(): readonly string[] {
  hydrateAvailability();
  const ids = availabilityCache
    ? [...availabilityCache]
        .filter(([, available]) => !available)
        .map(([id]) => id)
        .sort()
    : [];
  if (ids.join("|") !== unavailableSnapshot.join("|")) {
    unavailableSnapshot = ids.length ? ids : NO_MODULE_IDS;
  }
  return unavailableSnapshot;
}

/** Enable/disable one module. Pinned modules are silently ignored. */
export function setModuleEnabled(
  id: string,
  enabled: boolean,
  agentId?: string | null,
): void {
  const descriptor = moduleById(id);
  if (!descriptor || !descriptor.removable) return;

  if (agentId) {
    const current = getOverrides();
    const next: PersonaModuleOverrides = {
      ...current,
      [agentId]: { ...(current[agentId] ?? {}), [id]: enabled },
    };
    overridesCache = next;
    provider.writeOverrides?.(next);
    notify();
    return;
  }

  const next = new Set(getDisabledSet());
  if (enabled) next.delete(id);
  else next.add(id);

  cache = next;
  provider.writeDisabled([...next]);
  notify();
}

function handleStorage(event: StorageEvent): void {
  if (event.key === STORAGE_KEY || event.key === OVERRIDES_STORAGE_KEY) {
    cache = null; // force re-read so other tabs stay consistent
    overridesCache = null;
    notify();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

// Snapshot must be referentially stable — useSyncExternalStore re-renders on
// every changed reference, and a fresh array each call would loop forever.
const snapshots = new Map<string, { key: string; ids: string[] }>();

function getSnapshot(
  agentId?: string | null,
  respectAvailability = true,
): string[] {
  const snapshotId = `${respectAvailability ? "available" : "preference"}:${agentId ?? "__legacy__"}`;
  const ids = computeModuleIds(agentId, respectAvailability);
  const key = ids.join("|");
  const current = snapshots.get(snapshotId);
  if (!current || current.key !== key) {
    snapshots.set(snapshotId, { key, ids });
    return ids;
  }
  return current.ids;
}

/** Subscribe to the enabled-module id list. */
export function useEnabledModuleIds(agentId?: string | null): string[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(agentId),
    () =>
      agentId
        ? defaultModuleIdsForAgent(defaultEnabledModuleIds(), agentId)
        : defaultEnabledModuleIds(),
  );
}

/** Subscribe to user preference without conflating it with install state. */
export function useUserEnabledModuleIds(agentId?: string | null): string[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(agentId, false),
    () =>
      agentId
        ? defaultModuleIdsForAgent(defaultEnabledModuleIds(), agentId)
        : defaultEnabledModuleIds(),
  );
}

/**
 * Whether install state is known (this session or cached from the last one).
 * Until then installable apps stay out of the sidebar, so it never shows an
 * entry only to remove it a moment later.
 */
export function useModuleAvailabilityKnown(): boolean {
  return useSyncExternalStore(subscribe, isModuleAvailabilityKnown, () => false);
}

/** Installable modules known to be missing, for surfaces that offer to install them. */
export function useUnavailableModuleIds(): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    getUnavailableSnapshot,
    () => NO_MODULE_IDS,
  );
}

/** Test seam: drop the memoized state. */
export function resetModuleStateCache(): void {
  cache = null;
  overridesCache = null;
  availabilityCache = null;
  availabilityHydrated = false;
  unavailableSnapshot = NO_MODULE_IDS;
  snapshots.clear();
  notify();
}
