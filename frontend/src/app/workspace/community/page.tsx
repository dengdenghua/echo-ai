/**
 * 广场 (the Square): the same feed and market the phone shows under 广场,
 * read from the same Square backend through the runtime's read-only proxy.
 * The route and module id stay `community` so installs and deep links keep
 * working; everything a person sees says 广场.
 */

import { RotateCwIcon, SearchIcon, XIcon } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { SquareInspiration } from "@/components/workspace/square/square-inspiration";
import { SquareMarket } from "@/components/workspace/square/square-market";
import { SquarePostDetail } from "@/components/workspace/square/square-post-detail";
import { SquareProfile } from "@/components/workspace/square/square-profile";
import type { SquarePost } from "@/components/workspace/square/square-types";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { squareCopy } from "@/core/i18n/locales/square";
import { cn } from "@/lib/utils";

type SquareView = "inspiration" | "market";

export default function SquarePage() {
  const { locale } = useI18n();
  const copy = squareCopy(locale);
  const [searchParams, setSearchParams] = useSearchParams();
  const view: SquareView =
    searchParams.get("view") === "market" ? "market" : "inspiration";
  const profileId = searchParams.get("profile");
  const profileName = searchParams.get("name") ?? "";

  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [activePost, setActivePost] = useState<SquarePost | null>(null);

  const switchView = useCallback(
    (next: SquareView) => {
      setActivePost(null);
      setSearchParams(next === "market" ? { view: "market" } : {}, {
        replace: true,
      });
    },
    [setSearchParams],
  );

  const openAuthor = useCallback(
    (post: SquarePost) => {
      if (!post.author_id) return;
      setActivePost(null);
      setSearchParams(
        { profile: post.author_id, name: post.author },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const closeProfile = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
  };

  const clearSearch = () => {
    setDraft("");
    setQuery("");
  };

  return (
    <WorkspaceContainer>
      <WorkspaceBody className="p-0">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-4 p-4">
          <h1 className="sr-only">{copy.appName}</h1>
          {profileId ? (
            <SquareProfile
              key={profileId}
              userId={profileId}
              fallbackName={profileName}
              copy={copy}
              locale={locale}
              onBack={closeProfile}
              onOpenPost={setActivePost}
            />
          ) : (
            <>
              <header className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-border-subtle">
                <div
                  role="tablist"
                  aria-label={copy.appName}
                  className="flex gap-6"
                >
                  {(["inspiration", "market"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={view === key}
                      onClick={() => switchView(key)}
                      className={cn(
                        "relative pb-2 text-base transition-colors duration-150",
                        view === key
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {copy.sections[key]}
                      {view === key && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-core"
                        />
                      )}
                    </button>
                  ))}
                </div>
                <div className="mb-2 ml-auto flex w-full items-center gap-2 sm:w-auto">
                  {view === "inspiration" && (
                    <form
                      role="search"
                      onSubmit={submitSearch}
                      className="relative min-w-0 flex-1 sm:w-64 sm:flex-none"
                    >
                      <label className="sr-only" htmlFor="square-search">
                        {copy.searchLabel}
                      </label>
                      <SearchIcon
                        aria-hidden="true"
                        strokeWidth={1.5}
                        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      />
                      <input
                        id="square-search"
                        type="search"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={copy.searchPlaceholder}
                        maxLength={64}
                        className="w-full rounded-sm border border-border-default bg-background py-1.5 pl-8 pr-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-core/60"
                      />
                      {(draft || query) && (
                        <button
                          type="button"
                          onClick={clearSearch}
                          aria-label={copy.clearSearch}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-xs p-1 text-muted-foreground hover:text-foreground"
                        >
                          <XIcon
                            aria-hidden="true"
                            strokeWidth={1.5}
                            className="size-3.5"
                          />
                        </button>
                      )}
                    </form>
                  )}
                  <button
                    type="button"
                    onClick={() => setReloadKey((value) => value + 1)}
                    aria-label={copy.refresh}
                    title={copy.refresh}
                    className="shrink-0 rounded-sm border border-border-default p-2 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                  >
                    <RotateCwIcon
                      aria-hidden="true"
                      strokeWidth={1.5}
                      className="size-3.5"
                    />
                  </button>
                </div>
              </header>

              {view === "market" ? (
                <SquareMarket
                  copy={copy}
                  locale={locale}
                  reloadKey={reloadKey}
                />
              ) : (
                <SquareInspiration
                  copy={copy}
                  locale={locale}
                  query={query}
                  reloadKey={reloadKey}
                  onOpenPost={setActivePost}
                  onOpenAuthor={openAuthor}
                />
              )}
            </>
          )}
        </div>

        <SquarePostDetail
          post={activePost}
          copy={copy}
          locale={locale}
          onClose={() => setActivePost(null)}
          onOpenAuthor={openAuthor}
        />
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
