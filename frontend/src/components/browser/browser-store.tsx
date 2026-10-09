/* Implementation note. */

import { swallow } from "@/core/utils/log";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";

import type { BrowserNavigationEntry } from "@/types/electron";

import type { DevicePreset } from "../workspace/embedded-browser/browser-context";

import {
  arrangeTabs,
  clampSplitRatio,
  moveTab,
  nearestOutsideGroup,
  nextGroupColor,
  pruneGroups,
  validSplit,
  type BrowserSplit,
  type BrowserTabGroup,
} from "./tab-layout";

export type {
  BrowserSplit,
  BrowserTabGroup,
  TabGroupColor,
} from "./tab-layout";

const STORAGE_KEY = "echo:browser-state";
const HISTORY_KEY = "echo:browser-history";
const BOOKMARKS_KEY = "echo:browser-bookmarks";
const SETTINGS_KEY = "echo:browser-settings";
export const BROWSER_OPEN_URL_REQUEST_KEY = "echo:browser-open-url-request";
export const BROWSER_OPEN_URL_REQUEST_EVENT = "echo:browser-open-url-request";
export const BROWSER_OPEN_URL_ACK_EVENT = "echo:browser-open-url-ack";
export const BROWSER_EDIT_HOME_EVENT = "echo:browser-edit-home";
export const BROWSER_HOME_URL = "echo://home";
const LEGACY_DEFAULT_HOMEPAGE = "https://www.google.com";
const DEFAULT_HOMEPAGE = BROWSER_HOME_URL;

export interface BrowserSettings {
  homepage: string;
  searchEngine: "google" | "bing" | "baidu" | "duckduckgo";
  /** Bookmarks bar under the address bar (Ctrl+Shift+B). */
  showBookmarksBar: boolean;
}

const DEFAULT_SETTINGS: BrowserSettings = {
  homepage: DEFAULT_HOMEPAGE,
  searchEngine: "google",
  showBookmarksBar: true,
};

export const SEARCH_ENGINE_URLS: Record<
  BrowserSettings["searchEngine"],
  string
> = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  baidu: "https://www.baidu.com/s?wd=",
  duckduckgo: "https://duckduckgo.com/?q=",
};

function loadSettings(): BrowserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const next = { ...DEFAULT_SETTINGS, ...parsed };
    if (next.homepage === LEGACY_DEFAULT_HOMEPAGE) {
      next.homepage = BROWSER_HOME_URL;
    }
    return next;
  } catch (e) {
    swallow(e);
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: BrowserSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {
    swallow(e, "storage");
  }
}
const MAX_HISTORY = 500;
const MAX_BOOKMARKS = 200;
const MAX_CLOSED_TABS = 20;

export interface HistoryEntry {
  url: string;
  title: string;
  favicon?: string;
  visitedAt: number;
}

export interface Bookmark {
  url: string;
  title: string;
  favicon?: string;
  addedAt: number;
}

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    swallow(e);
    return [];
  }
}

function saveHistory(items: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(items.slice(0, MAX_HISTORY)),
    );
  } catch (e) {
    swallow(e, "storage");
  }
}

function loadBookmarks(): Bookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    swallow(e);
    return [];
  }
}

function saveBookmarks(items: Bookmark[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      BOOKMARKS_KEY,
      JSON.stringify(items.slice(0, MAX_BOOKMARKS)),
    );
  } catch (e) {
    swallow(e, "storage");
  }
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  device: DevicePreset;
  /** Private tab: separate in-memory session, no history (desktop app). */
  private?: boolean;
  /** Pinned tabs stay first and cannot be closed by accident. */
  pinned?: boolean;
  /** Tab group this tab belongs to (see BrowserState.groups). */
  groupId?: string;
  /** Back / forward history, restored after a restart (desktop app). */
  navHistory?: { entries: BrowserNavigationEntry[]; index: number };
  taskPreview?: {
    threadId: string;
    workspacePath?: string | null;
    sessionId: string;
    returnRoute?: string;
  };
  crash?: {
    reason: string;
    exitCode: number;
    occurredAt: number;
    attempts: number;
    autoRecovering?: boolean;
  };
}

