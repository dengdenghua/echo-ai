/**
 * Pure tab-strip rules for groups and split view, kept apart from the
 * store so they can be tested directly.
 */

export const TAB_GROUP_COLORS = [
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
  "grey",
] as const;

export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];

export interface BrowserTabGroup {
  id: string;
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
}

/** Two tabs shown side by side; `ratio` is the left pane's share. */
export interface BrowserSplit {
  leftId: string;
  rightId: string;
  ratio: number;
}

type LayoutTab = { id: string; pinned?: boolean; groupId?: string };

export const SPLIT_MIN_RATIO = 0.2;
export const SPLIT_MAX_RATIO = 0.8;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, ratio));
}

/** The least used color, in palette order. */
export function nextGroupColor(groups: BrowserTabGroup[]): TabGroupColor {
  const used = new Map<TabGroupColor, number>();
  for (const group of groups) {
    used.set(group.color, (used.get(group.color) ?? 0) + 1);
  }
  let best: TabGroupColor = TAB_GROUP_COLORS[0];
  for (const color of TAB_GROUP_COLORS) {
    if ((used.get(color) ?? 0) < (used.get(best) ?? 0)) best = color;
  }
  return best;
}

/**
 * Pinned tabs first; each group's tabs side by side at the place of the
 * group's first tab. Order is otherwise kept. Pinned tabs never belong to
 * a group.
 */
export function arrangeTabs<T extends LayoutTab>(tabs: T[]): T[] {
  const clean = tabs.map((tab) =>
    tab.pinned && tab.groupId ? { ...tab, groupId: undefined } : tab,
  );
  const pinned = clean.filter((tab) => tab.pinned);
  const rest = clean.filter((tab) => !tab.pinned);
  const arranged: T[] = [];
  const placed = new Set<string>();
  for (const tab of rest) {
    if (placed.has(tab.id)) continue;
    if (!tab.groupId) {
      arranged.push(tab);
      placed.add(tab.id);
      continue;
    }
    for (const member of rest) {
      if (member.groupId === tab.groupId && !placed.has(member.id)) {
        arranged.push(member);
        placed.add(member.id);
      }
    }
  }
  return [...pinned, ...arranged];
}

/** Groups that still have tabs; tabs lose ids of groups that are gone. */
export function pruneGroups<T extends LayoutTab>(
  tabs: T[],
  groups: BrowserTabGroup[],
): { tabs: T[]; groups: BrowserTabGroup[] } {
  const known = new Set(groups.map((group) => group.id));
  const cleaned = tabs.map((tab) =>
    tab.groupId && !known.has(tab.groupId)
      ? { ...tab, groupId: undefined }
      : tab,
  );
  const used = new Set(cleaned.map((tab) => tab.groupId).filter(Boolean));
  return {
    tabs: cleaned,
    groups: groups.filter((group) => used.has(group.id)),
  };
}

/**
 * Drag a tab from one index to another. Dropped between two tabs of the
 * same group it joins that group; dropped next to its own group it stays;
 * anywhere else it leaves its group.
 */
export function moveTab<T extends LayoutTab>(
  tabs: T[],
  from: number,
  to: number,
): T[] {
  if (from === to) return tabs;
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  if (!moved) return tabs;
  next.splice(to, 0, moved);
  const left = next[to - 1]?.groupId;
  const right = next[to + 1]?.groupId;
  let groupId: string | undefined;
  if (left && left === right) groupId = left;
  else if (moved.groupId && (left === moved.groupId || right === moved.groupId))
    groupId = moved.groupId;
  next[to] = { ...moved, groupId };
  return arrangeTabs(next);
}

/** The split if both of its tabs still exist and differ, else null. */
export function validSplit(
  split: BrowserSplit | null | undefined,
  tabs: LayoutTab[],
): BrowserSplit | null {
  if (!split || split.leftId === split.rightId) return null;
  const ids = new Set(tabs.map((tab) => tab.id));
  if (!ids.has(split.leftId) || !ids.has(split.rightId)) return null;
  return { ...split, ratio: clampSplitRatio(split.ratio) };
}

/** Nearest tab outside a group, looking right first; null if none. */
export function nearestOutsideGroup<T extends LayoutTab>(
  tabs: T[],
  fromId: string,
  groupId: string,
): T | null {
  const index = tabs.findIndex((tab) => tab.id === fromId);
  if (index < 0) return null;
  for (let step = 1; step < tabs.length; step += 1) {
    const right = tabs[index + step];
    if (right && right.groupId !== groupId) return right;
    const left = tabs[index - step];
    if (left && left.groupId !== groupId) return left;
  }
  return null;
}
