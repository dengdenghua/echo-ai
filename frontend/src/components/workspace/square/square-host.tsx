/**
 * Host adapter for 广场: the only Square file that differs between ECHO AI and
 * ECHO OS. Everything else under components/workspace/square is shared
 * verbatim. ECHO AI talks to the proxy through the typed request layer and
 * uses the brand progress line.
 */

import { BrandProgressLine } from "@/components/brand/brand-progress";
import { EchoAPIError, apiGet } from "@/core/api/request";

import {
  SquareRequestError,
  type SquareComments,
  type SquareFeed,
  type SquareFeedQuery,
  type SquareMarket,
  type SquareMarketKindKey,
  type SquareMarketSortKey,
  type SquareUserPage,
} from "./square-types";

async function viaProxy<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof EchoAPIError) {
      throw new SquareRequestError(error.message, error.status);
    }
    throw new SquareRequestError(
      error instanceof Error ? error.message : String(error),
      0,
    );
  }
}

export function fetchSquareFeed(
  query: SquareFeedQuery,
  signal?: AbortSignal,
): Promise<SquareFeed> {
  return viaProxy(() => apiGet("/api/square/feed", { query, signal }));
}

export function fetchSquareComments(
  postId: string,
  signal?: AbortSignal,
): Promise<SquareComments> {
  return viaProxy(() =>
    apiGet("/api/square/posts/{post_id}/comments", {
      path: { post_id: postId },
      query: { limit: 100 },
      signal,
    }),
  );
}

export function fetchSquareUser(
  userId: string,
  signal?: AbortSignal,
): Promise<SquareUserPage> {
  return viaProxy(() =>
    apiGet("/api/square/users/{user_id}", {
      path: { user_id: userId },
      signal,
    }),
  );
}

export function fetchSquareMarket(
  kind: SquareMarketKindKey,
  sort: SquareMarketSortKey,
  signal?: AbortSignal,
): Promise<SquareMarket> {
  return viaProxy(() =>
    apiGet("/api/square/market", { query: { kind, sort }, signal }),
  );
}

export function SquareProgressLine({ className }: { className?: string }) {
  return <BrandProgressLine className={className} />;
}