export interface ClosedBrowserTab extends BrowserTab {
  closedAt: number;
}

export interface BrowserOpenUrlRequest {
  url: string;
  requestId?: string;
  title?: string;
  device?: DevicePreset;
  source?: string;
  sessionId?: string;
  taskPreview?: BrowserTab["taskPreview"];
}

export interface BrowserOpenUrlAck {
  requestId: string;
  accepted: boolean;
}

export interface BrowserState {
  tabs: BrowserTab[];
  closedTabs: ClosedBrowserTab[];
  activeId: string | null;
  groups: BrowserTabGroup[];
  split: BrowserSplit | null;
  copilotOpen: boolean;
  copilotWidth: number;
  homeSeeded?: boolean;
}

type Action =
  | { type: "OPEN_TAB"; url?: string; patch?: Partial<BrowserTab> }
  | { type: "CLOSE_TAB"; id: string }
  | { type: "ACTIVATE_TAB"; id: string }
  | { type: "REORDER_TAB"; from: number; to: number }
  | { type: "PATCH_TAB"; id: string; patch: Partial<BrowserTab> }
  | { type: "SET_PINNED"; id: string; pinned: boolean }
  | { type: "ADD_TO_GROUP"; id: string; groupId?: string; newGroupId?: string }
  | { type: "REMOVE_FROM_GROUP"; id: string }
  | {
      type: "UPDATE_GROUP";
      groupId: string;
      patch: Partial<Omit<BrowserTabGroup, "id">>;
    }
  | { type: "UNGROUP"; groupId: string }
  | { type: "CLOSE_GROUP"; groupId: string }
  | { type: "SET_SPLIT"; split: BrowserSplit | null }
  | { type: "SET_COPILOT_OPEN"; open: boolean }
  | { type: "SET_COPILOT_WIDTH"; width: number }
  | { type: "RESTORE_CLOSED_TAB"; id?: string };

