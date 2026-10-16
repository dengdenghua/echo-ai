import { useState } from "react";
import {
  ExternalLinkIcon,
  EyeIcon,
  FileSearchIcon,
  FolderOpenIcon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import type { NASFileAsset, NASManifest } from "@/core/storage/api";
import { cn } from "@/lib/utils";

import { toneClass, useNASAsset, type FileItem } from "./storage-helpers";

export function ToolbarSearch({
  label,
  query,
  setQuery,
  runSearch,
  isSearching,
  manifest,
}: {
  label: string;
  query: string;
  setQuery: (value: string) => void;
  runSearch: () => void;
  isSearching: boolean;
  manifest: NASManifest | null;
}) {
  const { t } = useI18n();
  const copy = t.storage;
  return (
    <div className="flex min-w-0 max-w-full flex-1 items-center gap-1 rounded-md border border-border bg-card px-2 shadow-[var(--shadow-xs)] sm:min-w-[300px]">
      <div className="flex min-w-0 flex-1 items-center">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="ml-2 hidden shrink-0 text-xs text-muted-foreground xl:inline">
          {label}
        </span>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") runSearch();
          }}
          placeholder={copy.toolbar.searchPlaceholder}
          className="h-8 min-w-36 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={copy.toolbar.searchAria}
        className="h-7 shrink-0 rounded-md px-2"
        onClick={runSearch}
        disabled={isSearching || !manifest}
      >
        {isSearching ? (
          <RefreshCwIcon className="size-3.5 animate-spin" />
        ) : (
          <SearchIcon className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

export function FileCard({
  item,
  onPreview,
}: {
  item: FileItem;
  onPreview?: () => void;
}) {
  const Icon = item.icon;
  return (
    <div className="group flex min-h-20 items-center gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-[var(--shadow-xs)] transition-colors hover:border-border hover:bg-muted/30">
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-lg",
          toneClass(item.tone),
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.name}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{item.path}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{item.updated}</span>
        </div>
      </div>
      <div className="hidden shrink-0 text-right text-xs text-muted-foreground xl:block">
        <div>{item.kind}</div>
        <div className="mt-1">{item.size}</div>
      </div>
      <QuickFileActions compact item={item} onPreview={onPreview} />
    </div>
  );
}

export function FileManagerRow({
  item,
  onPreview,
}: {
  item: FileItem;
  onPreview: () => void;
}) {
  const Icon = item.icon;
  return (
    <div className="grid w-full grid-cols-[minmax(180px,1fr)_76px_104px] items-center gap-3 border-b border-border/40 px-3 py-3 text-left last:border-b-0 hover:bg-muted lg:grid-cols-[minmax(220px,1fr)_minmax(140px,220px)_76px_104px] xl:grid-cols-[minmax(240px,1fr)_minmax(180px,260px)_92px_120px_104px]">
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            toneClass(item.tone),
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="truncate text-sm font-medium">{item.name}</span>
      </span>
      <span className="hidden truncate text-xs text-muted-foreground lg:block">
        {item.path}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {item.size}
      </span>
      <span className="hidden truncate text-right text-xs text-muted-foreground xl:block">
        {item.updated}
      </span>
      <QuickFileActions item={item} onPreview={onPreview} />
    </div>
  );
}

export function ImageAssetTile({
  item,
  asset,
  onPreview,
}: {
  item: FileItem;
  asset: NASFileAsset;
  onPreview: () => void;
}) {
  const Icon = item.icon;
  const imageUrl = useNASAsset(
    `/v1/files/${encodeURIComponent(asset.asset_id)}/content`,
  );
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onPreview}
      title={`${item.name}\n${item.path}\n${item.size}\n${item.updated}`}
      className="group min-w-0 overflow-hidden rounded-lg bg-muted/40 text-left"
    >
      <span className="flex aspect-square w-full items-center justify-center overflow-hidden">
        {imageUrl && !imageFailed ? (
          <img
            src={imageUrl}
            alt={item.name}
            onError={() => setImageFailed(true)}
            className="size-full object-cover transition-transform duration-base group-hover:scale-[1.02]"
          />
        ) : (
          <Icon className="size-7 text-muted-foreground" />
        )}
      </span>
    </button>
  );
}

