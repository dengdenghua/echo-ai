import type { components } from "@/core/api/openapi-types";
import { swallow } from "@/core/utils/log";
import { basename, joinPath } from "@/lib/path-utils";

export type FsTreeEntry = components["schemas"]["FsTreeEntry"];
const RECENT_WORKDIRS_KEY = "echo:recentWorkdirs";
export const MAX_RECENT_WORKDIRS = 6;

export function readRecentWorkdirs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_WORKDIRS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? dedupePaths(
          parsed.filter(
            (item): item is string =>
              typeof item === "string" && item.trim().length > 0,
          ),
        )
      : [];
  } catch (e) {
    swallow(e);
    return [];
  }
}

export function writeRecentWorkdirs(paths: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    RECENT_WORKDIRS_KEY,
    JSON.stringify(dedupePaths(paths).slice(0, MAX_RECENT_WORKDIRS)),
  );
}

export function normalizePathKey(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return (normalized || path.trim()).toLowerCase();
}

export function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = normalizePathKey(path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dedupeDirEntries(entries: FsTreeEntry[]): FsTreeEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = normalizePathKey(entry.path || entry.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parentDir(path: string): string | null {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  if (parts.length <= 1) return null;
  if (parts.length === 2 && /^[A-Za-z]:$/.test(parts[0] || "")) {
    return `${parts[0]}/`;
  }
  parts.pop();
  return parts.join("/");
}

// Stable hash → palette index. Same folder name always lands on the
// same color across reloads, so the avatar tiles act as a visual id.
const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: "bg-destructive/15", fg: "text-destructive" },
  { bg: "bg-warning/15", fg: "text-warning" },
  { bg: "bg-success/15", fg: "text-success" },
  { bg: "bg-info/15", fg: "text-info dark:text-info" },
  { bg: "bg-chart-1/15", fg: "text-chart-1 dark:text-chart-1" },
  { bg: "bg-chart-3/15", fg: "text-chart-3 dark:text-chart-3" },
];

export function avatarTile(path: string): {
  bg: string;
  fg: string;
  letter: string;
} {
  const name = basename(path) || path;
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const palette = AVATAR_PALETTE[h % AVATAR_PALETTE.length]!;
  return { ...palette, letter: (name[0] || "?").toUpperCase() };
}

export function browseEntryPath(base: string, entryPath: string): string {
  return base ? joinPath(base, entryPath) : entryPath;
}

export function entryDisplayName(entry: FsTreeEntry): string {
  const fromPath = basename(entry.path.replace(/[\\/]+$/, ""));
  return fromPath || entry.name || entry.path;
}
