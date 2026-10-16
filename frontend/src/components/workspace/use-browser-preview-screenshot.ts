// Screenshot interaction callbacks of BrowserPreviewPanel: annotation,
// clicks and hover on the screenshot, the device viewport and locating a
// logged action. Each hook holds a run of hooks that the panel used to
// declare inline, and the panel calls it at the same place, so the panel's
// hook order is unchanged. The panel's state setters and refs arrive as
// arguments, so dependency arrays list them; they keep their identity, so the
// callbacks change exactly as often as before.
import {
  useCallback,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import type { EchoBrowserSessionIdentity } from "@/core/browser/api";
import { swallow } from "@/core/utils/log";

import {
  browserApi,
  dataUrlToFile,
  renderAnnotatedScreenshot,
  type ActionLogEntry,
  type BrowserSemanticSnapshot,
  type BrowserSession,
  type PageInfo,
} from "./browser-preview-api";
import { actionCoordinatePoint } from "./browser-preview-action-log";
import {
  DEVICE_PREVIEW_PRESETS,
  type DevicePreviewPreset,
  type ScreenshotPointerPoint,
} from "./browser-preview-model";

type SetState<T> = Dispatch<SetStateAction<T>>;

/** Marks points on the screenshot and sends the annotated image, with the
 *  page's DOM summary, to the composer. */
export function useScreenshotAnnotation({
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
}: {
  annotationMode: boolean;
  annotationPoints: Array<{ x: number; y: number }>;
  annotationText: string;
  pageInfo: PageInfo;
  screenshot: string;
  screenshotSize: { width: number; height: number };
  semanticSnapshot: BrowserSemanticSnapshot | null;
  session: BrowserSession | null;
  sessionIdentity: EchoBrowserSessionIdentity;
  urlInput: string;
  threadId: string;
  setAnnotationMode: SetState<boolean>;
  setAnnotationPoints: SetState<Array<{ x: number; y: number }>>;
  setAnnotationText: SetState<string>;
  setSemanticSnapshot: SetState<BrowserSemanticSnapshot | null>;
}) {
  const handleAnnotateScreenshot = useCallback(
    (event: ReactMouseEvent<HTMLImageElement>) => {
      if (
        !annotationMode ||
        screenshotSize.width <= 0 ||
        screenshotSize.height <= 0
      ) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      setAnnotationPoints((points) => [
        ...points,
        {
          x: Math.round(
            ((event.clientX - rect.left) / Math.max(1, rect.width)) *
              screenshotSize.width,
          ),
          y: Math.round(
            ((event.clientY - rect.top) / Math.max(1, rect.height)) *
              screenshotSize.height,
          ),
        },
      ]);
    },
    [
      annotationMode,
      screenshotSize.height,
      screenshotSize.width,
      setAnnotationPoints,
    ],
  );

  const handleSendAnnotation = useCallback(async () => {
    if (!screenshot) return;
    let currentSemantic = semanticSnapshot;
    if (session) {
      try {
        currentSemantic = await browserApi.semanticSnapshot(sessionIdentity);
        setSemanticSnapshot(currentSemantic);
      } catch {
        // The screenshot is still useful when the page has no readable DOM.
      }
    }
    const annotatedScreenshot = await renderAnnotatedScreenshot(
      screenshot,
      annotationPoints,
      annotationText,
    );
    const image = await dataUrlToFile(
      annotatedScreenshot,
      `browser-annotation-${Date.now()}.png`,
    );
    const domLines = (currentSemantic?.nodes ?? [])
      .filter((node) => node.name || node.text)
      .slice(0, 40)
      .map(
        (node) =>
          `- <${node.tag}>${node.role ? ` role=${node.role}` : ""}${node.name ? ` name="${node.name}"` : ""}${node.text ? ` text="${node.text}"` : ""}${node.selector ? ` selector="${node.selector}"` : ""}`,
      );
    const points = annotationPoints.length
      ? annotationPoints.map((point) => `(${point.x}, ${point.y})`).join(", ")
      : "未标注坐标";
    const context = [
      "[浏览器页面标注]",
      `页面：${pageInfo.title || "未命名页面"}`,
      `URL：${pageInfo.url || urlInput || "未知"}`,
      `标注坐标：${points}`,
      annotationText.trim() ? `用户备注：${annotationText.trim()}` : "",
      "",
      "[页面 DOM 摘要]",
      ...(domLines.length ? domLines : ["暂无可用 DOM 摘要"]),
    ]
      .filter(Boolean)
      .join("\n");
    window.dispatchEvent(
      new CustomEvent("echo:inject-composer-images", {
        detail: {
          threadId,
          images: image ? [image] : [],
          sourceLabel: "浏览器标注",
          text: context,
        },
      }),
    );
    setAnnotationMode(false);
    setAnnotationText("");
    setAnnotationPoints([]);
  }, [
    annotationPoints,
    annotationText,
    pageInfo.title,
    pageInfo.url,
    screenshot,
    session,
    semanticSnapshot,
    sessionIdentity,
    threadId,
    urlInput,
    setAnnotationMode,
    setAnnotationPoints,
    setAnnotationText,
    setSemanticSnapshot,
  ]);

  return { handleAnnotateScreenshot, handleSendAnnotation };
}

/** Switches the device viewport, clicks and hovers on the screenshot and
 *  locates a logged action on it. */
export function useBrowserPreviewPointer({
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
}: {
  session: BrowserSession | null;
  sessionIdentity: EchoBrowserSessionIdentity;
  screenshotSize: { width: number; height: number };
  pointerMode: "click" | "double";
  clickMarkerTimeoutRef: RefObject<number | null>;
  applySessionSnapshot: (next: BrowserSession | null) => void;
  refreshBrowserArtifacts: () => Promise<void>;
  handleRefreshScreenshot: () => Promise<void>;
  setDevicePreview: SetState<DevicePreviewPreset>;
  setViewportChanging: SetState<boolean>;
  setError: SetState<string | null>;
  setClickMarker: SetState<ScreenshotPointerPoint | null>;
  setLoading: SetState<boolean>;
  setHoverPoint: SetState<ScreenshotPointerPoint | null>;
  setSelectedActionKey: SetState<string | null>;
  setActionLogExpanded: SetState<boolean>;
}) {
  const handleDevicePreviewChange = useCallback(
    async (preset: DevicePreviewPreset) => {
      const target = DEVICE_PREVIEW_PRESETS[preset];
      setDevicePreview(preset);
      setViewportChanging(true);
      setError(null);
      try {
        const data = await browserApi.setViewport(
          sessionIdentity,
          target.width,
          target.height,
        );
        applySessionSnapshot(data.session);
        await refreshBrowserArtifacts();
      } catch (err) {
        swallow(err);
        setError(
          err instanceof Error ? err.message : "Failed to update viewport",
        );
      } finally {
        setViewportChanging(false);
      }
    },
    [
      applySessionSnapshot,
      refreshBrowserArtifacts,
      sessionIdentity,
      setDevicePreview,
      setError,
      setViewportChanging,
    ],
  );

  const handleScreenshotPointer = useCallback(
    async (event: ReactMouseEvent<HTMLImageElement>) => {
      if (!session || screenshotSize.width <= 0 || screenshotSize.height <= 0) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.round(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) *
          screenshotSize.width,
      );
      const y = Math.round(
        ((event.clientY - rect.top) / Math.max(1, rect.height)) *
          screenshotSize.height,
      );
      setClickMarker({
        x,
        y,
        mode: pointerMode,
        timestamp: Date.now(),
      });
      if (clickMarkerTimeoutRef.current) {
        clearTimeout(clickMarkerTimeoutRef.current);
      }
      clickMarkerTimeoutRef.current = window.setTimeout(
        () => setClickMarker(null),
        1800,
      );
      setLoading(true);
      setError(null);
      try {
        await browserApi.action(
          sessionIdentity,
          pointerMode === "double" ? "double_click_at" : "click_at",
          { x, y },
        );
        await handleRefreshScreenshot();
      } catch (err) {
        swallow(err);
        setError(err instanceof Error ? err.message : "Browser click failed");
      } finally {
        setLoading(false);
      }
    },
    [
      handleRefreshScreenshot,
      pointerMode,
      screenshotSize.height,
      screenshotSize.width,
      session,
      sessionIdentity,
      clickMarkerTimeoutRef,
      setClickMarker,
      setError,
      setLoading,
    ],
  );

  const handleScreenshotHover = useCallback(
    (event: ReactMouseEvent<HTMLImageElement>) => {
      if (screenshotSize.width <= 0 || screenshotSize.height <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.round(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) *
          screenshotSize.width,
      );
      const y = Math.round(
        ((event.clientY - rect.top) / Math.max(1, rect.height)) *
          screenshotSize.height,
      );
      setHoverPoint({ x, y, mode: pointerMode, timestamp: Date.now() });
    },
    [pointerMode, screenshotSize.height, screenshotSize.width, setHoverPoint],
  );

  const focusActionEntry = useCallback(
    (entry: ActionLogEntry, absoluteIndex: number) => {
      setSelectedActionKey(
        `${entry.timestamp}-${entry.action}-${absoluteIndex}`,
      );
      setActionLogExpanded(true);
      const point = actionCoordinatePoint(entry);
      if (!point) return;
      setClickMarker({
        ...point,
        mode: entry.action === "double_click_at" ? "double" : "click",
        timestamp: Date.now(),
      });
      if (clickMarkerTimeoutRef.current) {
        clearTimeout(clickMarkerTimeoutRef.current);
      }
      clickMarkerTimeoutRef.current = window.setTimeout(
        () => setClickMarker(null),
        2600,
      );
    },
    [
      clickMarkerTimeoutRef,
      setActionLogExpanded,
      setClickMarker,
      setSelectedActionKey,
    ],
  );

  return {
    handleDevicePreviewChange,
    handleScreenshotPointer,
    handleScreenshotHover,
    focusActionEntry,
  };
}