export function QuickFileActions({
  compact = false,
  item,
  onPreview,
}: {
  compact?: boolean;
  item?: Pick<FileItem, "name" | "path">;
  onPreview?: () => void;
}) {
  const { t } = useI18n();
  const copy = t.storage;
  const openPath = async (path: string) => {
    if (window.echo?.desktop) {
      const result = await window.echo.desktop.openItem(path);
      if (!result.ok) throw new Error(result.error || "无法打开文件");
      return;
    }
    throw new Error("请在 ECHO AI 桌面端打开本机文件");
  };
  const quoteInTask = () => {
    if (!item) return;
    window.location.hash = "/workspace/realtime/echo-assistant?agent=echo";
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("echo:open-file", {
          detail: { path: item.path, sourceLabel: "知识库" },
        }),
      );
    }, 350);
  };
  const buttons = [
    {
      label: copy.preview.actionPreview,
      icon: EyeIcon,
      action: () => (onPreview ? onPreview() : item && openPath(item.path)),
    },
    {
      label: copy.preview.actionQuote,
      icon: MessageSquarePlusIcon,
      action: quoteInTask,
    },
    {
      label: copy.preview.actionLocate,
      icon: ExternalLinkIcon,
      action: () =>
        item && openPath(item.path.replace(/[\\/][^\\/]+$/, "") || item.path),
    },
  ];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-end gap-1",
        compact && "gap-0.5",
      )}
    >
      {buttons.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            aria-label={action.label}
            disabled={!item}
            onClick={() => {
              Promise.resolve(action.action()).catch((error) =>
                toast.error(
                  error instanceof Error ? error.message : "操作失败",
                ),
              );
            }}
            className={cn(
              "grid place-items-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground",
              compact ? "size-7" : "size-8",
            )}
          >
            <Icon className={compact ? "size-3.5" : "size-4"} />
          </button>
        );
      })}
    </span>
  );
}

export function FilePreviewDialog({
  item,
  onClose,
}: {
  item: FileItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        {item && (
          <div className="flex max-h-[76vh] flex-col">
            <div className="border-b border-border px-5 py-4">
              <DialogTitle className="truncate pr-8 text-base font-semibold">
                {item.name}
              </DialogTitle>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {item.path}
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto bg-muted/25 p-5">
              <PreviewPanel
                title="文件预览"
                subtitle="确认文件信息后，可直接引用到任务或打开原文件。"
                item={item}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewPanel({
  title,
  subtitle,
  item,
}: {
  title: string;
  subtitle: string;
  item: FileItem;
}) {
  const { t } = useI18n();
  const copy = t.storage;
  const Icon = item.icon;
  const quoteInTask = () => {
    window.location.hash = "/workspace/realtime/echo-assistant?agent=echo";
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("echo:open-file", {
          detail: { path: item.path, sourceLabel: "知识库" },
        }),
      );
    }, 350);
  };
  const openItem = async () => {
    if (!window.echo?.desktop) {
      toast.error("请在 ECHO AI 桌面端打开本机文件");
      return;
    }
    const result = await window.echo.desktop.openItem(item.path);
    if (!result.ok) toast.error(result.error || "无法打开文件");
  };
  return (
    <div className="flex min-h-full flex-col">
      <div className="rounded-lg bg-card p-4 shadow-[var(--shadow-xs)] ring-1 ring-border">
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {subtitle}
        </p>
        <div className="mt-4 rounded-lg bg-muted/50 p-4">
          <div
            className={cn(
              "mx-auto flex size-20 items-center justify-center rounded-lg",
              toneClass(item.tone),
            )}
          >
            <Icon className="size-9" />
          </div>
          <div className="mt-4 text-center text-sm font-semibold">
            {item.name}
          </div>
          <div className="mt-1 truncate text-center text-xs text-muted-foreground">
            {item.path}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-card p-4 shadow-[var(--shadow-xs)] ring-1 ring-border">
        <div className="text-sm font-semibold">
          {copy.preview.sourceLocation}
        </div>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          <div className="flex justify-between gap-3">
            <span>{copy.preview.typeLabel}</span>
            <span className="text-foreground">{item.kind}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>{copy.preview.updatedLabel}</span>
            <span className="text-foreground">{item.updated}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>{copy.preview.sizeLabel}</span>
            <span className="text-foreground">{item.size}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-card p-4 shadow-[var(--shadow-xs)] ring-1 ring-border">
        <div className="text-sm font-semibold">{copy.preview.snippetTitle}</div>
        <p className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
          {copy.preview.snippetDesc}
        </p>
      </div>

      <div className="mt-3 grid gap-2">
        <Button
          variant="secondary"
          className="justify-start rounded-lg bg-card shadow-[var(--shadow-xs)]"
          onClick={quoteInTask}
        >
          <FileSearchIcon className="size-4" />
          {copy.preview.quoteInChat}
        </Button>
        <Button
          variant="secondary"
          className="justify-start rounded-lg bg-card shadow-[var(--shadow-xs)]"
          onClick={() => void openItem()}
        >
          <FolderOpenIcon className="size-4" />
          {copy.preview.openLocation}
        </Button>
      </div>
    </div>
  );
}
