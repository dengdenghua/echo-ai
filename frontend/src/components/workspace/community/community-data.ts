/**
 * Community feed data: remote posts, cached responses, and locally published posts.
 * Empty feeds remain empty; sample activity is never inserted into the live feed.
 */

import { communityAssetURL } from "./community-assets";

export type CommunityPostKind = "post" | "mini-app" | "";

/** 单条评论。 */
export interface CommunityComment {
  id: string;
  content: string;
  author: string;
  authorInitial: string;
  authorColor: string;
  createdAt: number;
}

export interface CommunityPost {
  id: string;
  title: string;
  content: string;
  author: string;
  authorInitial: string;
  authorColor: string;
  likesCount: number;
  commentsCount: number;
  tag: string;
  tagColor: string;
  /** 封面图 URL（优先于 coverGradient 展示）。 */
  coverUrl: string;
  /** 多图（详情页轮播）。缺省时退化为 [coverUrl] 单图。 */
  images?: string[];
  /** 渐变封面（coverUrl 为空时用），["#RRGGBB", ...]。 */
  coverGradient: string[];
  /** 封面高度（px），瀑布流产生错落感。 */
  coverHeight: number;
  kind: CommunityPostKind;
  /** 关联可复刻物 id（mini-app / skill / routine）。 */
  appRef: string;
  appKind: string;
  /** 复刻定价（积分）；0 = 免费复刻。 */
  priceCredits: number;
  /** 创建时间 epoch millis。 */
  createdAt: number;
  /** 分类 key（recommend/职场/效率/生活/学习/购物/科技/游戏/关注）。 */
  topic: string;
  /** 预置评论（可选）。未提供时用默认评论生成器兜底。 */
  comments?: CommunityComment[];
}

/** 服务端下发的帖子字段（颜色用 "#RRGGBB" 字符串，后台可随意编辑）。 */
interface CommunityPostDto {
  id?: string;
  title?: string;
  content?: string;
  author?: string;
  authorInitial?: string;
  authorColor?: string;
  likesCount?: number;
  commentsCount?: number;
  tag?: string;
  tagColor?: string;
  coverUrl?: string;
  images?: string[];
  coverGradient?: string[];
  coverHeight?: number;
  kind?: string;
  appRef?: string;
  appKind?: string;
  priceCredits?: number;
  createdAt?: number;
  topic?: string;
}

interface CommunityFeedDto {
  posts?: CommunityPostDto[];
  has_more?: boolean;
}

const CACHE_KEY = "echo.community.feed.v1";

const DEFAULT_GRADIENT = ["#667EEA", "#764BA2"];

function parseColor(hex: string | undefined, fallback: string): string {
  if (!hex) return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? hex.trim() : fallback;
}

function toPost(dto: CommunityPostDto): CommunityPost {
  const title = dto.title ?? "";
  const gradient = Array.isArray(dto.coverGradient)
    ? dto.coverGradient.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c))
    : [];
  return {
    id: dto.id || title || `post-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content: dto.content ?? "",
    author: dto.author ?? "",
    authorInitial: dto.authorInitial || (dto.author ?? "?").slice(0, 1),
    authorColor: parseColor(dto.authorColor, "#7C6FF0"),
    likesCount: dto.likesCount ?? 0,
    commentsCount: dto.commentsCount ?? 0,
    tag: dto.tag ?? "",
    tagColor: parseColor(dto.tagColor, "#7C6FF0"),
    coverUrl: dto.coverUrl ?? "",
    images: Array.isArray(dto.images) ? dto.images.filter(Boolean) : undefined,
    coverGradient: gradient.length ? gradient : DEFAULT_GRADIENT,
    coverHeight: Math.min(260, Math.max(120, dto.coverHeight ?? 160)),
    kind: (dto.kind as CommunityPostKind) ?? "",
    appRef: dto.appRef ?? "",
    appKind: dto.appKind ?? "",
    priceCredits: dto.priceCredits ?? 0,
    createdAt: dto.createdAt ?? Date.now(),
    topic: dto.topic || "recommend",
  };
}

/** 数值缩写：<1k 直显，>=1k 用 1.2k / 3.4w 形式。 */
export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 10000).toFixed(1)}w`;
}

/** 相对时间："刚刚 / N 分钟前 / N 小时前 / N 天前"。 */
export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}

