import {
  AppWindowIcon,
  BookmarkIcon,
  EyeIcon,
  HeartIcon,
  MessageCircleIcon,
  SmartphoneIcon,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { SquareCopy } from "@/core/i18n/locales/square";
import { cn } from "@/lib/utils";

import {
  formatCount,
  isSquareTopic,
  postImages,
  relativeTime,
} from "./square-data";
import { fetchSquareComments } from "./square-host";
import { SquareAvatar } from "./square-post-card";
import { SquareLoading } from "./square-states";
import type { SquareComment, SquarePost } from "./square-types";

type CommentsState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; comments: SquareComment[] };

/**
 * Post detail, the phone's 帖子详情 read-only: images, body, author, the
 * mini-app card, counts and comments. Liking, saving, commenting and forking
 * need a Square account, which the desktop does not hold.
 */
export function SquarePostDetail({
  post,
  copy,
  locale,
  onClose,
  onOpenAuthor,
}: {
  post: SquarePost | null;
  copy: SquareCopy;
  locale: string;
  onClose: () => void;
  onOpenAuthor: (post: SquarePost) => void;
}) {
  return (
    <Sheet open={post !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        {post && (
          <PostBody
            key={post.id}
            post={post}
            copy={copy}
            locale={locale}
            onOpenAuthor={onOpenAuthor}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PostBody({
  post,
  copy,
  locale,
  onOpenAuthor,
}: {
  post: SquarePost;
  copy: SquareCopy;
  locale: string;
  onOpenAuthor: (post: SquarePost) => void;
}) {
  const images = postImages(post);
  const [imageIndex, setImageIndex] = useState(0);
  const topic =
    isSquareTopic(post.topic) && post.topic !== "recommend"
      ? copy.topics[post.topic]
      : "";
  const meta = [
    post.tag,
    topic === post.tag ? "" : topic,
    relativeTime(post.created_at, locale),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-h-full flex-col">
      <SheetHeader className="border-b border-border-subtle px-5 py-4 pr-14">
        <SheetTitle className="text-sm">{copy.detail.title}</SheetTitle>
        <SheetDescription className="sr-only">
          {post.title || copy.untitled}
        </SheetDescription>
      </SheetHeader>

      {images.length > 0 && (
        <figure className="border-b border-border-subtle bg-muted">
          <img
            key={images[imageIndex]}
            src={images[imageIndex]}
            alt=""
            referrerPolicy="no-referrer"
            className="max-h-80 min-h-40 w-full object-contain"
          />
          {images.length > 1 && (
            <figcaption className="flex gap-1.5 overflow-x-auto p-2">
              {images.map((src, index) => (
                <button
                  key={src}
                  type="button"
                  aria-label={copy.detail.image(index + 1, images.length)}
                  aria-pressed={index === imageIndex}
                  onClick={() => setImageIndex(index)}
                  className={cn(
                    "size-12 shrink-0 overflow-hidden rounded-xs border",
                    index === imageIndex
                      ? "border-core"
                      : "border-transparent opacity-70 hover:opacity-100",
                  )}
                >
                  <img
                    src={src}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </figcaption>
          )}
        </figure>
      )}

      <div className="space-y-4 px-5 py-4">
        <h2 className="text-base font-semibold leading-snug text-foreground">
          {post.title || copy.untitled}
        </h2>
        <button
          type="button"
          onClick={() => onOpenAuthor(post)}
          disabled={!post.author_id}
          aria-label={copy.openAuthor(post.author)}
          className="flex items-center gap-2 rounded-sm text-left enabled:hover:text-foreground disabled:cursor-default"
        >
          <SquareAvatar initial={post.author_initial} className="size-7" />
          <span className="min-w-0">
            <span className="block truncate text-sm text-foreground">
              {post.author}
            </span>
            {meta && (
              <span className="block truncate text-xs text-muted-foreground">
                {meta}
              </span>
            )}
          </span>
        </button>

        {post.content && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
            {post.content}
          </p>
        )}

        {post.forked_from && (
          <p className="text-xs text-muted-foreground">
            {copy.detail.forkedFrom}
          </p>
        )}

        {post.app_ref && <AppCard post={post} copy={copy} />}

        <dl className="grid grid-cols-4 gap-2 rounded-md border border-border-subtle p-3">
          <Stat
            icon={HeartIcon}
            label={copy.detail.stats.likes}
            value={formatCount(post.likes_count, locale)}
          />
          <Stat
            icon={BookmarkIcon}
            label={copy.detail.stats.favorites}
            value={formatCount(post.favorites_count, locale)}
          />
          <Stat
            icon={MessageCircleIcon}
            label={copy.detail.stats.comments}
            value={formatCount(post.comments_count, locale)}
          />
          <Stat
            icon={EyeIcon}
            label={copy.detail.stats.views}
            value={formatCount(post.views_count, locale)}
          />
        </dl>
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <SmartphoneIcon
            aria-hidden="true"
            strokeWidth={1.5}
            className="mt-0.5 size-3.5 shrink-0"
          />
          {copy.detail.accountNote}
        </p>
      </div>

      {post.kind !== "mini-app" && (
        <Comments post={post} copy={copy} locale={locale} />
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon strokeWidth={1.5} className="size-3.5" />
        {label}
      </dt>
      <dd className="font-mono text-sm tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

function AppCard({ post, copy }: { post: SquarePost; copy: SquareCopy }) {
  const price =
    post.sub_price_credits > 0
      ? copy.detail.appSubscription(post.sub_price_credits)
      : post.price_credits > 0
        ? copy.detail.appPrice(post.price_credits)
        : copy.detail.appFree;
  return (
    <div className="flex items-start gap-3 rounded-md border border-border-subtle bg-muted/40 p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted">
        <AppWindowIcon
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-4 text-foreground"
        />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">
          {copy.detail.appTitle}
        </p>
        <p className="text-xs text-foreground/80">{price}</p>
        <p className="text-xs text-muted-foreground">
          {copy.detail.appPhoneNote}
        </p>
      </div>
    </div>
  );
}

function Comments({
  post,
  copy,
  locale,
}: {
  post: SquarePost;
  copy: SquareCopy;
  locale: string;
}) {
  const [state, setState] = useState<CommentsState>(() =>
    post.comments_count > 0
      ? { status: "loading" }
      : { status: "ready", comments: [] },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (post.comments_count === 0 && attempt === 0) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchSquareComments(post.id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", comments: result.comments });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [post.id, post.comments_count, attempt]);

  const count =
    state.status === "ready"
      ? Math.max(state.comments.length, post.comments_count)
      : post.comments_count;

  return (
    <section className="border-t border-border-subtle px-5 py-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">
        {copy.detail.commentsTitle(count)}
      </h3>
      {state.status === "loading" && (
        <SquareLoading label={copy.loading} className="min-h-20" />
      )}
      {state.status === "failed" && (
        <p className="text-xs text-muted-foreground">
          {copy.detail.commentsFailed}{" "}
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="text-foreground underline underline-offset-2"
          >
            {copy.retry}
          </button>
        </p>
      )}
      {state.status === "ready" && state.comments.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {copy.detail.noComments}
        </p>
      )}
      {state.status === "ready" && state.comments.length > 0 && (
        <ul className="space-y-3">
          {state.comments.map((comment) => (
            <li key={comment.id} className="flex gap-2">
              <SquareAvatar
                initial={comment.author.slice(0, 1)}
                className="size-6"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground">{comment.author}</span>
                  {comment.created_at > 0 && (
                    <> · {relativeTime(comment.created_at, locale)}</>
                  )}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90">
                  {comment.content}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
