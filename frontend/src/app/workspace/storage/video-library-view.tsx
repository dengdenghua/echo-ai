import { requireArray, serviceErrorMessage } from "@/core/utils/service-error";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileSearchIcon,
  FilmIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  TagIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import {
  getVideoCoverURL,
  listVideoFaceGroups,
  classifyVideoTags,
  searchVideoByText,
  ocrVideoKeyframes,
  triggerVideoIndex,
  type NASManifest,
  type NASFileAsset,
  type NASVideoSearchHit,
  type NASVideoFaceGroup,
  type NASVideoClassifyResult,
  type NASVideoOcrHit,
} from "@/core/storage/api";
import { basename } from "@/lib/path-utils";
import { cn } from "@/lib/utils";

import {
  delay,
  fileAssetToItem,
  fill,
  formatBytes,
  formatSeconds,
  useNASAsset,
  type StorageCopy,
  type VideoPlayerHit,
  type VideoPlayerTarget,
} from "./storage-helpers";
import { ToolbarSearch } from "./storage-file-ui";

type VideoTab = "videos" | "people" | "tags";

export function VideoLibraryView({
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
  const [activeTab, setActiveTab] = useState<VideoTab>("videos");
  const [isIndexing, setIsIndexing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 安全检查：确保 files 引用稳定（files 始终为数组）
  const safeFiles = useMemo(() => files, [files]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isVideoSearching, setIsVideoSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<NASVideoSearchHit[]>([]);
  const [ocrHits, setOcrHits] = useState<NASVideoOcrHit[]>([]);
  const [videoDataError, setVideoDataError] = useState<string | null>(null);
  const [faceGroups, setFaceGroups] = useState<NASVideoFaceGroup[]>([]);
  const [classifyResults, setClassifyResults] = useState<
    NASVideoClassifyResult[]
  >([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [playerTarget, setPlayerTarget] = useState<VideoPlayerTarget | null>(
    null,
  );

  const videoFiles = useMemo(() => safeFiles.map(fileAssetToItem), [safeFiles]);

  const assetByVideoPath = useMemo(() => {
    const map = new Map<string, NASFileAsset>();
    for (const asset of safeFiles) {
      map.set(asset.path, asset);
      map.set(basename(asset.path), asset);
    }
    return map;
  }, [safeFiles]);

  const resolveAsset = useCallback(
    (videoPath: string): NASFileAsset | null => {
      const byExact = assetByVideoPath.get(videoPath);
      if (byExact) return byExact;
      const byBase = assetByVideoPath.get(basename(videoPath));
      if (byBase) return byBase;
      const lower = videoPath.toLowerCase();
      return (
        safeFiles.find(
          (asset) =>
            asset.path.toLowerCase().endsWith(lower) ||
            lower.endsWith(asset.path.toLowerCase()),
        ) ?? null
      );
    },
    [assetByVideoPath, safeFiles],
  );

  const loadFaces = useCallback(async () => {
    try {
      const res = await listVideoFaceGroups();
      setFaceGroups(requireArray<NASVideoFaceGroup>(res?.groups, "人物列表"));
      setVideoDataError(null);
    } catch (error) {
      setVideoDataError(serviceErrorMessage(error));
      setFaceGroups([]);
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      const res = await classifyVideoTags();
      setClassifyResults(
        requireArray<(typeof classifyResults)[number]>(
          res?.results,
          "标签列表",
        ),
      );
      setVideoDataError(null);
    } catch (error) {
      setVideoDataError(serviceErrorMessage(error));
      setClassifyResults([]);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "people") void loadFaces();
  }, [activeTab, loadFaces]);

  useEffect(() => {
    if (activeTab === "tags") void loadTags();
  }, [activeTab, loadTags]);

  const rebuildIndex = async () => {
    if (isIndexing) return;
    setIsIndexing(true);
    try {
      await triggerVideoIndex();
      await delay(1500);
      void loadFaces();
      void loadTags();
    } finally {
      setIsIndexing(false);
    }
  };

  const runVideoSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setIsVideoSearching(true);
    try {
      const [semantic, ocr] = await Promise.all([
        searchVideoByText(q),
        ocrVideoKeyframes(q),
      ]);
      setSearchHits(semantic.hits);
      setOcrHits(ocr.hits);
    } catch {
      setSearchHits([]);
      setOcrHits([]);
    } finally {
      setHasSearched(true);
      setIsVideoSearching(false);
    }
  };

  const openPlayer = useCallback(
    (video: NASFileAsset, hits: VideoPlayerHit[], index: number) => {
      setPlayerTarget({ video, hits, index });
    },
    [],
  );

  const openAsset = useCallback(
    (video: NASFileAsset) => {
      openPlayer(video, [{ videoPath: video.path, timeSec: 0 }], 0);
    },
    [openPlayer],
  );

  const openSearchHit = useCallback(
    (hit: NASVideoSearchHit, video: NASFileAsset) => {
      const hits = searchHits
        .filter((item) => item.video_path === hit.video_path)
        .map((item) => ({
          videoPath: item.video_path,
          timeSec: item.time_sec,
        }));
      const index = Math.max(
        0,
        hits.findIndex((item) => item.timeSec === hit.time_sec),
      );
      openPlayer(video, hits, index);
    },
    [openPlayer, searchHits],
  );

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const result of classifyResults) {
      const top = result.tags[0];
      if (top) counts.set(top.label, (counts.get(top.label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, count]) => ({
      label,
      count,
    }));
  }, [classifyResults]);

  const taggedVideos = useMemo(
    () =>
      selectedTag
        ? classifyResults
            .filter((result) => result.tags[0]?.label === selectedTag)
            .map((result) => resolveAsset(result.video_path))
            .filter((asset): asset is NASFileAsset => asset !== null)
        : [],
    [classifyResults, resolveAsset, selectedTag],
  );

  const renderVideoGrid = (assets: NASFileAsset[]) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
      {assets.length > 0 ? (
        assets.map((asset) => (
          <VideoAssetTile
            key={asset.asset_id}
            asset={asset}
            copy={copy}
            onOpen={() => openAsset(asset)}
          />
        ))
      ) : (
        <div className="col-span-full px-4 py-12 text-center text-sm text-muted-foreground">
          {copy.videos.noResults}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted px-3 py-2 lg:h-12 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:py-0">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {copy.videos.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {fill(copy.videos.subtitle, { count: videoFiles.length })}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ToolbarSearch
            label={copy.videos.searchLabel}
            query={query}
            setQuery={setQuery}
            runSearch={runSearch}
            isSearching={isSearching}
            manifest={manifest}
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-8 rounded-md bg-card px-2 text-xs shadow-[var(--shadow-xs)]"
            onClick={rebuildIndex}
            disabled={isIndexing || !manifest}
          >
            <RefreshCwIcon
              className={cn("size-3.5", isIndexing && "animate-spin")}
            />
            {isIndexing ? copy.videos.indexing : copy.videos.indexAction}
          </Button>
          <Badge
            variant="outline"
            className="h-8 rounded-md border-border bg-card px-2.5 text-xs"
          >
            {copy.videos.badgeAllVideos}
          </Badge>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/50 px-3 py-2">
        {(
          [
            ["videos", copy.videos.tabVideos, FilmIcon],
            ["people", copy.videos.tabPeople, UsersIcon],
            ["tags", copy.videos.tabTags, TagIcon],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={activeTab === value}
            onClick={() => setActiveTab(value)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
              activeTab === value
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-card",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto bg-card px-4 py-4 lg:px-6">
        {activeTab === "videos" && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-border bg-card px-2 shadow-[var(--shadow-xs)]">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void runVideoSearch();
                  }}
                  placeholder={copy.videos.searchPlaceholder}
                  className="h-8 min-w-36 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 rounded-md px-2"
                  onClick={() => void runVideoSearch()}
                  disabled={isVideoSearching || !searchQuery.trim()}
                >
                  {isVideoSearching ? (
                    <RefreshCwIcon className="size-3.5 animate-spin" />
                  ) : (
                    <SearchIcon className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
            <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <SparklesIcon className="size-3.5" />
              <span>{copy.videos.searchHint}</span>
            </div>
            {files.length === 0 && !hasSearched ? (
              <div className="rounded-lg border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
                {copy.videos.noIndex}
              </div>
            ) : hasSearched ? (
              <div className="space-y-4">
                {searchHits.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-semibold text-muted-foreground">
                      {copy.videos.summary}
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
                      {searchHits.map((hit) => {
                        const video = resolveAsset(hit.video_path);
                        return (
                          <button
                            key={`${hit.video_path}-${hit.time_sec}`}
                            type="button"
                            onClick={() => video && openSearchHit(hit, video)}
                            className="flex w-full items-center gap-3 border-b border-border/40 px-3 py-2.5 text-left last:border-b-0 hover:bg-muted"
                          >
                            <PlayIcon className="size-4 shrink-0 text-primary" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {video ? video.name : basename(hit.video_path)}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatSeconds(hit.time_sec)}
                            </span>
                            <Badge
                              variant="outline"
                              className="rounded-full border-border"
                            >
                              {Math.round(
                                Math.max(0, Math.min(1, hit.score)) * 100,
                              )}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {ocrHits.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-semibold text-muted-foreground">
                      {copy.videos.ocr.label}
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
                      {ocrHits.map((hit, index) => {
                        const video = resolveAsset(hit.video_path);
                        return (
                          <button
                            key={`${hit.video_path}-${hit.time_sec}-${index}`}
                            type="button"
                            onClick={() =>
                              video &&
                              openPlayer(
                                video,
                                [
                                  {
                                    videoPath: hit.video_path,
                                    timeSec: hit.time_sec,
                                  },
                                ],
                                0,
                              )
                            }
                            className="flex w-full items-start gap-3 border-b border-border/40 px-3 py-2.5 text-left last:border-b-0 hover:bg-muted"
                          >
                            <FileSearchIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {video ? video.name : basename(hit.video_path)}{" "}
                                · {formatSeconds(hit.time_sec)}
                              </span>
                              <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                {hit.text}
                              </span>
                            </span>
                            <Badge
                              variant="outline"
                              className="rounded-full border-border"
                            >
                              {Math.round(
                                Math.max(0, Math.min(1, hit.score)) * 100,
                              )}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {searchHits.length === 0 && ocrHits.length === 0 && (
                  <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                    {copy.videos.noOcr}
                  </div>
                )}
              </div>
            ) : (
              <>
                {renderVideoGrid(files)}
                <div className="mt-6 text-xs text-muted-foreground">
                  {copy.videos.footerNote}
                </div>
              </>
            )}
          </>
        )}

        {videoDataError && (
          <div
            role="alert"
            className="mx-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
          >
            {videoDataError}
            <Button
              variant="outline"
              size="sm"
              className="ml-3"
              onClick={() =>
                void (activeTab === "people" ? loadFaces() : loadTags())
              }
            >
              重试
            </Button>
          </div>
        )}
        {activeTab === "people" && (
          <div className="space-y-3">
            {faceGroups.length > 0 ? (
              faceGroups.map((group) => (
                <div
                  key={group.person}
                  className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]"
                >
                  <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-3 py-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <UserIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {copy.videos.peopleCount(group.person)}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {copy.videos.faceCount(group.count_faces)}
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-black/[0.04]">
                    {group.appearances.map((appearance, index) => {
                      const video = resolveAsset(appearance.video_path);
                      return (
                        <button
                          key={`${appearance.video_path}-${appearance.time_sec}-${index}`}
                          type="button"
                          onClick={() =>
                            video &&
                            openPlayer(
                              video,
                              group.appearances.map((item) => ({
                                videoPath: item.video_path,
                                timeSec: item.time_sec,
                              })),
                              index,
                            )
                          }
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted"
                        >
                          <PlayIcon className="size-4 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {video
                              ? video.name
                              : basename(appearance.video_path)}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatSeconds(appearance.time_sec)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
                {copy.videos.noFaces}
              </div>
            )}
          </div>
        )}

        {activeTab === "tags" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {allTags.length > 0 ? (
                allTags.map((tag) => (
                  <button
                    key={tag.label}
                    type="button"
                    aria-pressed={selectedTag === tag.label}
                    onClick={() =>
                      setSelectedTag(
                        selectedTag === tag.label ? null : tag.label,
                      )
                    }
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors",
                      selectedTag === tag.label
                        ? "bg-foreground text-background"
                        : "border border-border bg-card hover:bg-muted",
                    )}
                  >
                    {tag.label}
                    <span className="ml-1 opacity-60">{tag.count}</span>
                  </button>
                ))
              ) : (
                <div className="w-full rounded-lg border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
                  {copy.videos.noTags}
                </div>
              )}
            </div>
            {selectedTag && renderVideoGrid(taggedVideos)}
          </>
        )}
      </main>

      {playerTarget && (
        <VideoPlayerDialog
          target={playerTarget}
          onClose={() => setPlayerTarget(null)}
          onPrev={() =>
            setPlayerTarget((target) =>
              target
                ? { ...target, index: Math.max(0, target.index - 1) }
                : target,
            )
          }
          onNext={() =>
            setPlayerTarget((target) =>
              target
                ? {
                    ...target,
                    index: Math.min(target.hits.length - 1, target.index + 1),
                  }
                : target,
            )
          }
          copy={copy}
        />
      )}
    </>
  );
}

function VideoAssetTile({
  asset,
  copy,
  onOpen,
}: {
  asset: NASFileAsset;
  copy: StorageCopy;
  onOpen: () => void;
}) {
  const coverUrl = getVideoCoverURL(asset.path, 0);
  const videoUrl = useNASAsset(
    `/v1/files/${encodeURIComponent(asset.asset_id)}/content`,
  );
  const [coverFailed, setCoverFailed] = useState(false);
  const showCover = !coverFailed && coverUrl;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${asset.name}\n${asset.path}`}
      className="group min-w-0 overflow-hidden rounded-lg bg-muted/40 text-left"
    >
      <span className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
        {showCover ? (
          <img
            src={coverUrl}
            alt={asset.name}
            onError={() => setCoverFailed(true)}
            className="size-full object-cover transition-transform duration-base group-hover:scale-[1.02]"
          />
        ) : videoUrl ? (
          <video
            src={videoUrl}
            preload="metadata"
            muted
            playsInline
            className="size-full object-cover"
          />
        ) : (
          <FilmIcon className="size-7 text-muted-foreground" />
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/20">
          <span className="grid size-8 place-items-center rounded-full bg-card/90 text-foreground opacity-0 shadow-[var(--shadow-xs)] transition-opacity group-hover:opacity-100">
            <PlayIcon className="size-4" />
          </span>
        </span>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-mini text-white">
          {copy.videos.duration}
        </span>
      </span>
      <div className="space-y-0.5 px-2 py-1.5">
        <div className="truncate text-xs font-medium">{asset.name}</div>
        <div className="truncate text-mini text-muted-foreground">
          {formatBytes(asset.size)}
        </div>
      </div>
    </button>
  );
}

function VideoPlayerDialog({
  target,
  onClose,
  onPrev,
  onNext,
  copy,
}: {
  target: VideoPlayerTarget;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  copy: StorageCopy;
}) {
  const videoUrl = useNASAsset(
    `/v1/files/${encodeURIComponent(target.video.asset_id)}/content`,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const current = target.hits[target.index];
  const currentTimeSec = current?.timeSec;

  useEffect(() => {
    const el = videoRef.current;
    if (el && currentTimeSec !== undefined) el.currentTime = currentTimeSec;
  }, [target.index, currentTimeSec]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl border-border-default bg-card p-0 sm:max-w-3xl"
        showCloseButton={false}
      >
        <div className="p-4">
          <video
            key={target.video.asset_id}
            ref={videoRef}
            src={videoUrl ?? undefined}
            controls
            autoPlay
            muted
            playsInline
            className="aspect-video w-full rounded-lg bg-black"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {target.video.name}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {copy.videos.player.atTime(
                  formatSeconds(current?.timeSec ?? 0),
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="rounded-md bg-muted"
                onClick={onPrev}
                disabled={target.index <= 0}
              >
                {copy.videos.player.prev}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="rounded-md bg-muted"
                onClick={onNext}
                disabled={target.index >= target.hits.length - 1}
              >
                {copy.videos.player.next}
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                {copy.videos.player.close}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
