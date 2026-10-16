import { serviceErrorMessage } from "@/core/utils/service-error";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindowIcon,
  DatabaseIcon,
  FileImageIcon,
  FileTextIcon,
  FolderPlusIcon,
  HardDriveIcon,
  LockKeyholeIcon,
  PlayIcon,
  RefreshCwIcon,
  ServerIcon,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import {
  createNASIndexJob,
  createNASSource,
  deleteNASSource,
  getNASBaseURL,
  getNASManifest,
  getNASIndexJob,
  getNASPolicy,
  isNASAuthenticationError,
  isNASUnavailableError,
  listNASApps,
  listNASAlbums,
  listNASFiles,
  listNASSources,
  searchNAS,
  startNASService,
  updateNASPolicy,
  type NASManifest,
  type NASApp,
  type NASAlbum,
  type NASFileAsset,
  type NASPolicy,
  type NASSearchHit,
  type NASSource,
} from "@/core/storage/api";
import { pickLocalDirectory } from "@/core/workspace/pick-local-directory";
import { cn } from "@/lib/utils";

import { AppsView } from "./apps-view";
import { TopicCenterView } from "./library-views";
import { LocalDiskView } from "./local-disk-view";
import { SearchResultsView } from "./search-results-view";
import { SourcesView } from "./sources-view";
import {
  delay,
  fill,
  type LibraryKey,
  type LibraryMeta,
  type StorageCopy,
} from "./storage-helpers";

function buildLibraries(copy: StorageCopy): LibraryMeta[] {
  return [
    {
      key: "overview",
      label: copy.libraries.overviewLabel,
      detail: copy.libraries.overviewDetail,
      icon: DatabaseIcon,
    },
    {
      key: "apps",
      label: copy.libraries.appsLabel,
      detail: copy.libraries.appsDetail,
      icon: AppWindowIcon,
    },
    {
      key: "docs",
      label: copy.libraries.docsLabel,
      detail: copy.libraries.docsDetail,
      icon: FileTextIcon,
    },
    {
      key: "images",
      label: copy.libraries.imagesLabel,
      detail: copy.libraries.imagesDetail,
      icon: FileImageIcon,
    },
    {
      key: "videos",
      label: copy.libraries.videosLabel,
      detail: copy.libraries.videosDetail,
      icon: PlayIcon,
    },
    {
      key: "computer",
      label: copy.libraries.computerLabel,
      detail: copy.libraries.computerDetail,
      icon: HardDriveIcon,
    },
    {
      key: "sources",
      label: copy.libraries.sourcesLabel,
      detail: copy.libraries.sourcesDetail,
      icon: FolderPlusIcon,
    },
  ];
}

const LIBRARY_KEYS = new Set<LibraryKey>([
  "overview",
  "apps",
  "docs",
  "images",
  "videos",
  "computer",
  "sources",
]);

function isLibraryKey(value: string | null): value is LibraryKey {
  return value !== null && LIBRARY_KEYS.has(value as LibraryKey);
}

const DEFAULT_POLICY: NASPolicy = {
  mode: "efficiency",
  allow_cloud_answering: true,
  allow_snippet_export: true,
  max_exported_snippets: 8,
  max_snippet_chars: 1200,
  redact_file_paths_for_cloud: true,
};

