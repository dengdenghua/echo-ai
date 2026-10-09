import {
  AlertTriangleIcon,
  CloudDownloadIcon,
  Loader2Icon,
  PowerIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  fetchWorkbenchInstalled,
  fetchRuntimePluginStatus,
  installCloudPlugin,
  setCloudPluginEnabled,
  setRuntimePluginEnabled,
} from "@/core/agents/agent-world-api";
import { EchoAPIError, apiGet, type ApiFailure } from "@/core/api/request";
import { getBackendBaseURL } from "@/core/config";
import { useActiveAgentId } from "@/core/agents/active";
import {
  setModuleAvailable,
  setModuleEnabled,
} from "@/core/modules/enabled-modules";

import type { WorkbenchBuiltinApp } from "./apps";

export interface RemoteWorkbenchManifest {
  schema: "echo.workbench_app.v1";
  id: string;
  name: string;
  description: string;
  route: string;
  module_id: string;
  version: string;
  entry: string;
  entry_url: string;
  isolation: "iframe";
  permissions: string[];
}

type SurfaceIssueKind =
  | "disabled"
  | "missing"
  | "corrupt"
  | "incompatible"
  | "offline"
  | "unknown";

interface SurfaceIssue {
  kind: SurfaceIssueKind;
  message: string;
}

class RemoteWorkbenchLoadError extends Error {
  constructor(
    readonly kind: SurfaceIssueKind,
    message: string,
  ) {
    super(message);
    this.name = "RemoteWorkbenchLoadError";
  }
}

function issueFromError(error: unknown): SurfaceIssue {
  if (error instanceof RemoteWorkbenchLoadError) {
    return { kind: error.kind, message: error.message };
  }
  if (error instanceof TypeError) {
    return {
      kind: "offline",
      message: "无法连接本地服务。请确认 Echo 服务正在运行，然后重试。",
    };
  }
  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

/** A string ``detail`` from a JSON error body, or the trimmed plain text. */
function failureText(failure: ApiFailure): string {
  const { text } = failure;
  if (!text) return "";
  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    return typeof payload.detail === "string" ? payload.detail : "";
  } catch {
    return text.trim();
  }
}

function manifestLoadError(
  status: number,
  detail: string,
): RemoteWorkbenchLoadError {
  if (status === 404) {
    return new RemoteWorkbenchLoadError(
      "missing",
      "应用尚未安装，或安装包缺少界面入口。",
    );
  }
  if (status === 409) {
    return new RemoteWorkbenchLoadError(
      "incompatible",
      detail || "当前应用版本与 Echo 宿主不兼容，请更新应用。",
    );
  }
  if (status === 422) {
    return new RemoteWorkbenchLoadError(
      "corrupt",
      "安装包损坏或完整性校验失败，请从应用中心重新安装。",
    );
  }
  if (status >= 500) {
    return new RemoteWorkbenchLoadError(
      "offline",
      detail || "本地应用服务暂时不可用，请稍后重试。",
    );
  }
  return new RemoteWorkbenchLoadError(
    "unknown",
    detail || `应用界面包加载失败（HTTP ${status}）。`,
  );
}

function backendOrigin(): string {
  try {
    return new URL(getBackendBaseURL(), window.location.href).origin;
  } catch {
    return window.location.origin;
  }
}

export async function fetchRemoteWorkbenchManifest(
  packageId: string,
  signal?: AbortSignal,
): Promise<RemoteWorkbenchManifest> {
  let manifest: RemoteWorkbenchManifest;
  try {
    manifest = (await apiGet("/api/workbench-packages/{plugin_id}/manifest", {
      path: { plugin_id: packageId },
      signal,
      // The error message carries the body's detail text to the mapping below.
      errorMessage: failureText,
    })) as RemoteWorkbenchManifest;
  } catch (error) {
    if (error instanceof EchoAPIError) {
      throw manifestLoadError(error.status, error.message);
    }
    throw error;
  }
  if (
    manifest.schema !== "echo.workbench_app.v1" ||
    manifest.id !== packageId ||
    manifest.isolation !== "iframe" ||
    !manifest.entry_url ||
    !Array.isArray(manifest.permissions)
  ) {
    throw new RemoteWorkbenchLoadError(
      "incompatible",
      "应用界面包与当前宿主不兼容，请更新或重新安装。",
    );
  }
  return manifest;
}

