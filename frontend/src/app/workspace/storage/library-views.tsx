import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import type { NASAlbum, NASFileAsset, NASManifest } from "@/core/storage/api";
import { cn } from "@/lib/utils";

import {
  assetSearchText,
  DOCUMENT_PAGE_SIZE,
  DOCUMENT_SMART_FILTERS,
  fileAssetToItem,
  fill,
  IMAGE_PAGE_SIZE,
  IMAGE_SMART_FILTERS,
  imageSmartCategory,
  matchesDocumentFilter,
  useNASAsset,
  type DocumentSmartFilter,
  type FileItem,
  type LibraryKey,
  type LibraryMeta,
} from "./storage-helpers";
import {
  FileCard,
  FileManagerRow,
  FilePreviewDialog,
  ImageAssetTile,
  ToolbarSearch,
} from "./storage-file-ui";
import { VideoLibraryView } from "./video-library-view";

export function TopicCenterView({
  documents,
  images,
  videos,
  albums,
  activeLibrary,
  activeMeta,
  query,
  setQuery,
  runSearch,
  isSearching,
  manifest,
  searchMessage,
}: {
  documents: NASFileAsset[];
  images: NASFileAsset[];
  videos: NASFileAsset[];
  albums: NASAlbum[];
  activeLibrary: LibraryKey;
  activeMeta: LibraryMeta;
  query: string;
  setQuery: (value: string) => void;
  runSearch: () => void;
  isSearching: boolean;
  manifest: NASManifest | null;
  searchMessage: string | null;
}) {
  const { t } = useI18n();
  const copy = t.storage;
  const [overviewPreview, setOverviewPreview] = useState<FileItem | null>(null);
  if (activeLibrary === "docs") {
    return (
      <DocumentLibraryView
        files={documents}
        query={query}
        setQuery={setQuery}
        runSearch={runSearch}
        isSearching={isSearching}
        manifest={manifest}
      />
    );
  }

  if (activeLibrary === "images") {
    return (
      <ImageLibraryView
        files={images}
        query={query}
        setQuery={setQuery}
        runSearch={runSearch}
        isSearching={isSearching}
        manifest={manifest}
        albums={albums}
      />
    );
  }

  if (activeLibrary === "videos") {
    return (
      <VideoLibraryView
        files={videos}
        query={query}
        setQuery={setQuery}
        runSearch={runSearch}
        isSearching={isSearching}
        manifest={manifest}
      />
    );
  }

  const recentItems = [...documents, ...images, ...videos]
    .sort((left, right) => right.mtime_ns - left.mtime_ns)
    .slice(0, 24)
    .map(fileAssetToItem);

  return (
    <>
      <div className="flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 py-2">
        <div>
          <div className="text-sm font-semibold">最近文件</div>
          <div className="text-xs text-muted-foreground">
            来自已授权目录的最近更新内容
          </div>
        </div>
        <ToolbarSearch
          label={fill(copy.toolbar.searchIn, { label: activeMeta.label })}
          query={query}
          setQuery={setQuery}
          runSearch={runSearch}
          isSearching={isSearching}
          manifest={manifest}
        />
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto bg-card p-4">
        {recentItems.length > 0 ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">全部类型</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {searchMessage || copy.overview.aggregateDesc}
                </div>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-border bg-card"
              >
                {copy.overview.localDatabaseBadge}
              </Badge>
            </div>
            <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {recentItems.map((item) => (
                <FileCard
                  key={item.path}
                  item={item}
                  onPreview={() => setOverviewPreview(item)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
            授权文件夹并完成扫描后，最近文件会显示在这里
          </div>
        )}
      </main>
      <FilePreviewDialog
        item={overviewPreview}
        onClose={() => setOverviewPreview(null)}
      />
    </>
  );
}

function DocumentLibraryView({
  files,
  query,
  setQuery,
  runSearch,
  isSearching,
  manifest,
}: {
  files: NASFileAsset[];
  query: string;
  setQuery: (value: string) => void;
  runSearch: () => void;
  isSearching: boolean;
  manifest: NASManifest | null;
}) {
  const { t } = useI18n();
  const copy = t.storage;
  const [smartFilter, setSmartFilter] = useState<DocumentSmartFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(DOCUMENT_PAGE_SIZE);
  const [previewItem, setPreviewItem] = useState<FileItem | null>(null);
  const docFiles = useMemo(() => files.map(fileAssetToItem), [files]);
  const newestMtime = useMemo(
    () => files.reduce((latest, file) => Math.max(latest, file.mtime_ns), 0),
    [files],
  );
  const visibleDocFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return files
      .map((asset, index) => ({ asset, item: docFiles[index]! }))
      .filter(
        ({ asset }) =>
          matchesDocumentFilter(asset, smartFilter, newestMtime) &&
          (!normalizedQuery ||
            assetSearchText(asset).includes(normalizedQuery)),
      );
  }, [docFiles, files, newestMtime, query, smartFilter]);
  useEffect(() => setVisibleLimit(DOCUMENT_PAGE_SIZE), [query, smartFilter]);
  const renderedDocFiles = visibleDocFiles.slice(0, visibleLimit);
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted px-3 py-2 lg:h-12 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:py-0">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {copy.docs.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {fill(copy.docs.subtitle, { count: docFiles.length })}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
            {DOCUMENT_SMART_FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={smartFilter === value}
                onClick={() => setSmartFilter(value)}
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-xs transition-colors",
                  smartFilter === "all" && value === "all"
                    ? "bg-foreground text-background"
                    : smartFilter === value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-card",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <ToolbarSearch
            label={copy.docs.searchLabel}
            query={query}
            setQuery={setQuery}
            runSearch={runSearch}
            isSearching={isSearching}
            manifest={manifest}
          />
        </div>
      </div>
      <main className="min-h-0 flex-1 overflow-hidden bg-card">
        <div className="grid grid-cols-[minmax(180px,1fr)_76px_104px] items-center gap-3 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground lg:grid-cols-[minmax(220px,1fr)_minmax(140px,220px)_76px_104px] xl:grid-cols-[minmax(240px,1fr)_minmax(180px,280px)_92px_120px_104px]">
          <span>{copy.docs.colName}</span>
          <span className="hidden lg:block">{copy.docs.colLocation}</span>
          <span>{copy.docs.colSize}</span>
          <span className="hidden text-right xl:block">
            {copy.docs.colModified}
          </span>
          <span className="text-right">{copy.docs.colActions}</span>
        </div>
        <div className="min-h-0 overflow-y-auto">
          {renderedDocFiles.length > 0 ? (
            renderedDocFiles.map(({ item }) => (
              <FileManagerRow
                key={item.path}
                item={item}
                onPreview={() => setPreviewItem(item)}
              />
            ))
          ) : (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              没有符合条件的文档
            </div>
          )}
          {visibleDocFiles.length > renderedDocFiles.length && (
            <div className="flex items-center justify-center border-t border-border/40 px-4 py-4">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setVisibleLimit((current) => current + DOCUMENT_PAGE_SIZE)
                }
              >
                再显示{" "}
                {Math.min(
                  DOCUMENT_PAGE_SIZE,
                  visibleDocFiles.length - renderedDocFiles.length,
                )}{" "}
                项
              </Button>
            </div>
          )}
        </div>
        <div className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {copy.docs.footerNote}
        </div>
      </main>
      <FilePreviewDialog
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />
    </>
  );
}