/** 评论示例池（按帖子 id 确定性取材，保证同一帖子每次评论一致）。 */
const COMMENT_POOL: Array<Omit<CommunityComment, "id" | "createdAt">> = [
  {
    author: "橙子",
    authorInitial: "橙",
    authorColor: "#FC466B",
    content: "太实用了，已经复刻到我的工作台！",
  },
  {
    author: "阿北",
    authorInitial: "阿",
    authorColor: "#3F5EFB",
    content: "思路很清晰，按这个改也能用。",
  },
  {
    author: "Momo",
    authorInitial: "M",
    authorColor: "#00C6FF",
    content: "正好需要，感谢分享！",
  },
  {
    author: "小满",
    authorInitial: "小",
    authorColor: "#F2994A",
    content: "收藏了，明天试试看。",
  },
  {
    author: "阿哲",
    authorInitial: "哲",
    authorColor: "#8E2DE2",
    content: "有没有更详细的参数配置教程？",
  },
  {
    author: "鲸鱼",
    authorInitial: "鲸",
    authorColor: "#71B280",
    content: "效率提升明显，老板都夸了。",
  },
  {
    author: "Luna",
    authorInitial: "L",
    authorColor: "#FF6A5B",
    content: "这个场景我也有痛点，学到了。",
  },
  {
    author: "石头",
    authorInitial: "石",
    authorColor: "#11998E",
    content: "请问能接入我自己的数据源吗？",
  },
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 为帖子生成确定性示例评论（2~4 条），保证开箱即有内容可看。 */
export function defaultComments(
  postId: string,
  now = Date.now(),
): CommunityComment[] {
  const seed = hashString(postId);
  const count = 2 + (seed % 3);
  return Array.from({ length: count }, (_, i) => {
    const item = COMMENT_POOL[(seed + i * 3) % COMMENT_POOL.length]!;
    return {
      ...item,
      id: `${postId}.c${i}`,
      createdAt: now - ((seed % 60) + i * 47) * 60_000,
    };
  });
}

/** 用户自评论持久化 key：postId -> CommunityComment[]。 */
const USER_COMMENTS_KEY = "echo.community.user-comments.v1";

export function readUserComments(): Record<string, CommunityComment[]> {
  try {
    const raw = window.localStorage.getItem(USER_COMMENTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CommunityComment[]>) : {};
  } catch {
    return {};
  }
}

function writeUserComments(map: Record<string, CommunityComment[]>) {
  try {
    window.localStorage.setItem(USER_COMMENTS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** 追加一条用户评论并持久化，返回评论数。 */
export function addUserComment(
  postId: string,
  content: string,
  author: string,
  authorInitial: string,
  authorColor = "#7C6FF0",
): number {
  const map = readUserComments();
  const list = map[postId] ?? [];
  list.push({
    id: `u.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`,
    content,
    author,
    authorInitial,
    authorColor,
    createdAt: Date.now(),
  });
  map[postId] = list;
  writeUserComments(map);
  return list.length;
}

/** 合并默认评论 + 用户评论，按时间倒序（最新在前）。 */
export function mergeComments(post: CommunityPost): CommunityComment[] {
  const defaults = post.comments ?? [];
  const users = readUserComments()[post.id] ?? [];
  return [...defaults, ...users].sort((a, b) => b.createdAt - a.createdAt);
}

/** 已复刻帖子 id 持久化 key。 */
const FORKED_KEY = "echo.community.forked.v1";

export function readForked(): string[] {
  try {
    const raw = window.localStorage.getItem(FORKED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeForked(ids: string[]) {
  try {
    window.localStorage.setItem(FORKED_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

/** 把帖子标记为已复刻（本地持久化），返回最新已复刻列表。 */
export function markForked(id: string): string[] {
  const next = Array.from(new Set([...readForked(), id]));
  writeForked(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* 关注（作者）持久化                                                  */
/* ------------------------------------------------------------------ */

const FOLLOWING_KEY = "echo.community.following.v1";

export function readFollowing(): string[] {
  try {
    const raw = window.localStorage.getItem(FOLLOWING_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeFollowing(ids: string[]) {
  try {
    window.localStorage.setItem(FOLLOWING_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

/** 切换关注某作者，返回最新关注列表。 */
export function toggleFollowing(author: string): string[] {
  const next = readFollowing().includes(author)
    ? readFollowing().filter((a) => a !== author)
    : [...readFollowing(), author];
  writeFollowing(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* 收藏（帖子）持久化                                                  */
/* ------------------------------------------------------------------ */

const FAVORITES_KEY = "echo.community.favorites.v1";

export function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function writeFavorites(ids: string[]) {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

/** 切换收藏某帖子，返回最新收藏列表。 */
export function toggleFavorite(id: string): string[] {
  const next = readFavorites().includes(id)
    ? readFavorites().filter((x) => x !== id)
    : [...readFavorites(), id];
  writeFavorites(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* 用户发布（localStorage 持久化，发布后进入全量 feed）                 */
/* ------------------------------------------------------------------ */

const PUBLISHED_KEY = "echo.community.published.v1";

export function readPublished(): CommunityPost[] {
  try {
    const raw = window.localStorage.getItem(PUBLISHED_KEY);
    return raw ? (JSON.parse(raw) as CommunityPost[]) : [];
  } catch {
    return [];
  }
}

function writePublished(posts: CommunityPost[]) {
  try {
    window.localStorage.setItem(PUBLISHED_KEY, JSON.stringify(posts));
  } catch {
    /* ignore */
  }
}

/** 发布一条新帖，返回生成的帖子（含默认头像/分类/渐变）。 */
export function addPublishedPost(input: {
  title: string;
  content: string;
  tag: string;
  topic: string;
  coverUrl?: string;
  priceCredits?: number;
  appRef?: string;
  appKind?: string;
}): CommunityPost {
  const post: CommunityPost = {
    id: `p.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`,
    title: input.title,
    content: input.content,
    author: "我",
    authorInitial: "我",
    authorColor: "#FC466B",
    likesCount: 0,
    commentsCount: 0,
    tag: input.tag || "原创",
    tagColor: "#7C6FF0",
    coverUrl: input.coverUrl ?? "",
    coverGradient: ["#7C6FF0", "#4A00E0"],
    coverHeight: 180,
    kind: input.appRef ? "mini-app" : "post",
    appRef: input.appRef ?? "",
    appKind: input.appKind ?? "",
    priceCredits: input.priceCredits ?? 0,
    createdAt: Date.now(),
    topic: input.topic || "life",
    comments: [],
  };
  const list = readPublished();
  list.unshift(post);
  writePublished(list);
  return post;
}

/** 分类定义：key = 过滤值，label = tab 展示名，color = 分类主题色。 */
export interface CommunityCategory {
  key: string;
  label: string;
  color: string;
}

/** 分类 tab（推荐 + 六大内容分类 + 关注流）。 */
export const COMMUNITY_CATEGORIES: CommunityCategory[] = [
  { key: "recommend", label: "推荐", color: "#FC466B" },
  { key: "following", label: "关注", color: "#FF6A5B" },
  { key: "work", label: "职场", color: "#3F5EFB" },
  { key: "efficiency", label: "效率", color: "#00C6FF" },
  { key: "life", label: "生活", color: "#FF6A5B" },
  { key: "study", label: "学习", color: "#71B280" },
  { key: "shopping", label: "购物", color: "#F2994A" },
  { key: "tech", label: "科技", color: "#8E2DE2" },
  { key: "game", label: "游戏", color: "#5B8C5A" },
];

/** 顶栏 tab 的轻量视图（{key, label}），供页面渲染。 */
export const COMMUNITY_TABS: Array<{ key: string; label: string }> =
  COMMUNITY_CATEGORIES.map(({ key, label }) => ({ key, label }));

/* ------------------------------------------------------------------ */
/* 真实内容媒体：每帖专属封面图（一一对应，杜绝跨帖共用）              */
/* ------------------------------------------------------------------ */

/** 帖子 id → 专属封面图（单图，详情页轮播即该图）。 */
const PER_POST_IMG: Record<string, string> = {
  "seed.1": communityAssetURL("memory-video(1).jpg"),
  "seed.2": communityAssetURL("food-delivery(1).jpg"),
  "seed.3": communityAssetURL("weekly-report(1).jpg"),
  "seed.4": communityAssetURL("voice-reply.jpg"),
  "seed.5": communityAssetURL("price-watch(1).jpg"),
  "seed.6": communityAssetURL("smart-home.jpg"),
  "seed.7": communityAssetURL("travel-plan(1).jpg"),
  "seed.8": communityAssetURL("study-paper(1).jpg"),
  "seed.9": communityAssetURL("resume(1).jpg"),
  "seed.10": communityAssetURL("email-draft.jpg"),
  "seed.11": communityAssetURL("plan-tomorrow.jpg"),
  "seed.12": communityAssetURL("language-coach.jpg"),
  "seed.13": communityAssetURL("game-auto-daily.jpg"),
  "seed.14": communityAssetURL("game-guide(1).jpg"),
  "seed.15": communityAssetURL("meeting-notes.jpg"),
  "seed.16": communityAssetURL("coupon.jpg"),
  "seed.17": communityAssetURL("weekend.jpg"),
  "seed.18": communityAssetURL("wrong-questions.jpg"),
  "seed.19": communityAssetURL("mock-interview.jpg"),
  "seed.20": communityAssetURL("gacha.jpg"),
  "seed.21": communityAssetURL("todo.jpg"),
  "seed.22": communityAssetURL("daily-album.jpg"),
  "seed.23": communityAssetURL("web-summary.jpg"),
  "seed.24": communityAssetURL("weekly-highlights.jpg"),
};

/** 为帖子补全专属封面（未配置图片的帖子保持原渐变）。 */
function applyPostMedia(post: CommunityPost): CommunityPost {
  const cover = post.coverUrl || PER_POST_IMG[post.id] || "";
  if (!cover) return { ...post, images: post.images ?? [] };
  return { ...post, coverUrl: cover, images: [cover] };
}

/** 解析远端响应和缓存中的帖子。 */
function feedFromDto(payload: unknown): CommunityPost[] {
  const dto = payload as CommunityFeedDto;
  if (!Array.isArray(dto?.posts)) return [];
  const posts = dto.posts.map(toPost).filter((p) => p.title);
  return posts;
}

function readCache(): CommunityPost[] {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    return feedFromDto(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeCache(posts: CommunityPost[]) {
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ posts, has_more: false }),
    );
  } catch {
    /* ignore */
  }
}

/** 单页条数（无限滚动每批加载量）。 */
export const PAGE_SIZE = 8;

/** 排序："latest" 按时间倒序，"hot" 按点赞倒序。 */
export type CommunitySort = "latest" | "hot";

export interface CommunityFeedResult {
  posts: CommunityPost[];
  hasMore: boolean;
  total: number;
}

/** 按排序规则排序后返回新数组。 */
function sortPosts(
  posts: CommunityPost[],
  sort: CommunitySort,
): CommunityPost[] {
  return [...posts].sort((a, b) =>
    sort === "hot" ? b.likesCount - a.likesCount : b.createdAt - a.createdAt,
  );
}

/** 按分类过滤：recommend 全量，following 只看已关注作者，其余按 topic。 */
function filterByTopic(posts: CommunityPost[], topic: string): CommunityPost[] {
  if (topic === "recommend") return posts;
  if (topic === "following") {
    const following = readFollowing();
    return posts.filter((p) => following.includes(p.author));
  }
  return posts.filter((p) => p.topic === topic);
}

/** 合并用户发布 + 基础库，并补全真实媒体。 */
function buildPool(base: CommunityPost[]): CommunityPost[] {
  const published = readPublished();
  return [...published, ...base].map(applyPostMedia);
}

/**
 * 拉取社区 feed，支持分类 / 排序 / 分页。
 * 优先远端 `/square/feed`（可选），失败回退缓存，无缓存时显示空列表。
 */
export async function fetchCommunityFeed(
  topic = "recommend",
  sort: CommunitySort = "latest",
  offset = 0,
): Promise<CommunityFeedResult> {
  const cached = readCache();

  // 可选：配置了 squareBaseUrl 时尝试远端。桌面端通常没有，跳过以保持轻量。
  let remoteBase = "";
  try {
    remoteBase = window.localStorage.getItem("echo.squareBaseUrl") ?? "";
  } catch {
    /* ignore */
  }

  let base: CommunityPost[] = [];
  let remoteLoaded = false;
  if (remoteBase.trim()) {
    try {
      const params = [`sort=${sort}`];
      if (topic !== "recommend") params.push(`topic=${topic}`);
      const res = await fetch(
        `${remoteBase.trim().replace(/\/$/, "")}/square/feed?${params.join("&")}`,
      );
      if (res.ok) {
        const posts = feedFromDto(await res.json());
        remoteLoaded = true;
        writeCache(posts);
        if (posts.length > 0) {
          base = posts;
        }
      }
    } catch {
      /* 网络失败 → 回退已缓存内容 */
    }
  }

  if (base.length === 0 && !remoteLoaded) base = cached;

  const pool = buildPool(base);
  const filtered = filterByTopic(pool, topic);
  const sorted = sortPosts(filtered, sort);
  const total = sorted.length;
  const page = sorted.slice(offset, offset + PAGE_SIZE);
  return { posts: page, hasMore: offset + page.length < total, total };
}
