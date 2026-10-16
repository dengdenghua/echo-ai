import {
  ChevronDownIcon,
  Loader2Icon,
  RefreshCwIcon,
  ServerIcon,
} from "lucide-react";
import type {
  ComponentProps,
  Dispatch,
  MouseEvent as ReactMouseEvent,
  RefObject,
  SetStateAction,
} from "react";

import { TaskBrowserStart } from "@/components/browser/task-browser-start";
import type { BrowserTab } from "@/components/browser/browser-store";
import {
  WebviewTab,
  type WebviewTabHandle,
} from "@/components/browser/webview-tab";
import type { DetectedLocalService } from "@/core/browser/local-services";
import type { Translations } from "@/core/i18n/locales";
import { cn } from "@/lib/utils";

import type { PageInfo } from "./browser-preview-api";
import type {
  DEVICE_PREVIEW_PRESETS,
  DevicePreviewPreset,
  ScreenshotPointerPoint,
} from "./browser-preview-model";
import { LIVE_PREVIEW_SANDBOX } from "./browser-preview-url";

/** The preview canvas: the live page (webview or iframe), the operable
 *  screenshot with its markers, or the start page with local services. */
export function BrowserPreviewSurface({
  t,
  effectiveSurfaceMode,
  devicePreview,
  deviceFrameKind,
  activeDevicePreview,
  electronLiveSurface,
  liveFrameLoaded,
  setLiveFrameLoaded,
  liveTab,
  setLiveTab,
  liveWebviewRef,
  livePreviewUrl,
  currentViewportLabel,
  pageInfo,
  screenshot,
  setScreenshot,
  hasOpenPage,
  fitPreview,
  screenshotSize,
  annotationMode,
  annotationPoints,
  pointerMode,
  hoverPoint,
  setHoverPoint,
  clickMarker,
  handleAnnotateScreenshot,
  handleScreenshotPointer,
  handleScreenshotHover,
  renderStartPage,
  handleNavigate,
  recentPages,
  detectedServices,
  localServicesExpanded,
  setLocalServicesExpanded,
  handleRescanPorts,
  scanningPorts,
  handleQuickNavigate,
}: {
  t: Translations;
  effectiveSurfaceMode: "screenshot" | "live";
  devicePreview: DevicePreviewPreset;
  deviceFrameKind: "desktop" | "phone" | "tablet";
  activeDevicePreview: (typeof DEVICE_PREVIEW_PRESETS)[DevicePreviewPreset];
  electronLiveSurface: boolean;
  liveFrameLoaded: boolean;
  setLiveFrameLoaded: Dispatch<SetStateAction<boolean>>;
  liveTab: BrowserTab;
  setLiveTab: Dispatch<SetStateAction<BrowserTab>>;
  liveWebviewRef: RefObject<WebviewTabHandle | null>;
  livePreviewUrl: string;
  currentViewportLabel: string;
  pageInfo: PageInfo;
  screenshot: string;
  setScreenshot: Dispatch<SetStateAction<string>>;
  hasOpenPage: boolean;
  fitPreview: boolean;
  screenshotSize: { width: number; height: number };
  annotationMode: boolean;
  annotationPoints: Array<{ x: number; y: number }>;
  pointerMode: "click" | "double";
  hoverPoint: ScreenshotPointerPoint | null;
  setHoverPoint: Dispatch<SetStateAction<ScreenshotPointerPoint | null>>;
  clickMarker: ScreenshotPointerPoint | null;
  handleAnnotateScreenshot: (event: ReactMouseEvent<HTMLImageElement>) => void;
  handleScreenshotPointer: (
    event: ReactMouseEvent<HTMLImageElement>,
  ) => Promise<void>;
  handleScreenshotHover: (event: ReactMouseEvent<HTMLImageElement>) => void;
  renderStartPage?: ComponentProps<typeof TaskBrowserStart>["renderHome"];
  handleNavigate: (input?: string) => Promise<void>;
  recentPages: PageInfo[];
  detectedServices: DetectedLocalService[];
  localServicesExpanded: boolean;
  setLocalServicesExpanded: Dispatch<SetStateAction<boolean>>;
  handleRescanPorts: () => void;
  scanningPorts: boolean;
  handleQuickNavigate: (url: string) => Promise<void>;
}) {
  const bp = t.browserPreviewPanel;
  return effectiveSurfaceMode === "live" ? (
    <div className="flex min-h-full items-start justify-center">
      <div
        className={cn(
          "relative overflow-hidden bg-background",
          devicePreview === "desktop"
            ? "w-full"
            : "border-[5px] border-foreground/80",
          deviceFrameKind === "tablet" && "max-h-full rounded-4xl",
          deviceFrameKind === "phone" && "max-h-full rounded-4xl",
        )}
        style={{
          aspectRatio:
            devicePreview === "desktop"
              ? undefined
              : `${activeDevicePreview.width} / ${activeDevicePreview.height}`,
          maxWidth:
            devicePreview === "desktop"
              ? undefined
              : deviceFrameKind === "tablet"
                ? 420
                : 240,
          width: devicePreview === "desktop" ? "100%" : "70%",
          minHeight: devicePreview === "desktop" ? "100%" : undefined,
        }}
      >
        {!electronLiveSurface && !liveFrameLoaded && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/70">
            <div className="flex items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-[var(--shadow-xs)]">
              <Loader2Icon className="size-3.5 animate-spin text-primary" />
              {bp.loadingLivePage}
            </div>
          </div>
        )}
        {electronLiveSurface ? (
          <WebviewTab
            key={liveTab.id}
            tab={liveTab}
            active
            onPatch={(patch) => setLiveTab((prev) => ({ ...prev, ...patch }))}
            ref={liveWebviewRef}
          />
        ) : (
          <iframe
            key={`${livePreviewUrl}-${currentViewportLabel}`}
            src={livePreviewUrl}
            title={pageInfo.title || livePreviewUrl || "Live browser preview"}
            className="size-full border-0 bg-background"
            sandbox={LIVE_PREVIEW_SANDBOX}
            onLoad={() => setLiveFrameLoaded(true)}
            allow="clipboard-read; clipboard-write; fullscreen"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
      </div>
    </div>
  ) : screenshot && hasOpenPage ? (
    <div className="flex min-h-full items-start justify-center">
      <div
        className={cn(
          "relative overflow-hidden bg-background",
          devicePreview === "desktop"
            ? "w-full"
            : "border-[5px] border-foreground/80",
          deviceFrameKind === "tablet" && "max-h-full rounded-4xl",
          deviceFrameKind === "phone" && "max-h-full rounded-4xl",
        )}
        style={{
          aspectRatio:
            devicePreview === "desktop"
              ? undefined
              : `${activeDevicePreview.width} / ${activeDevicePreview.height}`,
          maxWidth:
            devicePreview === "desktop"
              ? fitPreview
                ? `min(100%, ${(100 * screenshotSize.width) / Math.max(1, screenshotSize.height)}cqh)`
                : undefined
              : deviceFrameKind === "tablet"
                ? 420
                : 240,
          width: devicePreview === "desktop" ? "100%" : "70%",
        }}
      >
        <img
          src={`data:image/png;base64,${screenshot}`}
          alt={t.browser.browserAutomation}
          className={cn(
            "size-full",
            devicePreview === "desktop"
              ? "object-contain"
              : "object-cover object-left-top",
          )}
          onClick={(event) => {
            if (annotationMode) {
              handleAnnotateScreenshot(event);
            } else {
              void handleScreenshotPointer(event);
            }
          }}
          onError={() => setScreenshot("")}
          onMouseMove={handleScreenshotHover}
          onMouseLeave={() => setHoverPoint(null)}
          title={bp.screenshotClickTitle(
            pointerMode === "double" ? bp.doubleClickMode : bp.clickMode,
            currentViewportLabel,
          )}
          style={{ cursor: "crosshair" }}
        />
        {annotationPoints.map((point, index) => (
          <div
            key={`${point.x}-${point.y}-${index}`}
            className="pointer-events-none absolute z-30 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-primary bg-primary/20 text-xs font-bold text-primary shadow-[var(--shadow-xs)]"
            style={{
              left: `${(point.x / screenshotSize.width) * 100}%`,
              top: `${(point.y / screenshotSize.height) * 100}%`,
            }}
          >
            {index + 1}
          </div>
        ))}
        {hoverPoint && screenshotSize.width > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-2 z-30 rounded-full border border-border-default bg-background/88 px-2 py-1 font-mono text-xs text-muted-foreground shadow-[var(--shadow-xs)] backdrop-blur">
            x {hoverPoint.x} · y {hoverPoint.y}
          </div>
        )}
        {clickMarker && screenshotSize.width > 0 && (
          <div
            className="pointer-events-none absolute z-30 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center"
            style={{
              left: `${(clickMarker.x / screenshotSize.width) * 100}%`,
              top: `${(clickMarker.y / screenshotSize.height) * 100}%`,
            }}
          >
            <span className="absolute size-9 rounded-full border border-primary/40 bg-primary/10 animate-ping" />
            <span className="grid size-5 place-items-center rounded-full border border-primary/55 bg-background/90 text-micro font-bold text-primary shadow-[var(--shadow-xs)]">
              {clickMarker.mode === "double" ? "2x" : "1x"}
            </span>
          </div>
        )}
      </div>
    </div>
  ) : (
    <div className="h-full overflow-y-auto">
      {!hasOpenPage ? (
        <TaskBrowserStart
          renderHome={renderStartPage}
          onNavigate={(value) => void handleNavigate(value)}
          recentPages={recentPages}
        >
          {/* 本地服务快速入口 */}
          {detectedServices.length > 0 ? (
            <div className="w-full space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-expanded={localServicesExpanded}
                  onClick={() => setLocalServicesExpanded((value) => !value)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <div className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
                    <ServerIcon className="size-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    {bp.localServices}
                  </span>
                  <ChevronDownIcon
                    className={cn(
                      "ml-auto size-3.5 text-muted-foreground transition-transform",
                      !localServicesExpanded && "-rotate-90",
                    )}
                  />
                </button>
                <button
                  type="button"
                  onClick={handleRescanPorts}
                  disabled={scanningPorts}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-border-default px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
                >
                  {scanningPorts ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="size-3" />
                  )}
                  {bp.scanButton}
                </button>
              </div>
              {localServicesExpanded && (
                <div className="space-y-1.5">
                  {detectedServices.map((svc) => (
                    <button
                      key={svc.port}
                      onClick={() => handleQuickNavigate(svc.url)}
                      className="group flex w-full items-center gap-3 border-b border-border-subtle px-3 py-2 text-left transition-colors hover:bg-muted/40"
                    >
                      <div
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-bold transition-transform group-hover:scale-[1.03]",
                          svc.type === "frontend"
                            ? "bg-info/10 text-info"
                            : svc.type === "backend"
                              ? "bg-success/10 text-success"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {svc.port}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {svc.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          localhost:{svc.port}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                          svc.type === "frontend"
                            ? "bg-info/10 text-info"
                            : svc.type === "backend"
                              ? "bg-success/10 text-success"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {svc.type === "frontend"
                          ? bp.serviceTypeFrontend
                          : svc.type === "backend"
                            ? bp.serviceTypeBackend
                            : bp.serviceTypeOther}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleRescanPorts}
              disabled={scanningPorts}
              className="flex h-8 items-center gap-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <ServerIcon className="size-3.5" />
              {scanningPorts ? "扫描中…" : bp.scanLocalServices}
            </button>
          )}
        </TaskBrowserStart>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          等待网页画面…
        </div>
      )}
    </div>
  );
}