function genGroupId(): string {
  return `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function genId(): string {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function freshTab(url?: string, homepage?: string): BrowserTab {
  const target = url ?? homepage ?? DEFAULT_HOMEPAGE;
  return {
    id: genId(),
    url: target,
    title: target === BROWSER_HOME_URL ? "AI 浏览器桌面" : target,
    isLoading: false,
    device: "desktop",
  };
}

export type BrowserAction = Action;

/** Group order, empty groups and a stale split are fixed after every step. */
export function browserReducer(
  state: BrowserState,
  action: Action,
): BrowserState {
  const next = reduce(state, action);
  if (next === state) return next;
  const pruned = pruneGroups(arrangeTabs(next.tabs), next.groups);
  return {
    ...next,
    tabs: pruned.tabs,
    groups: pruned.groups,
    split: validSplit(next.split, pruned.tabs),
  };
}

function closeIntoHistory(state: BrowserState, ids: Set<string>): BrowserState {
  const closing = state.tabs.filter((t) => ids.has(t.id));
  if (closing.length === 0) return state;
  const remaining = state.tabs.filter((t) => !ids.has(t.id));
  const closedTabs: ClosedBrowserTab[] = [
    ...closing.map((tab) => ({
      ...tab,
      isLoading: false,
      closedAt: Date.now(),
    })),
    ...state.closedTabs.filter((tab) => !ids.has(tab.id)),
  ].slice(0, MAX_CLOSED_TABS);
  if (remaining.length === 0) {
    const tab = freshTab();
    return { ...state, tabs: [tab], closedTabs, activeId: tab.id };
  }
  let activeId = state.activeId;
  if (activeId && ids.has(activeId)) {
    const index = state.tabs.findIndex((t) => t.id === activeId);
    const after = state.tabs.slice(index + 1).find((t) => !ids.has(t.id));
    const before = state.tabs
      .slice(0, index)
      .reverse()
      .find((t) => !ids.has(t.id));
    activeId = (after ?? before ?? remaining[0])!.id;
  }
  return { ...state, tabs: remaining, closedTabs, activeId };
}

function reduce(state: BrowserState, action: Action): BrowserState {
  switch (action.type) {
    case "OPEN_TAB": {
      const sessionId = action.patch?.taskPreview?.sessionId;
      const existing = sessionId
        ? state.tabs.find((tab) => tab.taskPreview?.sessionId === sessionId)
        : undefined;
      if (existing) {
        return { ...state, activeId: existing.id };
      }
      // Implementation note.
      // Implementation note.
      // Implementation note.
      // Implementation note.
      const tab = { ...freshTab(action.url), ...action.patch };
      return { ...state, tabs: [...state.tabs, tab], activeId: tab.id };
    }
    case "CLOSE_TAB":
      return closeIntoHistory(state, new Set([action.id]));
    case "ACTIVATE_TAB": {
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab) return state;
      return {
        ...state,
        activeId: action.id,
        groups: state.groups.map((group) =>
          group.id === tab.groupId && group.collapsed
            ? { ...group, collapsed: false }
            : group,
        ),
      };
    }
    case "REORDER_TAB": {
      if (action.from === action.to) return state;
      return { ...state, tabs: moveTab(state.tabs, action.from, action.to) };
    }
    case "PATCH_TAB": {
      const tabs = state.tabs.map((t) =>
        t.id === action.id ? { ...t, ...action.patch } : t,
      );
      return { ...state, tabs };
    }
    case "SET_PINNED":
      // arrangeTabs puts pinned tabs first and takes them out of groups.
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, pinned: action.pinned } : t,
        ),
      };
    case "ADD_TO_GROUP": {
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab || tab.url === BROWSER_HOME_URL) return state;
      let groups = state.groups;
      let groupId = action.groupId;
      if (!groupId || !groups.some((g) => g.id === groupId)) {
        groupId = action.newGroupId ?? genGroupId();
        groups = [
          ...groups,
          {
            id: groupId,
            title: "",
            color: nextGroupColor(groups),
            collapsed: false,
          },
        ];
      }
      // Join at the end of the group.
      const others = state.tabs.filter((t) => t.id !== tab.id);
      const lastIndex = others.reduce(
        (last, t, index) => (t.groupId === groupId ? index : last),
        -1,
      );
      const moved = { ...tab, groupId, pinned: false };
      const tabs =
        lastIndex < 0
          ? state.tabs.map((t) => (t.id === tab.id ? moved : t))
          : [
              ...others.slice(0, lastIndex + 1),
              moved,
              ...others.slice(lastIndex + 1),
            ];
      return {
        ...state,
        tabs,
        groups: groups.map((g) =>
          g.id === groupId ? { ...g, collapsed: false } : g,
        ),
      };
    }
    case "REMOVE_FROM_GROUP": {
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab?.groupId) return state;
      // Leave right after the group's last tab.
      const others = state.tabs.filter((t) => t.id !== tab.id);
      const lastIndex = others.reduce(
        (last, t, index) => (t.groupId === tab.groupId ? index : last),
        -1,
      );
      const moved = { ...tab, groupId: undefined };
      return {
        ...state,
        tabs: [
          ...others.slice(0, lastIndex + 1),
          moved,
          ...others.slice(lastIndex + 1),
        ],
      };
    }
    case "UPDATE_GROUP": {
      const group = state.groups.find((g) => g.id === action.groupId);
      if (!group) return state;
      const patch = { ...action.patch };
      let activeId = state.activeId;
      const active = state.tabs.find((t) => t.id === activeId);
      if (patch.collapsed && active?.groupId === group.id) {
        // Chrome-style: collapsing moves focus out of the group; with no
        // tab outside it, the group stays open.
        const outside = nearestOutsideGroup(state.tabs, active.id, group.id);
        if (outside) activeId = outside.id;
        else patch.collapsed = false;
      }
      return {
        ...state,
        activeId,
        groups: state.groups.map((g) =>
          g.id === group.id ? { ...g, ...patch, id: g.id } : g,
        ),
      };
    }
    case "UNGROUP":
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.groupId === action.groupId ? { ...t, groupId: undefined } : t,
        ),
      };
    case "CLOSE_GROUP":
      return closeIntoHistory(
        state,
        new Set(
          state.tabs
            .filter((t) => t.groupId === action.groupId)
            .map((t) => t.id),
        ),
      );
    case "SET_SPLIT": {
      if (!action.split) return { ...state, split: null };
      const split = validSplit(action.split, state.tabs);
      if (!split) return state;
      const focused =
        state.activeId === split.leftId || state.activeId === split.rightId;
      return {
        ...state,
        split,
        activeId: focused ? state.activeId : split.leftId,
      };
    }
    case "SET_COPILOT_OPEN":
      return { ...state, copilotOpen: action.open };
    case "SET_COPILOT_WIDTH":
      return {
        ...state,
        copilotWidth: Math.max(280, Math.min(720, action.width)),
      };
    case "RESTORE_CLOSED_TAB": {
      const index = action.id
        ? state.closedTabs.findIndex((tab) => tab.id === action.id)
        : 0;
      if (index < 0) return state;
      const closed = state.closedTabs[index];
      const remaining = state.closedTabs.filter(
        (_, itemIndex) => itemIndex !== index,
      );
      if (!closed) return state;
      const restored: BrowserTab = {
        ...closed,
        id: genId(),
        isLoading: false,
        crash: undefined,
        groupId: state.groups.some((g) => g.id === closed.groupId)
          ? closed.groupId
          : undefined,
      };
      return {
        ...state,
        tabs: [...state.tabs, restored],
        closedTabs: remaining,
        activeId: restored.id,
      };
    }
    default:
      return state;
  }
}

/** What survives a restart: private tabs (and their history) never do. */
export function persistableState(state: BrowserState): BrowserState {
  const tabs = state.tabs.filter((t) => !t.private);
  const layout = pruneGroups(tabs, state.groups);
  return {
    ...state,
    tabs: layout.tabs,
    groups: layout.groups,
    closedTabs: state.closedTabs.filter((t) => !t.private),
    activeId: tabs.some((t) => t.id === state.activeId)
      ? state.activeId
      : (tabs[0]?.id ?? null),
    split: validSplit(state.split, tabs),
  };
}

export function loadInitial(): BrowserState {
  if (typeof window === "undefined") {
    return {
      tabs: [],
      closedTabs: [],
      activeId: null,
      groups: [],
      split: null,
      copilotOpen: false,
      copilotWidth: 380,
      homeSeeded: true,
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BrowserState>;
      const tabs = Array.isArray(parsed.tabs)
        ? parsed.tabs
            .filter(
              (t): t is BrowserTab =>
                !!t && typeof (t as BrowserTab).id === "string",
            )
            .map((t) => ({ ...t, isLoading: false }))
        : [];
      if (tabs.length === 0) tabs.push(freshTab());
      const closedTabs = Array.isArray(parsed.closedTabs)
        ? parsed.closedTabs
            .filter(
              (tab): tab is ClosedBrowserTab =>
                !!tab &&
                typeof (tab as ClosedBrowserTab).id === "string" &&
                typeof (tab as ClosedBrowserTab).closedAt === "number",
            )
            .slice(0, MAX_CLOSED_TABS)
        : [];
      const activeId =
        typeof parsed.activeId === "string" &&
        tabs.some((t) => t.id === parsed.activeId)
          ? parsed.activeId
          : (tabs[0]?.id ?? null);
      const layout = pruneGroups(
        arrangeTabs(tabs),
        Array.isArray(parsed.groups)
          ? parsed.groups.filter(
              (g): g is BrowserTabGroup =>
                !!g && typeof (g as BrowserTabGroup).id === "string",
            )
          : [],
      );
      tabs.splice(0, tabs.length, ...layout.tabs);
      const groups = layout.groups;
      const split = validSplit(parsed.split, tabs);
      if (
        parsed.homeSeeded !== true &&
        !tabs.some((t) => t.url === BROWSER_HOME_URL)
      ) {
        const home = freshTab(BROWSER_HOME_URL);
        return {
          tabs: [home, ...tabs],
          closedTabs,
          activeId: home.id,
          groups,
          split,
          copilotOpen: !!parsed.copilotOpen,
          copilotWidth:
            typeof parsed.copilotWidth === "number" ? parsed.copilotWidth : 380,
          homeSeeded: true,
        };
      }
      return {
        tabs,
        closedTabs,
        activeId,
        groups,
        split,
        copilotOpen: !!parsed.copilotOpen,
        copilotWidth:
          typeof parsed.copilotWidth === "number" ? parsed.copilotWidth : 380,
        homeSeeded: true,
      };
    }
  } catch (e) {
    swallow(e);
  }
  const tab = freshTab();
  return {
    tabs: [tab],
    closedTabs: [],
    activeId: tab.id,
    groups: [],
    split: null,
    copilotOpen: false,
    copilotWidth: 380,
    homeSeeded: true,
  };
}

interface BrowserStoreContextType {
  state: BrowserState;
  activeTab: BrowserTab | null;
  openTab: (url?: string, patch?: Partial<BrowserTab>) => void;
  closeTab: (id: string) => void;
  restoreClosedTab: (id?: string) => void;
  activateTab: (id: string) => void;
  reorderTab: (from: number, to: number) => void;
  patchTab: (id: string, patch: Partial<BrowserTab>) => void;
  setTabPinned: (id: string, pinned: boolean) => void;
  /** Into an existing group, or a new one when groupId is omitted. */
  addTabToGroup: (id: string, groupId?: string) => void;
  removeTabFromGroup: (id: string) => void;
  updateGroup: (
    groupId: string,
    patch: Partial<Omit<BrowserTabGroup, "id">>,
  ) => void;
  ungroup: (groupId: string) => void;
  closeGroup: (groupId: string) => void;
  /** Show two tabs side by side (desktop app); null ends the split. */
  setSplit: (
    split: { leftId: string; rightId: string; ratio?: number } | null,
  ) => void;
  setCopilotOpen: (open: boolean) => void;
  toggleCopilot: () => void;
  setCopilotWidth: (w: number) => void;
  // Implementation note.
  // Implementation note.
  // Implementation note.
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  recordVisit: (entry: Omit<HistoryEntry, "visitedAt">) => void;
  addBookmark: (b: Omit<Bookmark, "addedAt">) => void;
  removeBookmark: (url: string) => void;
  isBookmarked: (url: string) => boolean;
  clearHistory: () => void;
  settings: BrowserSettings;
  updateSettings: (patch: Partial<BrowserSettings>) => void;
}

const BrowserStoreContext = createContext<BrowserStoreContextType | null>(null);

export function BrowserStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(browserReducer, undefined, loadInitial);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks());
  const [settings, setSettings] = useState<BrowserSettings>(() =>
    loadSettings(),
  );

  const updateSettings = useCallback((patch: Partial<BrowserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  // Implementation note.
  const [, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  // Implementation note.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(persistableState(state)),
        );
      } catch (e) {
        swallow(e, "storage");
      }
    }, 200);
    return () => clearTimeout(t);
  }, [state]);

  const recordVisit = useCallback((entry: Omit<HistoryEntry, "visitedAt">) => {
    if (!entry.url || entry.url.startsWith("about:")) return;
    setHistory((prev) => {
      // Implementation note.
      const next: HistoryEntry[] = [
        { ...entry, visitedAt: Date.now() },
        ...prev.filter((h) => h.url !== entry.url),
      ].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }, []);

  const addBookmark = useCallback((b: Omit<Bookmark, "addedAt">) => {
    if (!b.url) return;
    setBookmarks((prev) => {
      if (prev.some((x) => x.url === b.url)) return prev;
      const next: Bookmark[] = [{ ...b, addedAt: Date.now() }, ...prev].slice(
        0,
        MAX_BOOKMARKS,
      );
      saveBookmarks(next);
      return next;
    });
  }, []);

  const removeBookmark = useCallback((url: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((x) => x.url !== url);
      saveBookmarks(next);
      return next;
    });
  }, []);

  const isBookmarked = useCallback(
    (url: string) => bookmarks.some((x) => x.url === url),
    [bookmarks],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeId) ?? null,
    [state.tabs, state.activeId],
  );

  const value = useMemo<BrowserStoreContextType>(
    () => ({
      state,
      activeTab,
      openTab: (url?: string, patch?: Partial<BrowserTab>) =>
        dispatch({ type: "OPEN_TAB", url: url ?? settings.homepage, patch }),
      closeTab: (id: string) => dispatch({ type: "CLOSE_TAB", id }),
      restoreClosedTab: (id?: string) =>
        dispatch({ type: "RESTORE_CLOSED_TAB", id }),
      activateTab: (id: string) => dispatch({ type: "ACTIVATE_TAB", id }),
      reorderTab: (from: number, to: number) =>
        dispatch({ type: "REORDER_TAB", from, to }),
      patchTab: (id: string, patch: Partial<BrowserTab>) =>
        dispatch({ type: "PATCH_TAB", id, patch }),
      setTabPinned: (id: string, pinned: boolean) =>
        dispatch({ type: "SET_PINNED", id, pinned }),
      addTabToGroup: (id: string, groupId?: string) =>
        dispatch({ type: "ADD_TO_GROUP", id, groupId }),
      removeTabFromGroup: (id: string) =>
        dispatch({ type: "REMOVE_FROM_GROUP", id }),
      updateGroup: (groupId, patch) =>
        dispatch({ type: "UPDATE_GROUP", groupId, patch }),
      ungroup: (groupId: string) => dispatch({ type: "UNGROUP", groupId }),
      closeGroup: (groupId: string) =>
        dispatch({ type: "CLOSE_GROUP", groupId }),
      setSplit: (split) =>
        dispatch({
          type: "SET_SPLIT",
          split: split
            ? { ...split, ratio: clampSplitRatio(split.ratio ?? 0.5) }
            : null,
        }),
      setCopilotOpen: (open: boolean) =>
        dispatch({ type: "SET_COPILOT_OPEN", open }),
      toggleCopilot: () =>
        dispatch({ type: "SET_COPILOT_OPEN", open: !state.copilotOpen }),
      setCopilotWidth: (w: number) =>
        dispatch({ type: "SET_COPILOT_WIDTH", width: w }),
      history,
      bookmarks,
      recordVisit,
      addBookmark,
      removeBookmark,
      isBookmarked,
      clearHistory,
      settings,
      updateSettings,
    }),
    [
      state,
      activeTab,
      history,
      bookmarks,
      recordVisit,
      addBookmark,
      removeBookmark,
      isBookmarked,
      clearHistory,
      settings,
      updateSettings,
    ],
  );

  return (
    <BrowserStoreContext.Provider value={value}>
      {children}
    </BrowserStoreContext.Provider>
  );
}

export function useBrowserStore(): BrowserStoreContextType {
  const ctx = useContext(BrowserStoreContext);
  if (!ctx)
    throw new Error("useBrowserStore must be used within BrowserStoreProvider");
  return ctx;
}

// Implementation note.
const MODE_KEY = "echo:app-mode";
export type AppMode = "workspace" | "browser";

export function getInitialAppMode(): AppMode {
  if (typeof window === "undefined") return "workspace";
  const v = localStorage.getItem(MODE_KEY);
  return v === "browser" ? "browser" : "workspace";
}

export function setAppMode(mode: AppMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MODE_KEY, mode);
}

// Implementation note.
export function useAppMode(): [AppMode, (mode: AppMode) => void] {
  const [mode, setLocal] = useState<AppMode>(() => getInitialAppMode());
  const set = useCallback((next: AppMode) => {
    setLocal(next);
    setAppMode(next);
  }, []);
  return [mode, set];
}