function ImageLibraryView({
  files,
  albums,
  query,
  setQuery,
  runSearch,
  isSearching,
  manifest,
}: {
  files: NASFileAsset[];
  albums: NASAlbum[];
  query: string;
  setQuery: (value: string) => void;
  runSearch: () => void;
  isSearching: boolean;
  manifest: NASManifest | null;
}) {
  const { t } = useI18n();
  const copy = t.storage;
  const [smartFilter, setSmartFilter] = useState<string>("all");
  const [visibleLimit, setVisibleLimit] = useState(IMAGE_PAGE_SIZE);
  const [previewItem, setPreviewItem] = useState<FileItem | null>(null);
  const imageFiles = useMemo(() => files.map(fileAssetToItem), [files]);
  const visibleImageFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return files
      .map((asset, index) => ({ asset, item: imageFiles[index]! }))
      .filter(
        ({ asset }) =>
          (smartFilter === "all" ||
            (smartFilter.startsWith("album:")
              ? asset.ai_labels?.includes(smartFilter.slice("album:".length))
              : imageSmartCategory(asset) === smartFilter)) &&
          (!normalizedQuery ||
            assetSearchText(asset).includes(normalizedQuery)),
      );
  }, [files, imageFiles, query, smartFilter]);
  useEffect(() => setVisibleLimit(IMAGE_PAGE_SIZE), [query, smartFilter]);
  const renderedImageFiles = visibleImageFiles.slice(0, visibleLimit);
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted px-3 py-2 lg:h-12 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:py-0">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {copy.images.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {fill(copy.images.subtitle, { count: imageFiles.length })}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ToolbarSearch
            label={copy.images.searchLabel}
            query={query}
            setQuery={setQuery}
            runSearch={runSearch}
            isSearching={isSearching}
            manifest={manifest}
          />
          <Badge
            variant="outline"
            className="h-8 rounded-md border-border bg-card px-2.5 text-xs"
          >
            {copy.images.badgeAllImages}
          </Badge>
        </div>
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto bg-card px-4 py-4 lg:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {IMAGE_SMART_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={smartFilter === value}
              onClick={() => setSmartFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 transition-colors",
                smartFilter === value
                  ? "bg-foreground text-background"
                  : "border border-border bg-card hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
          {albums.map((album) => (
            <AlbumChip
              key={album.label}
              album={album}
              active={smartFilter === `album:${album.label}`}
              onClick={() => setSmartFilter(`album:${album.label}`)}
            />
          ))}
          <span className="ml-1">
            {visibleImageFiles.length} 项 · 本地智能分类
          </span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1">
          {renderedImageFiles.length > 0 ? (
            renderedImageFiles.map(({ item, asset }) => (
              <ImageAssetTile
                key={item.path}
                item={item}
                asset={asset}
                onPreview={() => setPreviewItem(item)}
              />
            ))
          ) : (
            <div className="col-span-full px-4 py-16 text-center text-sm text-muted-foreground">
              没有符合条件的图片
            </div>
          )}
        </div>
        {visibleImageFiles.length > renderedImageFiles.length && (
          <div className="flex justify-center py-5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setVisibleLimit((current) => current + IMAGE_PAGE_SIZE)
              }
            >
              再显示{" "}
              {Math.min(
                IMAGE_PAGE_SIZE,
                visibleImageFiles.length - renderedImageFiles.length,
              )}{" "}
              项
            </Button>
          </div>
        )}
      </main>
      <FilePreviewDialog
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />
    </>
  );
}

function AlbumChip({
  album,
  active,
  onClick,
}: {
  album: NASAlbum;
  active: boolean;
  onClick: () => void;
}) {
  const coverUrl = useNASAsset(
    album.cover_asset_id
      ? `/v1/files/${encodeURIComponent(album.cover_asset_id)}/content`
      : undefined,
  );
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md pr-2 text-xs transition-colors",
        active
          ? "bg-foreground text-background"
          : "border border-border bg-card hover:bg-muted",
      )}
    >
      <span className="size-6 overflow-hidden rounded-l-md bg-muted">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : null}
      </span>
      {album.label} <span className="opacity-60">{album.count}</span>
    </button>
  );
}
