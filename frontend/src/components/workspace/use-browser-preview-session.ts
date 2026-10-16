// Session and navigation callbacks of BrowserPreviewPanel. Each hook holds a
// run of hooks that the panel used to declare inline, and the panel calls it
// at the same place, so the panel's hook order is unchanged. The panel's state
// setters arrive as arguments, so dependency arrays list them; they keep their
// identity, so the callbacks change exactly as often as before.
import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { resolveBrowserInput } from "@/components/browser/task-browser-start";
import type { EchoBrowserSessionIdentity } from "@/core/browser/api";
import {
  detectLocalServices,
  type DetectedLocalService,
} from "@/core/browser/local-services";
import type { Translations } from "@/core/i18n/locales";
import { swallow } from "@/core/utils/log";

import {
  browserApi,
  dataUrlToFile,
  type ActionLogEntry,
  type BrowserSession,
  type BrowserSessionHealth,
  type PageInfo,
} from "./browser-preview-api";
import {
  presetForViewport,
  type DevicePreviewPreset,
} from "./browser-preview-model";

type SetState<T> = Dispatch<SetStateAction<T>>;

/** Starts or reconnects the browser session, scans local dev servers and
 *  opens one of them. */
export function useBrowserPreviewSession({
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
}: {
  session: BrowserSession | null;
  sessionId: string;
  sessionIdentity: EchoBrowserSessionIdentity;
  setSession: SetState<BrowserSession | null>;
  setDevicePreview: SetState<DevicePreviewPreset>;
  setPageInfo: SetState<PageInfo>;
  setUrlInput: SetState<string>;
  setScreenshot: SetState<string>;
  setScreenshotSize: SetState<{ width: number; height: number }>;
  setActionLog: SetState<ActionLogEntry[]>;
  setSessionHealth: SetState<BrowserSessionHealth | null>;
  setLoading: SetState<boolean>;
  setError: SetState<string | null>;
  setScanningPorts: SetState<boolean>;
  setDetectedServices: SetState<DetectedLocalService[]>;
}) {
  const applySessionSnapshot = useCallback(
    (next: BrowserSession | null) => {
      setSession(next);
      if (!next) return;
      const matchedPreset = presetForViewport(
        next.viewport_width,
        next.viewport_height,
      );
      if (matchedPreset) {
        setDevicePreview(matchedPreset);
      }
      const snapshotUrl = next.current_url || "";
      const snapshotTitle = next.current_title || "";
      if (snapshotUrl || snapshotTitle) {
        setPageInfo({ url: snapshotUrl, title: snapshotTitle });
        setUrlInput(snapshotUrl);
      }
    },
    [setDevicePreview, setPageInfo, setSession, setUrlInput],
  );

  const refreshSessionStatus = useCallback(async () => {
    const data = await browserApi.sessionStatus(sessionId);
    applySessionSnapshot(data.exists ? data.session : null);
    return data;
  }, [applySessionSnapshot, sessionId]);

  const refreshBrowserArtifacts = useCallback(async () => {
    const [shotResult, logResult, healthResult] = await Promise.allSettled([
      browserApi.screenshotBase64(sessionId),
      browserApi.actionLog(sessionId),
      browserApi.sessionHealth(sessionId),
    ]);

    if (shotResult.status === "fulfilled") {
      setScreenshot(shotResult.value.base64);
      setScreenshotSize({
        width: shotResult.value.width,
        height: shotResult.value.height,
      });
    } else {
      swallow(shotResult.reason);
    }

    if (logResult.status === "fulfilled") {
      setActionLog(logResult.value.actions);
    } else {
      swallow(logResult.reason);
    }

    if (healthResult.status === "fulfilled") {
      setSessionHealth(healthResult.value);
    } else {
      swallow(healthResult.reason);
    }
  }, [
    sessionId,
    setActionLog,
    setScreenshot,
    setScreenshotSize,
    setSessionHealth,
  ]);

  // Start or reconnect the browser as soon as the panel is opened.
  useEffect(() => {
    let cancelled = false;

    async function ensureSession() {
      setLoading(true);
      setError(null);
      try {
        const status = await browserApi.sessionStatus(sessionId);
        if (cancelled) return;

        if (status.exists) {
          applySessionSnapshot(status.session);
        } else {
          const data = await browserApi.ensure(sessionIdentity);
          if (cancelled) return;
          applySessionSnapshot(data.session);
        }

        await refreshBrowserArtifacts();
      } catch (err) {
        swallow(err);
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to launch browser",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void ensureSession();

    return () => {
      cancelled = true;
    };
  }, [
    applySessionSnapshot,
    refreshBrowserArtifacts,
    sessionId,
    sessionIdentity,
    setError,
    setLoading,
  ]);

  // Scan for local services on mount
  useEffect(() => {
    setScanningPorts(true);
    detectLocalServices()
      .then(setDetectedServices)
      .catch(() => setDetectedServices([]))
      .finally(() => setScanningPorts(false));
  }, [setDetectedServices, setScanningPorts]);

  const handleRescanPorts = useCallback(() => {
    setScanningPorts(true);
    detectLocalServices()
      .then(setDetectedServices)
      .catch(() => setDetectedServices([]))
      .finally(() => setScanningPorts(false));
  }, [setDetectedServices, setScanningPorts]);

  const handleQuickNavigate = useCallback(
    async (url: string) => {
      setUrlInput(url);
      setLoading(true);
      setError(null);
      try {
        if (!session) {
          const data = await browserApi.ensure(sessionIdentity);
          applySessionSnapshot(data.session);
        }
        const info = await browserApi.navigate(sessionIdentity, url);
        setPageInfo(info);
        setUrlInput(info.url);
        const shotData = await browserApi.screenshotBase64(sessionId);
        setScreenshot(shotData.base64);
        setScreenshotSize({ width: shotData.width, height: shotData.height });
        const [logData, healthData] = await Promise.all([
          browserApi.actionLog(sessionId),
          browserApi.sessionHealth(sessionId),
        ]);
        setActionLog(logData.actions);
        setSessionHealth(healthData);
        await refreshSessionStatus();
      } catch (err) {
        swallow(err);
        setError(err instanceof Error ? err.message : "Navigation failed");
      } finally {
        setLoading(false);
      }
    },
    [
      applySessionSnapshot,
      refreshSessionStatus,
      session,
      sessionId,
      sessionIdentity,
      setActionLog,
      setError,
      setLoading,
      setPageInfo,
      setScreenshot,
      setScreenshotSize,
      setSessionHealth,
      setUrlInput,
    ],
  );

  return {
    applySessionSnapshot,
    refreshSessionStatus,
    refreshBrowserArtifacts,
    handleRescanPorts,
    handleQuickNavigate,
  };
}

/** Launches, navigates and refreshes the browser, and attaches its
 *  screenshot to the composer. */
export function useBrowserPreviewNavigation({
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
}: {
  session: BrowserSession | null;
  sessionId: string;
  sessionIdentity: EchoBrowserSessionIdentity;
  urlInput: string;
  searchEngineUrl?: string;
  screenshot: string;
  pageInfo: PageInfo;
  threadId: string;
  bp: Translations["browserPreviewPanel"];
  applySessionSnapshot: (next: BrowserSession | null) => void;
  refreshBrowserArtifacts: () => Promise<void>;
  refreshSessionStatus: () => Promise<{
    exists: boolean;
    session: BrowserSession;
  }>;
  setLoading: SetState<boolean>;
  setError: SetState<string | null>;
  setPageInfo: SetState<PageInfo>;
  setUrlInput: SetState<string>;
  setScreenshot: SetState<string>;
  setScreenshotSize: SetState<{ width: number; height: number }>;
  setActionLog: SetState<ActionLogEntry[]>;
  setSessionHealth: SetState<BrowserSessionHealth | null>;
}) {
  const handleLaunch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await browserApi.ensure(sessionIdentity);
      applySessionSnapshot(data.session);
      await refreshBrowserArtifacts();
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : "Failed to launch browser");
    } finally {
      setLoading(false);
    }
  }, [
    applySessionSnapshot,
    refreshBrowserArtifacts,
    sessionIdentity,
    setError,
    setLoading,
  ]);

  const handleNavigate = useCallback(
    async (input = urlInput) => {
      if (!input.trim()) return;
      setLoading(true);
      setError(null);
      try {
        // Ensure session exists
        if (!session) {
          const data = await browserApi.ensure(sessionIdentity);
          applySessionSnapshot(data.session);
        }
        const url = resolveBrowserInput(input, searchEngineUrl);
        const info = await browserApi.navigate(sessionIdentity, url);
        setPageInfo(info);
        setUrlInput(info.url);
        // Refresh screenshot
        const shotData = await browserApi.screenshotBase64(sessionId);
        setScreenshot(shotData.base64);
        setScreenshotSize({ width: shotData.width, height: shotData.height });
        // Refresh log
        const [logData, healthData] = await Promise.all([
          browserApi.actionLog(sessionId),
          browserApi.sessionHealth(sessionId),
        ]);
        setActionLog(logData.actions);
        setSessionHealth(healthData);
        await refreshSessionStatus();
      } catch (err) {
        swallow(err);
        setError(err instanceof Error ? err.message : "Navigation failed");
      } finally {
        setLoading(false);
      }
    },
    [
      applySessionSnapshot,
      refreshSessionStatus,
      urlInput,
      searchEngineUrl,
      session,
      sessionId,
      sessionIdentity,
      setActionLog,
      setError,
      setLoading,
      setPageInfo,
      setScreenshot,
      setScreenshotSize,
      setSessionHealth,
      setUrlInput,
    ],
  );

  const handleRetry = useCallback(() => {
    if (urlInput.trim()) {
      void handleNavigate();
    } else {
      void handleLaunch();
    }
  }, [handleLaunch, handleNavigate, urlInput]);

  const handleRefreshScreenshot = useCallback(async () => {
    if (!session) return;
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
      await refreshSessionStatus();
    } catch (e) {
      swallow(e);
    }
  }, [
    refreshSessionStatus,
    session,
    sessionId,
    setActionLog,
    setPageInfo,
    setScreenshot,
    setScreenshotSize,
    setSessionHealth,
  ]);

  const handleAttachScreenshotToComposer = useCallback(async () => {
    try {
      let screenshotDataUrl = screenshot
        ? `data:image/png;base64,${screenshot}`
        : "";
      if (!screenshotDataUrl && session) {
        const shotData = await browserApi.screenshotBase64(sessionId);
        setScreenshot(shotData.base64);
        setScreenshotSize({ width: shotData.width, height: shotData.height });
        screenshotDataUrl = `data:image/png;base64,${shotData.base64}`;
      }
      if (!screenshotDataUrl) {
        toast.error(bp.noReadableText);
        return;
      }
      const host = (() => {
        try {
          return pageInfo.url ? new URL(pageInfo.url).hostname : "browser";
        } catch {
          return "browser";
        }
      })();
      const file = await dataUrlToFile(
        screenshotDataUrl,
        `browser-shot-${host}-${Date.now()}.png`,
      );
      window.dispatchEvent(
        new CustomEvent("echo:inject-composer-images", {
          detail: {
            threadId,
            images: [file],
            sourceLabel: bp.attachScreenshotSource,
          },
        }),
      );
      toast.success(bp.attachScreenshotSuccess);
    } catch (error) {
      swallow(error);
      toast.error(bp.attachScreenshotFailed);
    }
  }, [
    bp,
    pageInfo.url,
    screenshot,
    session,
    sessionId,
    threadId,
    setScreenshot,
    setScreenshotSize,
  ]);

  return {
    handleLaunch,
    handleNavigate,
    handleRetry,
    handleRefreshScreenshot,
    handleAttachScreenshotToComposer,
  };
}
