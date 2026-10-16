import type { TaskBrowserStart } from "@/components/browser/task-browser-start";
import {
  CheckIcon,
  GlobeIcon,
  Loader2Icon,
  PencilIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { swallow } from "@/core/utils/log";
import { createEchoBrowserSessionIdentity } from "@/core/browser/api";
import type { DetectedLocalService } from "@/core/browser/local-services";
import { useI18n } from "@/core/i18n/hooks";
import { BROWSER_WORKSPACE_ROUTE } from "@/core/workspace/sidebar-routing";
import { cn } from "@/lib/utils";
import {
  AUTOMATION_CAPSULE_CONTROLS_CLASS_NAME,
  AUTOMATION_CAPSULE_OVERLAY_CLASS_NAME,
  AUTOMATION_CAPSULE_SURFACE_CLASS_NAME,
} from "@/components/ui/automation-capsule";
import {
  BROWSER_OPEN_URL_REQUEST_KEY,
  type BrowserOpenUrlRequest,
  type BrowserTab,
} from "@/components/browser/browser-store";
import type { WebviewTabHandle } from "@/components/browser/webview-tab";

import {
  actionCoordinatePoint,
  actionEntryKey,
  BrowserActionLogPanel,
} from "./browser-preview-action-log";
import {
  browserApi,
  type ActionLogEntry,
  type BrowserSemanticSnapshot,
  type BrowserSession,
  type BrowserSessionHealth,
  type PageInfo,
} from "./browser-preview-api";
import {
  browserTabDeviceForPreset,
  DEVICE_PREVIEW_PRESETS,
  type DevicePreviewPreset,
  type PreviewSurfaceMode,
  type ScreenshotPointerPoint,
} from "./browser-preview-model";
import { BrowserPreviewSurface } from "./browser-preview-surface";
import { BrowserPreviewToolbar } from "./browser-preview-toolbar";
import { normalizePreviewUrl } from "./browser-preview-url";
import {
  useBrowserPreviewNavigation,
  useBrowserPreviewSession,
} from "./use-browser-preview-session";
import {
  useBrowserPreviewPointer,
  useScreenshotAnnotation,
} from "./use-browser-preview-screenshot";

export { BrowserPreviewToolbar } from "./browser-preview-toolbar";

// ---------------------------------------------------------------------------
// BrowserPreviewPanel
// ---------------------------------------------------------------------------

interface BrowserPreviewPanelProps {
  threadId: string;
  workspacePath?: string | null;
  /** Seed the panel with a URL to load on mount — lets the live-preview panel
   * delegate its URL mode here (and the agent regression preview point at it)
   * so there is one controllable URL-preview surface. Additive: when unset the
   * panel behaves exactly as before. */
  initialUrl?: string;
  className?: string;
  sharedSessionId?: string;
  onReturnToTask?: () => void;
  searchEngineUrl?: string;
  renderStartPage?: React.ComponentProps<typeof TaskBrowserStart>["renderHome"];
  onPageInfoChange?: (page: PageInfo) => void;
}

export function BrowserPreviewPanel({
  threadId,
  workspacePath,
  initialUrl,
  className,
  sharedSessionId,
  onReturnToTask,
  searchEngineUrl,
  renderStartPage,
  onPageInfoChange,
}: BrowserPreviewPanelProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [returnedSessionId] = useState(() => {
    try {
      const key = `echo:browser-return:${location.pathname}`;
      const value = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      return value;
    } catch {
      return null;
    }
  });
  const { t } = useI18n();
  const bp = t.browserPreviewPanel;
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ url: "", title: "" });
  const [screenshot, setScreenshot] = useState<string>("");
  const [screenshotSize, setScreenshotSize] = useState({ width: 0, height: 0 });
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [selectedActionKey, setSelectedActionKey] = useState<string | null>(
    null,
  );
  const [sessionHealth, setSessionHealth] =
    useState<BrowserSessionHealth | null>(null);
  const [actionLogExpanded, setActionLogExpanded] = useState(false);
  const [urlInput, setUrlInput] = useState(initialUrl ?? "");
  const [loading, setLoading] = useState(true);
  const [viewportChanging, setViewportChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [detectedServices, setDetectedServices] = useState<
    DetectedLocalService[]
  >([]);
  const [localServicesExpanded, setLocalServicesExpanded] = useState(false);
  const [scanningPorts, setScanningPorts] = useState(false);
  const [semanticSnapshot, setSemanticSnapshot] =
    useState<BrowserSemanticSnapshot | null>(null);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotationText, setAnnotationText] = useState("");
  const [annotationPoints, setAnnotationPoints] = useState<
    Array<{ x: number; y: number }>
  >([]);
  const [pointerMode] = useState<"click" | "double">("click");
  const [hoverPoint, setHoverPoint] = useState<ScreenshotPointerPoint | null>(
    null,
  );
  const [clickMarker, setClickMarker] = useState<ScreenshotPointerPoint | null>(
    null,
  );
  const [surfaceMode, setSurfaceMode] =
    useState<PreviewSurfaceMode>("screenshot");
  const [liveFrameLoaded, setLiveFrameLoaded] = useState(false);
  const [fitPreview, setFitPreview] = useState(() => {
    try {
      return localStorage.getItem("echo:preview-fit") === "full";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("echo:preview-fit", fitPreview ? "full" : "width");
    } catch {
      /* Optional preference. */
    }
  }, [fitPreview]);
  const [devicePreview, setDevicePreview] =
    useState<DevicePreviewPreset>("desktop");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const clickMarkerTimeoutRef = useRef<number | null>(null);

  const sessionIdentity = useMemo(
    () => ({
      ...createEchoBrowserSessionIdentity({ threadId, workspacePath }),
      ...(sharedSessionId || returnedSessionId
        ? { sessionId: sharedSessionId || returnedSessionId! }
        : {}),
    }),
    [threadId, workspacePath, sharedSessionId, returnedSessionId],
  );
  const sessionId = sessionIdentity.sessionId;
  const liveWebviewRef = useRef<WebviewTabHandle | null>(null);
  const [liveTab, setLiveTab] = useState<BrowserTab>(() => ({
    id: `agent-live-${Date.now().toString(36)}`,
    url: "about:blank",
    title: bp.livePreviewTitle,
    isLoading: false,
    device: "desktop",
  }));
  const {
    applySessionSnapshot,
    refreshSessionStatus,
    refreshBrowserArtifacts,
    handleRescanPorts,
    handleQuickNavigate,
  } = useBrowserPreviewSession({
    session,
    sessionId,
    sessionIdentity,
    setSession,
    setDevicePreview,
    setPageInfo,
    setUrlInput,
    setScreenshot,
    setScreenshotSize,
    setActionLog,
    setSessionHealth,
    setLoading,
    setError,
    setScanningPorts,
    setDetectedServices,
  });

  // Auto-refresh screenshot
  useEffect(() => {
    if (autoRefresh && session) {
      intervalRef.current = setInterval(async () => {
        try {
          const [shotData, info, logData, healthData] = await Promise.all([
            browserApi.screenshotBase64(sessionId),
            browserApi.pageInfo(sessionId),
            browserApi.actionLog(sessionId),
            browserApi.sessionHealth(sessionId),
          ]);
          setScreenshot(shotData.base64);
          setScreenshotSize({ width: shotData.width, height: shotData.height });
          setPageInfo(info);
          setActionLog(logData.actions);
          setSessionHealth(healthData);
          void refreshSessionStatus().catch((e) => {
            swallow(e);
          });
        } catch (e) {
          swallow(e);
        }
      }, 2000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, refreshSessionStatus, session, sessionId]);

  // Scroll action log to bottom on update
  useEffect(() => {
    if (!actionLogExpanded) return;
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [actionLog.length, actionLogExpanded]);

  useEffect(() => {
    setLiveFrameLoaded(false);
  }, [pageInfo.url, urlInput]);

  useEffect(
    () => () => {
      if (clickMarkerTimeoutRef.current) {
        clearTimeout(clickMarkerTimeoutRef.current);
      }
    },
    [],
  );

  const {
    handleLaunch,
    handleNavigate,
    handleRetry,
    handleRefreshScreenshot,
    handleAttachScreenshotToComposer,
  } = useBrowserPreviewNavigation({
    session,
    sessionId,
    sessionIdentity,
    urlInput,
    searchEngineUrl,
    screenshot,
    pageInfo,
    threadId,
    bp,
    applySessionSnapshot,
    refreshBrowserArtifacts,
    refreshSessionStatus,
    setLoading,
    setError,
    setPageInfo,
    setUrlInput,
    setScreenshot,
    setScreenshotSize,
    setActionLog,
    setSessionHealth,
  });

  const { handleAnnotateScreenshot, handleSendAnnotation } =
    useScreenshotAnnotation({
      annotationMode,
      annotationPoints,
      annotationText,
      pageInfo,
      screenshot,
      screenshotSize,
      semanticSnapshot,
      session,
      sessionIdentity,
      urlInput,
      threadId,
      setAnnotationMode,
      setAnnotationPoints,
      setAnnotationText,
      setSemanticSnapshot,
    });

  const handleBack = useCallback(async () => {
    if (!session) return;
    try {
      const data = await browserApi.action(sessionIdentity, "back");
      if (data.url)
        setPageInfo({
          url: data.url as string,
          title: (data.title as string) || "",
        });
      setUrlInput((data.url as string) || "");
      await handleRefreshScreenshot();
    } catch (e) {
      swallow(e);
    }
  }, [session, sessionIdentity, handleRefreshScreenshot]);

  const handleForward = useCallback(async () => {
    if (!session) return;
    try {
      const data = await browserApi.action(sessionIdentity, "forward");
      if (data.url)
        setPageInfo({
          url: data.url as string,
          title: (data.title as string) || "",
        });
      setUrlInput((data.url as string) || "");
      await handleRefreshScreenshot();
    } catch (e) {
      swallow(e);
    }
  }, [session, sessionIdentity, handleRefreshScreenshot]);

  const handleReload = useCallback(async () => {
    if (!session) return;
    try {
      const data = await browserApi.action(sessionIdentity, "reload");
      if (data.url)
        setPageInfo({
          url: data.url as string,
          title: (data.title as string) || "",
        });
      await handleRefreshScreenshot();
    } catch (e) {
      swallow(e);
    }
  }, [session, sessionIdentity, handleRefreshScreenshot]);

  const {
    handleDevicePreviewChange,
    handleScreenshotPointer,
    handleScreenshotHover,
    focusActionEntry,
  } = useBrowserPreviewPointer({
    session,
    sessionIdentity,
    screenshotSize,
    pointerMode,
    clickMarkerTimeoutRef,
    applySessionSnapshot,
    refreshBrowserArtifacts,
    handleRefreshScreenshot,
    setDevicePreview,
    setViewportChanging,
    setError,
    setClickMarker,
    setLoading,
    setHoverPoint,
    setSelectedActionKey,
    setActionLogExpanded,
  });

  const handleClose = useCallback(async () => {
    try {
      await browserApi.reset(sessionIdentity);
      setSession(null);
      setScreenshot("");
      setPageInfo({ url: "", title: "" });
      setActionLog([]);
      setSelectedActionKey(null);
      setSessionHealth(null);
      setAutoRefresh(false);
    } catch (e) {
      swallow(e);
    }
  }, [sessionIdentity]);

  const openInFullBrowser = useCallback(() => {
    const target = pageInfo.url || "about:blank";
    if (target) {
      try {
        const request: BrowserOpenUrlRequest = {
          url: target,
          title:
            target === "about:blank" ? "新标签页" : (pageInfo.title || target),
          device: browserTabDeviceForPreset(devicePreview),
          source: "agent-preview",
          sessionId,
          taskPreview: {
            threadId,
            workspacePath,
            sessionId,
            returnRoute: location.pathname + location.search,
          },
        };
        localStorage.setItem(
          BROWSER_OPEN_URL_REQUEST_KEY,
          JSON.stringify(request),
        );
      } catch (e) {
        swallow(e);
      }
    }
    navigate(BROWSER_WORKSPACE_ROUTE);
  }, [
    devicePreview,
    pageInfo.title,
    pageInfo.url,
    sessionId,
    threadId,
    workspacePath,
    navigate,
    location.pathname,
    location.search,
  ]);

  const runtimeLabel = session?.runtime || session?.mode || "未连接";
  const sessionHealthy =
    !/mock|未连接/.test(runtimeLabel) &&
    (sessionHealth?.healthy ?? session?.healthy) === true;
  const sessionIssues = (sessionHealth?.issues ?? []).filter(
    (issue) => issue !== "no_actions_recorded",
  );
  const sessionIdle =
    sessionHealth?.issues?.includes("no_actions_recorded") === true &&
    sessionIssues.length === 0;
  const visibleActions = actionLog.slice(-20);
  const visibleActionStartIndex = actionLog.length - visibleActions.length;
  const actionFailureCount = actionLog.filter(
    (entry) => entry.status && entry.status !== "ok",
  ).length;
  const actionCoordinateCount = actionLog.filter((entry) =>
    Boolean(actionCoordinatePoint(entry)),
  ).length;
  const selectedAction =
    selectedActionKey == null
      ? null
      : (actionLog
          .map((entry, index) => ({ entry, index }))
          .find(
            ({ entry, index }) =>
              actionEntryKey(entry, index) === selectedActionKey,
          ) ?? null);
  const activeDevicePreview = DEVICE_PREVIEW_PRESETS[devicePreview];
  const deviceFrameKind =
    devicePreview === "desktop"
      ? "desktop"
      : activeDevicePreview.width <= 540
        ? "phone"
        : "tablet";
  const currentViewportLabel = `${activeDevicePreview.width}x${activeDevicePreview.height}`;
  const livePreviewUrl = normalizePreviewUrl(pageInfo.url || urlInput);
  const canLivePreview = Boolean(livePreviewUrl);
  const effectiveSurfaceMode =
    surfaceMode === "live" && canLivePreview ? "live" : "screenshot";
  const hasOpenPage = Boolean(
    (pageInfo.url || session?.current_url || "").trim() &&
    (pageInfo.url || session?.current_url) !== "about:blank",
  );
  const electronLiveSurface =
    typeof window !== "undefined" && Boolean(window.echo?.isElectron);

  useEffect(() => {
    if (!livePreviewUrl) return;
    setLiveTab((prev) => ({
      ...prev,
      url: livePreviewUrl,
      title: pageInfo.title || livePreviewUrl,
      isLoading: false,
      device: browserTabDeviceForPreset(devicePreview),
    }));
  }, [devicePreview, livePreviewUrl, pageInfo.title]);

  // Seed-and-load an externally supplied URL (initialUrl). Fires once per
  // distinct URL: ensures the session and navigates, so a caller that delegates
  // its preview here (live-preview-panel URL mode, agent regression preview)
  // loads that page in this one controllable surface. Inert when initialUrl is
  // unset, so existing callers are unaffected.
  const initialUrlLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    const target = (initialUrl ?? "").trim();
    if (!target || initialUrlLoadedRef.current === target) return;
    initialUrlLoadedRef.current = target;
    let url = target;
    if (!/^https?:\/\//i.test(url) && !url.startsWith("about:")) {
      url = "https://" + url;
    }
    setUrlInput(url);
    void (async () => {
      try {
        const data = await browserApi.ensure(sessionIdentity);
        applySessionSnapshot(data.session);
        const info = await browserApi.navigate(sessionIdentity, url);
        setPageInfo(info);
        setUrlInput(info.url);
      } catch (err) {
        swallow(err);
      }
    })();
  }, [initialUrl, sessionIdentity, applySessionSnapshot]);

  const [recentPages, setRecentPages] = useState<PageInfo[]>([]);
  const onPageInfoChangeRef = useRef(onPageInfoChange);
  onPageInfoChangeRef.current = onPageInfoChange;
  // Navigation (url / title) is the trigger; other page-info fields such as
  // loading state must not re-announce the page or reorder recents.
  const pageInfoRef = useRef(pageInfo);
  pageInfoRef.current = pageInfo;
  useEffect(() => { onPageInfoChangeRef.current?.(pageInfoRef.current); }, [pageInfo.url, pageInfo.title]);
  useEffect(() => { setRecentPages([]); }, [sessionId]);
  useEffect(() => {
    const current = pageInfoRef.current;
    if (!/^https?:\/\//i.test(current.url)) return;
    setRecentPages(previous => [current, ...previous.filter(page => page.url !== current.url)].slice(0, 6));
  }, [pageInfo.url, pageInfo.title]);

  // ----- Render ------------------------------------------------------------

  // Starting state
  if (!session) {
    return (
      <div
        className={cn(
          "relative flex h-full flex-col items-center justify-center overflow-hidden bg-background p-6 text-center",
          className,
        )}
      >
        <div className="absolute inset-x-8 top-6 h-px bg-gradient-to-r from-transparent via-border/70 to-transparent" />
        <div className="grid size-14 place-items-center rounded-lg border border-border-default bg-background/82 shadow-[var(--shadow-xs)] backdrop-blur">
          {loading ? (
            <Loader2Icon className="size-8 animate-spin text-primary" />
          ) : (
            <GlobeIcon className="size-8 text-muted-foreground" />
          )}
        </div>
        <div className="max-w-sm">
          <h3 className="text-sm font-semibold text-foreground">
            {t.browser.browserAutomation}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {loading
              ? t.browser.launchingBrowser
              : t.browser.browserAutomationDesc}
          </p>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
        {!loading && (
          <button
            onClick={handleLaunch}
            disabled={loading}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-[var(--shadow-xs)] transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <PlayIcon className="size-3" />
            )}
            {t.browser.launchBrowser}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <BrowserPreviewToolbar
        urlInput={urlInput}
        onUrlInputChange={setUrlInput}
        onNavigate={() => void handleNavigate()}
        onBack={() => void handleBack()}
        onForward={() => void handleForward()}
        onReload={() => void handleReload()}
        onOpenFullBrowser={onReturnToTask ?? openInFullBrowser}
        returnToTask={Boolean(onReturnToTask)}
        onEndSession={() => void handleClose()}
        canLivePreview={canLivePreview}
        surfaceMode={effectiveSurfaceMode}
        onSurfaceModeChange={setSurfaceMode}
        devicePreview={devicePreview}
        viewportChanging={viewportChanging}
        onDevicePreviewChange={(preset) =>
          void handleDevicePreviewChange(preset)
        }
        onAttachScreenshot={() => void handleAttachScreenshotToComposer()}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        sessionHealthy={sessionHealthy}
        sessionIdle={sessionIdle}
        runtimeLabel={runtimeLabel}
        onToggleActionLog={() => setActionLogExpanded(value => !value)}
        actionFailureCount={actionFailureCount}
      />

      {!error && !sessionHealthy && sessionIssues.length > 0 && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/8 px-2 text-xs text-destructive">
          <span className="relative flex size-4 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <span className="size-1.5 rounded-full bg-destructive" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {bp.sessionNeedsAttention(sessionIssues.join(" · "))}
          </span>
          <button
            type="button"
            onClick={() => void handleLaunch()}
            className="h-5 shrink-0 rounded border border-destructive/25 px-1.5 text-xs font-medium transition-colors hover:bg-destructive/10"
          >
            {bp.reconnectButton}
          </button>
        </div>
      )}

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/25 bg-destructive/8 px-2 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate text-destructive">
            {error}
          </span>
          <button
            type="button"
            onClick={handleRetry}
            className="h-6 shrink-0 rounded-md border border-destructive/25 px-2 font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            重试
          </button>
        </div>
      )}
      {!error && session.launch_error && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          浏览器启动失败，请检查浏览器安装或重试连接。
        </p>
      )}

      {hasOpenPage &&
        !error &&
        (sessionHealthy || sessionIssues.length === 0) && (
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-border-default px-3 text-xs text-muted-foreground">
            <span role="status">
              {loading || viewportChanging
                ? "正在加载…"
                : error || (!sessionHealthy && sessionIssues.length > 0)
                  ? "连接需要检查"
                  : !hasOpenPage
                    ? "尚未打开网页"
                    : effectiveSurfaceMode === "live"
                      ? "实时网页"
                      : autoRefresh
                        ? "截图自动更新中"
                        : "操作画面 · 点击与网页交互"}
            </span>
            {hasOpenPage && effectiveSurfaceMode === "screenshot" && (
              <button
                type="button"
                aria-pressed={fitPreview}
                onClick={() => setFitPreview((value) => !value)}
                className="rounded px-2 py-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                {fitPreview ? "完整画面" : "适应宽度"}
              </button>
            )}
          </div>
        )}
      {/* Screenshot area */}
      <div className="relative min-h-0 flex-1 overflow-auto bg-background [container-type:size] [&::-webkit-scrollbar]:size-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent">
        {screenshot && hasOpenPage && effectiveSurfaceMode === "screenshot" && (
          <div
            className={cn(
              AUTOMATION_CAPSULE_OVERLAY_CLASS_NAME,
              "absolute top-3 right-3 z-40",
            )}
          >
            <button
              type="button"
              aria-pressed={annotationMode}
              onClick={() => {
                setAnnotationMode((value) => !value);
                setAnnotationPoints([]);
              }}
              className={cn(
                AUTOMATION_CAPSULE_CONTROLS_CLASS_NAME,
                AUTOMATION_CAPSULE_SURFACE_CLASS_NAME,
                "flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                annotationMode && "text-primary ring-primary/30",
              )}
              title={bp.annotateScreenshot}
              aria-label={bp.annotateScreenshot}
            >
              <PencilIcon className="size-3.5" />
              <span>{bp.annotationButton}</span>
            </button>
          </div>
        )}
        {annotationMode &&
          screenshot &&
          effectiveSurfaceMode === "screenshot" && (
            <div
              className={cn(
                AUTOMATION_CAPSULE_OVERLAY_CLASS_NAME,
                "absolute inset-x-3 top-14 z-40 flex justify-center",
              )}
            >
              <div
                className={cn(
                  AUTOMATION_CAPSULE_CONTROLS_CLASS_NAME,
                  AUTOMATION_CAPSULE_SURFACE_CLASS_NAME,
                  "flex w-full max-w-2xl items-center gap-2 p-2",
                )}
              >
                <PencilIcon className="size-3.5 shrink-0 text-primary" />
                <input
                  value={annotationText}
                  onChange={(event) => setAnnotationText(event.target.value)}
                  placeholder={bp.annotationPlaceholder}
                  aria-label={bp.annotationInputLabel}
                  className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none"
                />
                <button
                  type="button"
                  disabled={
                    !annotationText.trim() && annotationPoints.length === 0
                  }
                  onClick={() => void handleSendAnnotation()}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <CheckIcon className="size-3.5" />
                  {bp.sendAnnotation}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnnotationMode(false);
                    setAnnotationPoints([]);
                  }}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={bp.cancelAnnotation}
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        <BrowserPreviewSurface
          t={t}
          effectiveSurfaceMode={effectiveSurfaceMode}
          devicePreview={devicePreview}
          deviceFrameKind={deviceFrameKind}
          activeDevicePreview={activeDevicePreview}
          electronLiveSurface={electronLiveSurface}
          liveFrameLoaded={liveFrameLoaded}
          setLiveFrameLoaded={setLiveFrameLoaded}
          liveTab={liveTab}
          setLiveTab={setLiveTab}
          liveWebviewRef={liveWebviewRef}
          livePreviewUrl={livePreviewUrl}
          currentViewportLabel={currentViewportLabel}
          pageInfo={pageInfo}
          screenshot={screenshot}
          setScreenshot={setScreenshot}
          hasOpenPage={hasOpenPage}
          fitPreview={fitPreview}
          screenshotSize={screenshotSize}
          annotationMode={annotationMode}
          annotationPoints={annotationPoints}
          pointerMode={pointerMode}
          hoverPoint={hoverPoint}
          setHoverPoint={setHoverPoint}
          clickMarker={clickMarker}
          handleAnnotateScreenshot={handleAnnotateScreenshot}
          handleScreenshotPointer={handleScreenshotPointer}
          handleScreenshotHover={handleScreenshotHover}
          renderStartPage={renderStartPage}
          handleNavigate={handleNavigate}
          recentPages={recentPages}
          detectedServices={detectedServices}
          localServicesExpanded={localServicesExpanded}
          setLocalServicesExpanded={setLocalServicesExpanded}
          handleRescanPorts={handleRescanPorts}
          scanningPorts={scanningPorts}
          handleQuickNavigate={handleQuickNavigate}
        />
        {(loading || viewportChanging) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2Icon className="text-primary size-6 animate-spin" />
          </div>
        )}
      </div>

      {/* Action Log opens only on demand. */}
      {actionLogExpanded && (
        <BrowserActionLogPanel
          t={t}
          actionLog={actionLog}
          actionLogExpanded={actionLogExpanded}
          setActionLogExpanded={setActionLogExpanded}
          actionFailureCount={actionFailureCount}
          actionCoordinateCount={actionCoordinateCount}
          selectedAction={selectedAction}
          selectedActionKey={selectedActionKey}
          setSelectedActionKey={setSelectedActionKey}
          focusActionEntry={focusActionEntry}
          screenshotSize={screenshotSize}
          pointerMode={pointerMode}
          visibleActions={visibleActions}
          visibleActionStartIndex={visibleActionStartIndex}
          logEndRef={logEndRef}
        />
      )}
    </div>
  );
}
