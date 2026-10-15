import {
  AppWindowIcon,
  FileTextIcon,
  HeartIcon,
  MessageCircleIcon,
} from "lucide-react";
import { useState } from "react";

import type { SquareCopy } from "@/core/i18n/locales/square";
import { cn } from "@/lib/utils";

import { excerpt, formatCount, isMiniAppPost } from "./square-data";
import type { SquarePost } from "./square-types";

export function SquareAvatar({
  initial,
  className,
}: {
  initial: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground/80",
        className,
      )}
    >
      {initial || "?"}
    </span>
  );
}

/** One Square post: cover (or a quiet placeholder), title, excerpt, author, counts. */
export function SquarePostCard({
  post,
  copy,
  locale,
  onOpen,
  onOpenAuthor,
}: {
  post: SquarePost;
  copy: SquareCopy;
  locale: string;
  onOpen: (post: SquarePost) => void;
  onOpenAuthor?: (post: SquarePost) => void;
}) {
  const [coverBroken, setCoverBroken] = useState(false);
  const miniApp = isMiniAppPost(post);
  const showCover = Boolean(post.cover_url) && !coverBroken;
  const body = excerpt(post.content);
  const title = post.title || copy.untitled;
  const PlaceholderIcon = miniApp ? AppWindowIcon : FileTextIcon;

  return (
    <article
      data-square-post={post.id}
      className="group flex flex-col overflow-hidden rounded-md border border-border-subtle bg-card transition-colors duration-150 hover:border-border-default"
    >
      <button
        type="button"
        onClick={() => onOpen(post)}
        className="flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-core/60"
      >
        <div className="relative w-full overflow-hidden bg-muted">
          {showCover ? (
            <img
              src={post.cover_url}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setCoverBroken(true)}
              className="aspect-[4/3] w-full object-cover"
            />
          ) : (
            <div className="flex h-20 items-center justify-center">
              <PlaceholderIcon
                aria-hidden="true"
                strokeWidth={1.5}
                className="size-5 text-muted-foreground/70"
              />
            </div>
          )}
          {(miniApp || post.tag) && (
            <span className="absolute left-2 top-2 rounded-xs bg-background/85 px-1.5 py-0.5 text-xs text-foreground">
              {miniApp ? copy.miniApp : post.tag}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
            {title}
          </h3>
          {body && (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {body}
            </p>
          )}
          {post.app_ref && (
            <p className="mt-auto pt-1 text-xs text-muted-foreground">
              {post.price_credits > 0
                ? copy.credits(post.price_credits)
                : copy.free}
            </p>
          )}
        </div>
      </button>
      <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2">
        <button
          type="button"
          onClick={() => onOpenAuthor?.(post)}
          disabled={!onOpenAuthor || !post.author_id}
          aria-label={copy.openAuthor(post.author)}
          className="flex min-w-0 items-center gap-1.5 rounded-xs text-left enabled:hover:text-foreground disabled:cursor-default"
        >
          <SquareAvatar initial={post.author_initial} className="size-5" />
          <span className="truncate text-xs text-muted-foreground">
            {post.author}
          </span>
        </button>
        <span
          className="ml-auto flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground"
          aria-label={copy.likes(post.likes_count)}
        >
          <HeartIcon
            aria-hidden="true"
            strokeWidth={1.5}
            className="size-3.5"
          />
          {formatCount(post.likes_count, locale)}
        </span>
        {post.kind !== "mini-app" && (
          <span
            className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground"
            aria-label={copy.comments(post.comments_count)}
          >
            <MessageCircleIcon
              aria-hidden="true"
              strokeWidth={1.5}
              className="size-3.5"
            />
            {formatCount(post.comments_count, locale)}
          </span>
        )}
      </div>
    </article>
  );
}
