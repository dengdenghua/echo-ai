import { FileTextIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SquareCopy } from "@/core/i18n/locales/square";
import { cn } from "@/lib/utils";

import {
  FEED_PAGE_SIZE,
  SQUARE_TOPICS,
  readCachedFeed,
  readLocalDrafts,
  relativeTime,
  removeLocalDraft,
  writeCachedFeed,
  type SquareLocalDraft,
} from "./square-data";
import { fetchSquareFeed } from "./square-host";
import { SquarePostCard } from "./square-post-card";
import {
  SquareEmpty,
  SquareLoading,
  SquareOffline,
  SquarePill,
} from "./square-states";
import type { SquarePost, SquareTopicKey } from "./square-types";

type FeedSort = "latest" | "hot";

type FeedState =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "ready"; posts: SquarePost[]; hasMore: boolean; stale: boolean };

/**
 * 广场 · 灵感: the phone's inspiration feed. 推荐 / 热门 sort it, topic pills
 * filter it, and a search asks the Square itself. 关注 needs a Square account,
 * which the desktop does not hold, so it is not offered here.
 */
export function SquareInspiration({
  copy,
  locale,
  query,
  reloadKey,
  onOpenPost,
  onOpenAuthor,
}: {
  copy: SquareCopy;
  locale: string;
  /** Committed search text; empty for the plain feed. */
  query: string;
  /** Bumped by the page's refresh button. */
  reloadKey: number;
  onOpenPost: (post: SquarePost) => void;
  onOpenAuthor: (post: SquarePost) => void;
}) {
  const [sort, setSort] = useState<FeedSort>("latest");
  const [topic, setTopic] = useState<SquareTopicKey>("recommend");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FeedState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    moreController.current?.abort();
    setState({ status: "loading" });
    setMoreFailed(false);
    fetchSquareFeed(
      { topic, sort, q: query, offset: 0, limit: FEED_PAGE_SIZE },
      controller.signal,
    )
      .then((feed) => {
        if (controller.signal.aborted) return;
        if (!query) writeCachedFeed(topic, sort, feed);
        setState({
          status: "ready",
          posts: feed.posts,
          hasMore: feed.has_more,
          stale: false,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        const cached = query ? null : readCachedFeed(topic, sort);
        setState(
          cached
            ? {
                status: "ready",
                posts: cached.posts,
                hasMore: false,
                stale: true,
              }
            : { status: "offline" },
        );
      });
    return () => controller.abort();
  }, [topic, sort, query, attempt, reloadKey]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || loadingMore) return;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setMoreFailed(false);
    fetchSquareFeed(
      {
        topic,
        sort,
        q: query,
        offset: state.posts.length,
        limit: FEED_PAGE_SIZE,
      },
      controller.signal,
    )
      .then((feed) => {
        if (controller.signal.aborted) return;
        setState((current) => {
          if (current.status !== "ready") return current;
          const seen = new Set(current.posts.map((post) => post.id));
          return {
            ...current,
            posts: [
              ...current.posts,
              ...feed.posts.filter((post) => !seen.has(post.id)),
            ],
            hasMore: feed.has_more,
          };
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setMoreFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false);
      });
  }, [state, loadingMore, topic, sort, query]);

  const heading = query
    ? copy.searchResults(query)
    : copy.heading(
        topic === "recommend" ? null : copy.topics[topic],
        sort === "hot",
      );

  return (
    <div className="flex flex-col gap-3">
      {!query && (
        <>
          <div
            role="tablist"
            aria-label={copy.sections.inspiration}
            className="flex items-center gap-1"
          >
            {(["latest", "hot"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={sort === key}
                onClick={() => setSort(key)}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-sm transition-colors duration-150",
                  sort === key
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {key === "latest" ? copy.tabs.recommend : copy.tabs.hot}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {SQUARE_TOPICS.map((key) => (
              <SquarePill
                key={key}
                active={topic === key}
                onClick={() => setTopic(key)}
              >
                {copy.topics[key]}
              </SquarePill>
            ))}
          </div>
        </>
      )}

      <h2 className="text-xs font-medium text-muted-foreground">{heading}</h2>

      {!query && <LocalDrafts copy={copy} locale={locale} />}

      {state.status === "loading" && <SquareLoading label={copy.loading} />}
      {state.status === "offline" && (
        <SquareOffline
          title={copy.offlineTitle}
          description={copy.offlineDesc}
          retryLabel={copy.retry}
          onRetry={retry}
        />
      )}
      {state.status === "ready" && (
        <>
          {state.stale && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 rounded-sm border border-border-subtle px-3 py-2 text-xs text-muted-foreground"
            >
              <span>{copy.staleNotice}</span>
              <button
                type="button"
                onClick={retry}
                className="shrink-0 text-foreground underline underline-offset-2"
              >
                {copy.retry}
              </button>
            </div>
          )}
          {state.posts.length === 0 ? (
            <SquareEmpty>
              {query ? copy.searchEmpty(query) : copy.feedEmpty}
            </SquareEmpty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {state.posts.map((post) => (
                <SquarePostCard
                  key={post.id}
                  post={post}
                  copy={copy}
                  locale={locale}
                  onOpen={onOpenPost}
                  onOpenAuthor={onOpenAuthor}
                />
              ))}
            </div>
          )}
          {state.hasMore && (
            <div className="flex flex-col items-center gap-2 py-2">
              {loadingMore ? (
                <SquareLoading label={copy.loading} className="min-h-12" />
              ) : (
                <button
                  type="button"
                  onClick={loadMore}
                  className="rounded-sm border border-border-default px-4 py-1.5 text-sm text-foreground transition-colors duration-150 hover:bg-muted"
                >
                  {moreFailed ? copy.retry : copy.loadMore}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Drafts an older desktop build kept locally; labelled as never published. */
function LocalDrafts({ copy, locale }: { copy: SquareCopy; locale: string }) {
  const [drafts, setDrafts] = useState<SquareLocalDraft[]>(() =>
    readLocalDrafts(),
  );
  if (drafts.length === 0) return null;
  return (
    <details
      data-square-drafts=""
      className="rounded-md border border-border-subtle px-3 py-2"
    >
      <summary className="cursor-pointer text-sm text-foreground">
        {copy.drafts.title(drafts.length)}
      </summary>
      <p className="mt-1 text-xs text-muted-foreground">{copy.drafts.note}</p>
      <ul className="mt-2 space-y-2">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            className="flex items-start gap-2 rounded-sm bg-muted/40 px-2 py-1.5"
          >
            <FileTextIcon
              aria-hidden="true"
              strokeWidth={1.5}
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{draft.title}</p>
              {draft.content && (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {draft.content}
                </p>
              )}
              {draft.createdAt > 0 && (
                <p className="text-xs text-muted-foreground">
                  {relativeTime(draft.createdAt, locale)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDrafts(removeLocalDraft(draft.id))}
              aria-label={copy.drafts.removeLabel(draft.title)}
              title={copy.drafts.remove}
              className="shrink-0 rounded-xs p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              <Trash2Icon
                aria-hidden="true"
                strokeWidth={1.5}
                className="size-3.5"
              />
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
