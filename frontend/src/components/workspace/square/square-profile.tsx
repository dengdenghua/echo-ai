import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { SquareCopy } from "@/core/i18n/locales/square";

import { fetchSquareUser } from "./square-host";
import { SquareAvatar, SquarePostCard } from "./square-post-card";
import { SquareEmpty, SquareLoading, SquareOffline } from "./square-states";
import {
  SquareRequestError,
  type SquarePost,
  type SquareUserPage,
} from "./square-types";

type ProfileState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed" }
  | { status: "ready"; page: SquareUserPage };

/** An author's page on the Square: name, counts and their posts (the phone's 用户主页). */
export function SquareProfile({
  userId,
  fallbackName,
  copy,
  locale,
  onBack,
  onOpenPost,
}: {
  userId: string;
  fallbackName: string;
  copy: SquareCopy;
  locale: string;
  onBack: () => void;
  onOpenPost: (post: SquarePost) => void;
}) {
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchSquareUser(userId, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setState({ status: "ready", page });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          error instanceof SquareRequestError && error.status === 404
            ? { status: "missing" }
            : { status: "failed" },
        );
      });
    return () => controller.abort();
  }, [userId, attempt]);

  const name =
    state.status === "ready"
      ? state.page.user.nickname || fallbackName
      : fallbackName;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
      >
        <ArrowLeftIcon
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-4"
        />
        {copy.profile.back}
      </button>

      <header className="flex items-center gap-3">
        <SquareAvatar
          initial={name.slice(0, 1)}
          className="size-12 text-base"
        />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-foreground">
            {name}
          </h2>
          {state.status === "ready" && (
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>{copy.profile.works(state.page.posts.length)}</span>
              <span>
                {copy.profile.following(state.page.user.following_count)}
              </span>
              <span>
                {copy.profile.followers(state.page.user.followers_count)}
              </span>
            </p>
          )}
        </div>
      </header>

      {state.status === "loading" && <SquareLoading label={copy.loading} />}
      {state.status === "missing" && (
        <SquareEmpty>{copy.profile.notFound}</SquareEmpty>
      )}
      {state.status === "failed" && (
        <SquareOffline
          title={copy.profile.loadFailed}
          description={copy.offlineDesc}
          retryLabel={copy.retry}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      )}
      {state.status === "ready" &&
        (state.page.posts.length === 0 ? (
          <SquareEmpty>{copy.profile.noPosts}</SquareEmpty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {state.page.posts.map((post) => (
              <SquarePostCard
                key={post.id}
                post={post}
                copy={copy}
                locale={locale}
                onOpen={onOpenPost}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