export default function StoragePage() {
  const { t } = useI18n();
  const copy = t.storage;
  const [searchParams] = useSearchParams();
  const [manifest, setManifest] = useState<NASManifest | null>(null);
  const [policy, setPolicy] = useState<NASPolicy>(DEFAULT_POLICY);
  const [sources, setSources] = useState<NASSource[]>([]);
  const [apps, setApps] = useState<NASApp[]>([]);
  const [documents, setDocuments] = useState<NASFileAsset[]>([]);
  const [images, setImages] = useState<NASFileAsset[]>([]);
  const [videos, setVideos] = useState<NASFileAsset[]>([]);
  const [albums, setAlbums] = useState<NASAlbum[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NASSearchHit[]>([]);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [hasSearchResult, setHasSearchResult] = useState(false);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const didAutoStartRef = useRef(false);

  const libraryParam = searchParams.get("library");
  const activeLibrary = isLibraryKey(libraryParam) ? libraryParam : "computer";
  const libraries = useMemo(() => buildLibraries(copy), [copy]);
  const activeMeta = libraries.find((item) => item.key === activeLibrary)!;

  const stats = useMemo(() => {
    const files = sources.reduce((sum, source) => sum + source.file_count, 0);
    const chunks = sources.reduce((sum, source) => sum + source.chunk_count, 0);
    return { files, chunks, sources: sources.length };
  }, [sources]);

  const refreshNAS = useCallback(async () => {
    try {
      // Manifest, policy and sources define whether the knowledge service is
      // usable.  Apps/media are optional capabilities; one unavailable lane
      // must not make the whole knowledge base look offline.
      const [nextManifest, nextPolicy, nextSources] = await Promise.all([
        getNASManifest(),
        getNASPolicy(),
        listNASSources(),
      ]);
      const [nextApps, nextDocuments, nextImages, nextVideos, nextAlbums] =
        await Promise.allSettled([
          listNASApps(),
          listNASFiles("document"),
          listNASFiles("image"),
          listNASFiles("video"),
          listNASAlbums(),
        ]);
      setManifest(nextManifest);
      setPolicy(nextPolicy);
      setSources(nextSources);
      setApps(nextApps.status === "fulfilled" ? nextApps.value : []);
      setDocuments(
        nextDocuments.status === "fulfilled" ? nextDocuments.value : [],
      );
      setImages(nextImages.status === "fulfilled" ? nextImages.value : []);
      setVideos(nextVideos.status === "fulfilled" ? nextVideos.value : []);
      setAlbums(nextAlbums.status === "fulfilled" ? nextAlbums.value : []);
      setServiceError(null);
      return true;
    } catch (error) {
      setManifest(null);
      setSources([]);
      setApps([]);
      setDocuments([]);
      setImages([]);
      setVideos([]);
      setAlbums([]);
      const isNetworkError =
        error instanceof TypeError &&
        /Failed to fetch|NetworkError|network error/i.test(error.message);
      setServiceError(
        isNASAuthenticationError(error)
          ? copy.service.credentialsExpired
          : isNetworkError
            ? copy.service.networkError
            : isNASUnavailableError(error)
              ? copy.service.unavailable
              : serviceErrorMessage(error),
      );
      return false;
    }
  }, [copy]);

  const ensureNASService = useCallback(async () => {
    const startResult = await startNASService();
    if (startResult.status === "not_found") {
      setServiceError(copy.service.notFound);
      return false;
    }
    if (startResult.status === "error") {
      setServiceError(copy.service.startFailed);
      return false;
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await refreshNAS()) return true;
      await delay(500);
    }
    setServiceError(fill(copy.service.notConnected, { url: getNASBaseURL() }));
    return false;
  }, [copy, refreshNAS]);

  useEffect(() => {
    const init = async () => {
      if (await refreshNAS()) {
        return;
      }
      if (didAutoStartRef.current) return;
      didAutoStartRef.current = true;
      try {
        await ensureNASService();
      } catch (error) {
        const isNetworkError =
          error instanceof TypeError &&
          /Failed to fetch|NetworkError|network error/i.test(error.message);
        if (isNetworkError) {
          setServiceError(copy.service.networkError);
        }
      }
    };
    void init();
  }, [copy.service.networkError, ensureNASService, refreshNAS]);

  useEffect(() => {
    const reconnect = () => {
      if (document.visibilityState === "visible") {
        void refreshNAS();
      }
    };
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      window.removeEventListener("focus", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [refreshNAS]);

  const addSource = async (path: string) => {
    const cleanPath = path.trim();
    if (!cleanPath) return;
    await createNASSource(cleanPath);
    await refreshNAS();
  };

  const pickFolder = async () => {
    setIsPickingFolder(true);
    try {
      const selected = await pickLocalDirectory();
      if (selected) await addSource(selected);
    } catch (err) {
      setServiceError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPickingFolder(false);
    }
  };

  const reconnectNAS = async () => {
    if (isReconnecting) return;
    setIsReconnecting(true);
    setServiceError(null);
    try {
      await ensureNASService();
    } catch (error) {
      if (!(await refreshNAS())) {
        const isNetworkError =
          error instanceof TypeError &&
          /Failed to fetch|NetworkError|network error/i.test(error.message);
        setServiceError(
          isNetworkError
            ? copy.service.networkError
            : error instanceof Error
              ? error.message
              : String(error),
        );
      }
    } finally {
      setIsReconnecting(false);
    }
  };

  const removeSource = async (id: string) => {
    await deleteNASSource(id);
    await refreshNAS();
  };

  const startIndexing = async () => {
    setIsIndexing(true);
    setServiceError(null);
    try {
      const job = await createNASIndexJob();
      toast.success("扫描任务已开始");
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const current = await getNASIndexJob(job.job_id);
        if (current.status === "complete") {
          await refreshNAS();
          toast.success("知识库扫描完成");
          return;
        }
        if (current.status === "failed") {
          throw new Error(current.message || "知识库扫描失败");
        }
        await delay(500);
      }
      throw new Error("扫描仍在后台运行，可稍后刷新查看结果");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setServiceError(message);
      toast.error(message);
    } finally {
      setIsIndexing(false);
    }
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setServiceError(null);
    try {
      const result = await searchNAS(query.trim());
      setHits(result.hits);
      setSearchMessage(result.message);
      setHasSearchResult(true);
    } catch (error) {
      setHits([]);
      setSearchMessage(null);
      setHasSearchResult(false);
      setServiceError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearchResult = () => {
    setHasSearchResult(false);
    setHits([]);
    setSearchMessage(null);
  };

  const togglePrivacy = async () => {
    const mode = policy.mode === "privacy" ? "efficiency" : "privacy";
    const next = await updateNASPolicy({ ...policy, mode });
    setPolicy(next);
  };

  return (
    <WorkspaceContainer className="px-0 pb-0 md:px-0">
      <WorkspaceBody className="overflow-hidden pt-0">
        <div className="flex size-full overflow-hidden">
          <section className="workspace-panel flex min-h-0 flex-1 overflow-hidden rounded-none border-0 bg-card">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
              {/* An optional service being offline is state, not risk: no
                  warning amber (BRAND.md reserves it for approval/risk). */}
              {serviceError && (
                <div
                  role="status"
                  className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground"
                >
                  <span className="flex min-w-0 flex-1 items-start gap-2 break-words">
                    <DatabaseIcon
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0"
                      strokeWidth={1.5}
                    />
                    {serviceError}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 rounded-md px-3"
                    onClick={() => void reconnectNAS()}
                    disabled={isReconnecting}
                  >
                    <RefreshCwIcon
                      className={cn(
                        "size-3.5",
                        isReconnecting && "animate-spin",
                      )}
                    />
                    {isReconnecting
                      ? copy.toolbar.reconnecting
                      : copy.toolbar.reconnect}
                  </Button>
                </div>
              )}

              {activeLibrary !== "sources" && (
                <div className="flex shrink-0 items-center justify-end gap-1.5 border-b border-border bg-muted px-3 py-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 rounded-md bg-card px-2 text-xs shadow-[var(--shadow-xs)]"
                    onClick={pickFolder}
                    disabled={isPickingFolder}
                  >
                    <FolderPlusIcon className="size-3.5" />
                    {copy.toolbar.authorize}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 rounded-md bg-card px-2 text-xs shadow-[var(--shadow-xs)]"
                    onClick={startIndexing}
                    disabled={isIndexing || !manifest}
                  >
                    <RefreshCwIcon
                      className={cn("size-3.5", isIndexing && "animate-spin")}
                    />
                    {copy.toolbar.scan}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-md px-2 text-xs text-muted-foreground"
                    onClick={() => void togglePrivacy()}
                    disabled={!manifest}
                  >
                    {policy.mode === "privacy" ? (
                      <LockKeyholeIcon className="size-3.5" />
                    ) : (
                      <ServerIcon className="size-3.5" />
                    )}
                    {policy.mode === "privacy"
                      ? copy.toolbar.privacy
                      : copy.toolbar.efficiency}
                  </Button>
                  <span className="ml-1 flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        manifest ? "bg-success" : "bg-warning",
                      )}
                    />
                    <span>
                      {manifest ? copy.toolbar.online : copy.toolbar.offline}
                    </span>
                  </span>
                </div>
              )}

              {activeLibrary === "sources" ? (
                <SourcesView
                  sources={sources}
                  stats={stats}
                  manifest={manifest}
                  serviceError={serviceError}
                  isPickingFolder={isPickingFolder}
                  isReconnecting={isReconnecting}
                  onPickFolder={pickFolder}
                  onReconnect={() => void reconnectNAS()}
                  onScan={() => void startIndexing()}
                  onTogglePrivacy={() => void togglePrivacy()}
                  isIndexing={isIndexing}
                  policy={policy}
                  onRemoveSource={removeSource}
                />
              ) : hasSearchResult ? (
                <SearchResultsView
                  hits={hits}
                  query={query}
                  setQuery={setQuery}
                  runSearch={runSearch}
                  isSearching={isSearching}
                  manifest={manifest}
                  message={searchMessage}
                  libraryLabel={activeMeta.label}
                  onBack={clearSearchResult}
                />
              ) : activeLibrary === "computer" ? (
                <LocalDiskView
                  query={query}
                  setQuery={setQuery}
                  runSearch={runSearch}
                  isSearching={isSearching}
                  manifest={manifest}
                />
              ) : activeLibrary === "apps" ? (
                <AppsView
                  apps={apps}
                  query={query}
                  setQuery={setQuery}
                  runSearch={runSearch}
                  isSearching={isSearching}
                  manifest={manifest}
                />
              ) : (
                <TopicCenterView
                  documents={documents}
                  images={images}
                  videos={videos}
                  albums={albums}
                  activeLibrary={activeLibrary}
                  activeMeta={activeMeta}
                  query={query}
                  setQuery={setQuery}
                  runSearch={runSearch}
                  isSearching={isSearching}
                  manifest={manifest}
                  searchMessage={searchMessage}
                />
              )}
            </div>
          </section>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