function SurfaceState({
  app,
  issue,
  retry,
  enable,
  install,
  actionBusy = false,
}: {
  app: WorkbenchBuiltinApp;
  issue?: SurfaceIssue;
  retry?: () => void;
  enable?: () => void;
  /** Install in place, so a missing app is one click away instead of a detour. */
  install?: () => void;
  actionBusy?: boolean;
}) {
  const navigate = useNavigate();
  if (!issue) {
    return (
      <div
        className="flex size-full min-h-80 items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <Loader2Icon className="size-5 animate-spin" />
          正在验证并加载{app.name}…
        </div>
      </div>
    );
  }
  return (
    <div className="flex size-full min-h-80 items-center justify-center p-5">
      <section className="w-full max-w-md rounded-2xl border border-border/70 bg-card/75 p-6 text-center shadow-sm">
        {install ? (
          <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CloudDownloadIcon className="size-5" />
          </div>
        ) : (
          <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <AlertTriangleIcon className="size-5" />
          </div>
        )}
        <h1 className="mt-4 text-base font-semibold">
          {install
            ? `安装${app.name}`
            : issue.kind === "disabled"
              ? `${app.name}已停用`
              : `${app.name}暂时不可用`}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {install
            ? `${app.description || app.name}。安装后即可在这里直接使用。`
            : issue.message}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {install ? (
            <Button size="sm" disabled={actionBusy} onClick={install}>
              {actionBusy ? (
                <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <CloudDownloadIcon className="mr-1.5 size-3.5" />
              )}
              {actionBusy ? "正在安装…" : "安装"}
            </Button>
          ) : null}
          {enable ? (
            <Button size="sm" disabled={actionBusy} onClick={enable}>
              {actionBusy ? (
                <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <PowerIcon className="mr-1.5 size-3.5" />
              )}
              启用应用
            </Button>
          ) : null}
          {retry ? (
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCwIcon className="mr-1.5 size-3.5" />
              重新检查
            </Button>
          ) : null}
          <Button
            variant={install || enable || retry ? "outline" : "default"}
            size="sm"
            onClick={() =>
              navigate("/workspace/agents?surface=chat&tab=plugins")
            }
          >
            {install ? null : <CloudDownloadIcon className="mr-1.5 size-3.5" />}
            {install
              ? "在应用中心查看"
              : issue.kind === "corrupt" || issue.kind === "incompatible"
                ? "前往重新安装"
                : "前往应用中心"}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** Host surface for independently delivered, same-origin workbench apps. */
export function RemoteWorkbenchSurface({
  app,
  hostPath,
}: {
  app: WorkbenchBuiltinApp;
  /** Native browser tabs do not share the outer workspace URL. */
  hostPath?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [manifest, setManifest] = useState<RemoteWorkbenchManifest | null>(
    null,
  );
  const [issue, setIssue] = useState<SurfaceIssue | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const activeAgentId = useActiveAgentId();
  const packageId = app.packageId;
  const effectiveHostPath =
    hostPath ?? `${location.pathname}${location.search}${location.hash}`;
  const initialHostPathRef = useRef(effectiveHostPath);
  const freshTask = new URL(
    effectiveHostPath,
    window.location.origin,
  ).searchParams.get("new_task");
  const lastFreshTaskRef = useRef(freshTask);
  if (freshTask && freshTask !== lastFreshTaskRef.current) {
    initialHostPathRef.current = effectiveHostPath;
    lastFreshTaskRef.current = freshTask;
  }

  useEffect(() => {
    if (!packageId) {
      setIssue({
        kind: "incompatible",
        message: "应用没有声明可下载的软件包。",
      });
      return;
    }
    const controller = new AbortController();
    setManifest(null);
    setIssue(null);
    void (async () => {
      // These reads are independent. Wait for all checks before mounting, but
      // don't add their network latencies together on every mode switch.
      const [installedResult, runtimeResult, manifestResult] =
        await Promise.allSettled([
          fetchWorkbenchInstalled(packageId),
          app.runtimePlugin
            ? fetchRuntimePluginStatus(app.runtimePlugin)
            : Promise.resolve(null),
          fetchRemoteWorkbenchManifest(packageId, controller.signal),
        ]);
      if (controller.signal.aborted) return;
      try {
        if (installedResult.status === "rejected") throw installedResult.reason;
        const installed = installedResult.value;
        const packageStatus = installed.plugin_states?.[packageId];
        if (packageStatus?.lifecycle_state === "broken") {
          throw new RemoteWorkbenchLoadError(
            "corrupt",
            packageStatus.error || "应用安装包已损坏，请重新安装。",
          );
        }
        if (packageStatus?.lifecycle_state === "incompatible") {
          throw new RemoteWorkbenchLoadError(
            "incompatible",
            packageStatus.error || "应用版本与当前 Echo 宿主不兼容。",
          );
        }
        if (packageStatus && !packageStatus.installed) {
          throw new RemoteWorkbenchLoadError(
            "missing",
            "应用尚未安装，请从应用中心完成安装。",
          );
        }
        if (packageStatus && !packageStatus.enabled) {
          throw new RemoteWorkbenchLoadError(
            "disabled",
            "应用仍保留在本机，但当前没有运行。可直接启用，无需重新下载。",
          );
        }
        if (!packageStatus && !installed.plugins.includes(packageId)) {
          throw new RemoteWorkbenchLoadError(
            "missing",
            "应用尚未安装，请从应用中心完成安装。",
          );
        }
      } catch (packageStatusError) {
        if (packageStatusError instanceof RemoteWorkbenchLoadError) {
          throw packageStatusError;
        }
        // Older backends may only expose the signed package endpoint.
      }
      if (app.runtimePlugin) {
        try {
          if (runtimeResult.status === "rejected") throw runtimeResult.reason;
          const status = runtimeResult.value!;
          if (!status.installed) {
            throw new RemoteWorkbenchLoadError(
              "missing",
              "应用后端尚未安装，请从应用中心完成安装。",
            );
          }
          if (!status.enabled) {
            throw new RemoteWorkbenchLoadError(
              "disabled",
              "应用仍保留在本机，但当前没有运行。可直接启用，无需重新下载。",
            );
          }
          if (status.lifecycle_state === "broken") {
            throw new RemoteWorkbenchLoadError(
              "corrupt",
              status.error || "应用运行组件已损坏，请重新安装。",
            );
          }
          if (status.lifecycle_state === "incompatible") {
            throw new RemoteWorkbenchLoadError(
              "incompatible",
              status.error || "应用版本与当前 Echo 宿主不兼容。",
            );
          }
        } catch (statusError) {
          if (statusError instanceof RemoteWorkbenchLoadError) {
            throw statusError;
          }
          // Older backends may not provide lifecycle status yet. The signed
          // package endpoint remains the authoritative compatibility fallback.
        }
      }
      if (manifestResult.status === "rejected") throw manifestResult.reason;
      return manifestResult.value;
    })()
      .then((nextManifest) => {
        if (nextManifest) setManifest(nextManifest);
      })
      .catch((nextError) => {
        if (!controller.signal.aborted) setIssue(issueFromError(nextError));
      });
    return () => controller.abort();
  }, [app.runtimePlugin, attempt, packageId]);

  const enableRuntime = useCallback(async () => {
    if (!app.cloudId && !app.runtimePlugin) return;
    setActionBusy(true);
    try {
      let status;
      try {
        status = app.cloudId
          ? await setCloudPluginEnabled(app.cloudId, true)
          : await setRuntimePluginEnabled(app.runtimePlugin as string, true);
      } catch (cloudError) {
        if (!app.runtimePlugin || !app.cloudId) throw cloudError;
        // Compatibility fallback while older local backends are upgraded.
        status = await setRuntimePluginEnabled(app.runtimePlugin, true);
      }
      if (!status.enabled) {
        throw new Error(status.error || "应用未能进入启用状态");
      }
      setAttempt((value) => value + 1);
    } catch (enableError) {
      setIssue({
        kind: "unknown",
        message: `启用失败：${enableError instanceof Error ? enableError.message : String(enableError)}`,
      });
    } finally {
      setActionBusy(false);
    }
  }, [app.cloudId, app.runtimePlugin]);

  const installApp = useCallback(async () => {
    if (!app.cloudId) return;
    setActionBusy(true);
    try {
      await installCloudPlugin(app.cloudId);
      setModuleAvailable(app.moduleId, true);
      // Installing from here is an explicit "I want this", so it joins the
      // sidebar, as it does when installed from the app center.
      setModuleEnabled(app.moduleId, true, activeAgentId);
      toast.success(`${app.name}已安装`);
      setAttempt((value) => value + 1);
    } catch (installError) {
      setIssue({
        kind: "unknown",
        message: `安装失败：${installError instanceof Error ? installError.message : String(installError)}`,
      });
    } finally {
      setActionBusy(false);
    }
  }, [activeAgentId, app.cloudId, app.moduleId, app.name]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.origin !== backendOrigin()) return;
      const payload = event.data as { type?: unknown; href?: unknown } | null;
      if (
        payload?.type !== "echo.workbench.navigate" ||
        typeof payload.href !== "string"
      ) {
        return;
      }
      let target: URL;
      try {
        target = new URL(payload.href, window.location.origin);
      } catch {
        return;
      }
      if (
        target.origin !== window.location.origin ||
        !target.pathname.startsWith("/workspace/")
      ) {
        return;
      }
      void navigate(`${target.pathname}${target.search}${target.hash}`);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [navigate]);

  const entryHostPath = initialHostPathRef.current;
  const src = useMemo(() => {
    if (!manifest) return "";
    const entry = new URL(
      manifest.entry_url,
      getBackendBaseURL() || window.location.origin,
    );
    entry.searchParams.set("echo_host_path", entryHostPath);
    entry.searchParams.set("echo_host_origin", window.location.origin);
    return entry.toString();
  }, [manifest, entryHostPath]);

  const sendContext = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "echo.host.context",
        route: effectiveHostPath,
        colorScheme: document.documentElement.classList.contains("dark")
          ? "dark"
          : "light",
        locale: document.documentElement.lang || "zh-CN",
      },
      backendOrigin(),
    );
  }, [effectiveHostPath]);

  useEffect(() => {
    if (manifest) sendContext();
  }, [manifest, sendContext]);

  if (!manifest) {
    return (
      <SurfaceState
        app={app}
        issue={issue || undefined}
        retry={issue ? () => setAttempt((value) => value + 1) : undefined}
        enable={issue?.kind === "disabled" ? enableRuntime : undefined}
        install={
          issue?.kind === "missing" && app.cloudId ? installApp : undefined
        }
        actionBusy={actionBusy}
      />
    );
  }

  return (
    <div className="flex size-full min-h-0 flex-col">
      <nav
        aria-label="应用导航"
        className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background px-3 md:hidden"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/workspace/agents?tab=plugins")}
        >
          返回 HUB
        </Button>
        <span className="truncate text-sm font-medium">{app.name}</span>
      </nav>
      <iframe
        key={lastFreshTaskRef.current || "workbench"}
        ref={iframeRef}
        src={src}
        title={manifest.name || app.name}
        className="size-full min-h-0 border-0 bg-background"
        sandbox={`allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts${manifest.permissions.includes("host.same_origin") ? " allow-same-origin" : ""}`}
        allow="clipboard-read; clipboard-write"
        onLoad={sendContext}
      />
    </div>
  );
}

export default RemoteWorkbenchSurface;
