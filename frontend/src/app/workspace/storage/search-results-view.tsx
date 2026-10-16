import { useEffect, useState } from "react";
import { FileSearchIcon, MessageSquarePlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NASManifest, NASSearchHit } from "@/core/storage/api";
import { basename } from "@/lib/path-utils";
import { cn } from "@/lib/utils";

import { QuickFileActions, ToolbarSearch } from "./storage-file-ui";

export function SearchResultsView({
  hits,
  query,
  setQuery,
  runSearch,
  isSearching,
  manifest,
  message,
  libraryLabel,
  onBack,
}: {
  hits: NASSearchHit[];
  query: string;
  setQuery: (value: string) => void;
  runSearch: () => void;
  isSearching: boolean;
  manifest: NASManifest | null;
  message?: string | null;
  libraryLabel: string;
  onBack: () => void;
}) {
  const hasHits = hits.length > 0;
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  useEffect(() => setSelectedPaths(new Set()), [hits]);
  const quoteSelected = () => {
    const selectedHits = hits.filter((hit) => selectedPaths.has(hit.path));
    if (selectedHits.length === 0) return;
    window.location.hash = "/workspace/realtime/echo-assistant?agent=echo";
    window.setTimeout(() => {
      selectedHits.forEach((hit) => {
        window.dispatchEvent(
          new CustomEvent("echo:open-file", {
            detail: { path: hit.path, sourceLabel: "知识库" },
          }),
        );
      });
    }, 350);
  };
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted/50 px-3 py-2 lg:h-[60px] lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:px-4 lg:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 shrink-0 rounded-lg bg-card px-2 shadow-[var(--shadow-xs)] ring-1 ring-border"
            onClick={onBack}
          >
            返回{libraryLabel}
          </Button>
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              {hasHits ? "搜索结果" : "检索状态"}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {hasHits
                ? `“${query}” · 本机索引命中 ${hits.length} 条，引用前不会进入任务上下文`
                : `“${query}” · 本机资料官未返回命中`}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <ToolbarSearch
            label="继续搜索："
            query={query}
            setQuery={setQuery}
            runSearch={runSearch}
            isSearching={isSearching}
            manifest={manifest}
          />
          <Button
            size="sm"
            className="h-9 shrink-0 rounded-lg bg-primary px-3 text-primary-foreground hover:bg-primary/90"
            disabled={selectedPaths.size === 0}
            onClick={quoteSelected}
          >
            <MessageSquarePlusIcon className="size-4" />
            引用选中{selectedPaths.size > 0 ? ` (${selectedPaths.size})` : ""}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/50 p-5">
        {hasHits ? (
          <div className="overflow-hidden rounded-lg bg-card shadow-[var(--shadow-xs)] ring-1 ring-border">
            {hits.map((hit, index) => (
              <div
                key={hit.chunk_id}
                className="flex w-full items-center gap-3 border-b border-border/40 px-4 py-3 text-left last:border-b-0 hover:bg-muted"
              >
                <button
                  type="button"
                  aria-label={`选择 ${hit.title || basename(hit.path)}`}
                  aria-pressed={selectedPaths.has(hit.path)}
                  onClick={() =>
                    setSelectedPaths((current) => {
                      const next = new Set(current);
                      if (next.has(hit.path)) next.delete(hit.path);
                      else next.add(hit.path);
                      return next;
                    })
                  }
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded border text-[11px] transition-colors",
                    selectedPaths.has(hit.path)
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card hover:border-foreground/50",
                  )}
                >
                  {selectedPaths.has(hit.path) ? "✓" : ""}
                </button>
                <FileSearchIcon className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {hit.title || basename(hit.path)}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {hit.snippet}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {hit.path}
                  </div>
                </div>
                <Badge variant="outline" className="rounded-full border-border">
                  #{index + 1}
                </Badge>
                <QuickFileActions
                  item={{
                    name: hit.title || basename(hit.path),
                    path: hit.path,
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[340px] flex-col items-center justify-center rounded-lg bg-card px-6 text-center shadow-[var(--shadow-xs)] ring-1 ring-border">
            <div className="grid size-14 place-items-center rounded-lg bg-warning/5 text-warning">
              <FileSearchIcon className="size-6" />
            </div>
            <div className="mt-4 text-base font-semibold">
              {message?.includes("not attached")
                ? "本机检索引擎尚未接入"
                : "没有找到匹配资料"}
            </div>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {message ??
                "换一个关键词，或先在“授权目录”里添加文件夹并运行索引。"}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="rounded-lg bg-muted"
                onClick={() => {
                  window.location.hash =
                    "/workspace/storage?surface=company&library=sources";
                }}
              >
                查看授权目录
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
