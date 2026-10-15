/**
 * Shapes served by the runtime's read-only Square proxy (`/api/square/*`,
 * runtime/sensing/gateway/square_router.py). Hand-written so ECHO AI and
 * ECHO OS share them; they mirror the Pydantic response models field for field.
 */

import type {
  SquareMarketKindKey,
  SquareMarketSortKey,
  SquareTopicKey,
} from "@/core/i18n/locales/square";

export type { SquareMarketKindKey, SquareMarketSortKey, SquareTopicKey };

export interface SquarePost {
  id: string;
  /** "post" = image/text post; "mini-app" = a phone mini app shared to the Square. */
  kind: string;
  title: string;
  content: string;
  cover_url: string;
  images: string[];
  tag: string;
  topic: string;
  author: string;
  author_id: string;
  author_initial: string;
  likes_count: number;
  comments_count: number;
  favorites_count: number;
  views_count: number;
  app_ref: string;
  app_kind: string;
  price_credits: number;
  sub_price_credits: number;
  forked_from: string;
  created_at: number;
}

export interface SquareFeed {
  posts: SquarePost[];
  has_more: boolean;
}

export interface SquareComment {
  id: string;
  author: string;
  author_id: string;
  content: string;
  parent_id: string;
  created_at: number;
}

export interface SquareComments {
  comments: SquareComment[];
  has_more: boolean;
}

export interface SquareUser {
  user_id: string;
  nickname: string;
  following_count: number;
  followers_count: number;
}

export interface SquareUserPage {
  user: SquareUser;
  posts: SquarePost[];
}

export interface SquareMarketItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  downloads: number;
  platforms: string[];
  author: string;
  license: string;
}

export interface SquareMarket {
  kind: string;
  items: SquareMarketItem[];
}

export interface SquareFeedQuery {
  topic: SquareTopicKey;
  sort: "latest" | "hot";
  q: string;
  offset: number;
  limit: number;
}

/** Thrown by the host adapter; `status` 404 means the Square answered "not found". */
export class SquareRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SquareRequestError";
  }
}
