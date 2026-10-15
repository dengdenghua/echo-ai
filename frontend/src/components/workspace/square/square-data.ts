/**
 * 广场 helpers shared by ECHO AI and ECHO OS: topic keys, number and time
 * formatting, the last-synced feed cache, and the drafts an older desktop
 * build kept on this device. No sample content lives here: what the Square
 * returns is what the desktop shows.
 */

import type {
  SquareFeed,
  SquareMarketItem,
  SquarePost,
  SquareTopicKey,
} from "./square-types";

export const SQUARE_TOPICS: readonly SquareTopicKey[] = [
  "recommend",
  "automation",
  "efficiency",
  "life",
  "learning",
  "device",
];

export const FEED_PAGE_SIZE = 20;

export function isSquareTopic(value: string): value is SquareTopicKey {
  return SQUARE_TOPICS.some((topic) => topic === value);
}

export function isMiniAppPost(post: SquarePost): boolean {
  return post.kind === "mini-app" || post.app_kind === "mini-app";
}

/** Images to show for a post: its gallery, else its cover. */
export function postImages(post: SquarePost): string[] {
  if (post.images.length > 0) return post.images;
  return post.cover_url ? [post.cover_url] : [];
}

/** One line of body text for a card: whitespace collapsed. */
export function excerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function formatCount(value: number, locale: string): string {
  if (value < 1000) return String(value);
  try {
    return new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(value);
  }
}

const TIME_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
];

export function relativeTime(
  epochMillis: number,
  locale: string,
  now = Date.now(),
): string {
  if (!epochMillis) return "";
  const elapsed = epochMillis - now;
  try {
    const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    for (const [unit, size] of TIME_UNITS) {
      if (Math.abs(elapsed) >= size) {
        return format.format(Math.round(elapsed / size), unit);
      }
    }
    return format.format(0, "minute");
  } catch {
    return new Date(epochMillis).toLocaleDateString();
  }
}

/** Skills and plugins the desktop can use: no platform list, or one that names the desktop. */
export function fitsDesktop(item: SquareMarketItem): boolean {
  return item.platforms.length === 0 || item.platforms.includes("desktop");
}

export function marketCategories(items: SquareMarketItem[]): string[] {
  return Array.from(
    new Set(items.map((item) => item.category).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ */
/* Last synced feed: shown, and labelled as such, when the Square is   */
/* unreachable — the phone does the same.                              */
/* ------------------------------------------------------------------ */

const FEED_CACHE_PREFIX = "echo.square.feed.v1";

function cacheKey(topic: SquareTopicKey, sort: string): string {
  return `${FEED_CACHE_PREFIX}:${topic}:${sort}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPostArray(value: unknown): value is SquarePost[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        Array.isArray(item.images),
    )
  );
}

export function readCachedFeed(
  topic: SquareTopicKey,
  sort: string,
): SquareFeed | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(topic, sort));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const posts = isRecord(parsed) ? parsed.posts : undefined;
    return isPostArray(posts) && posts.length > 0
      ? { posts, has_more: false }
      : null;
  } catch {
    return null;
  }
}

export function writeCachedFeed(
  topic: SquareTopicKey,
  sort: string,
  feed: SquareFeed,
): void {
  if (feed.posts.length === 0) return;
  try {
    window.localStorage.setItem(
      cacheKey(topic, sort),
      JSON.stringify({ posts: feed.posts }),
    );
  } catch {
    // Storage full or disabled: the cache is a convenience only.
  }
}

/* ------------------------------------------------------------------ */
/* Drafts an older desktop build "published" into local storage. They   */
/* never reached the Square; keep them visible as drafts on this device. */
/* ------------------------------------------------------------------ */

const LOCAL_DRAFTS_KEY = "echo.community.published.v1";

export interface SquareLocalDraft {
  id: string;
  title: string;
  content: string;
  tag: string;
  createdAt: number;
}

function toDraft(record: unknown): SquareLocalDraft | null {
  if (!isRecord(record)) return null;
  const id = typeof record.id === "string" ? record.id : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!id || !title) return null;
  return {
    id,
    title,
    content: typeof record.content === "string" ? record.content : "",
    tag: typeof record.tag === "string" ? record.tag : "",
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
  };
}

function readRawDrafts(): unknown[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_DRAFTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readLocalDrafts(): SquareLocalDraft[] {
  return readRawDrafts()
    .map(toDraft)
    .filter((draft): draft is SquareLocalDraft => draft !== null);
}

export function removeLocalDraft(id: string): SquareLocalDraft[] {
  const kept = readRawDrafts().filter((item) => {
    const draft = toDraft(item);
    return draft !== null && draft.id !== id;
  });
  try {
    if (kept.length === 0) window.localStorage.removeItem(LOCAL_DRAFTS_KEY);
    else window.localStorage.setItem(LOCAL_DRAFTS_KEY, JSON.stringify(kept));
  } catch {
    // Storage disabled: nothing was removed, so report what is still there.
  }
  return readLocalDrafts();
}
