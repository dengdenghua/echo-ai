import { apiGet, apiPost, apiPut, type ApiFailure } from "@/core/api/request";

/** ``"<label>: <statusText>"`` — this module's historical wording. */
function failed(label: string) {
  return (failure: ApiFailure): string => `${label}: ${failure.statusText}`;
}

export interface DetectedBrowser {
  name: string;
  display_name: string;
  version: string;
  path: string;
  chromium_based: boolean;
  cdp_supported: boolean;
  connection_modes: string[];
}

export interface SystemInfo {
  os: string;
  os_version: string;
  os_release: string;
  architecture: string;
  python_version: string;
}

export interface BrowserSystemInfoResponse {
  system: SystemInfo;
  browsers: DetectedBrowser[];
}

export interface BrowserConfig {
  max_open_tabs: number;
  max_saved_tabs: number;
  connection_mode: "playwright" | "extension" | "cdp";
  cdp_port: number;
  headless: boolean;
  viewport_width: number;
  viewport_height: number;
  relay_allowed_hosts?: string[];
  relay_blocked_hosts?: string[];
  relay_require_allowlist?: boolean;
}

export interface BrowserSession {
  session_id: string;
  project_id: string;
  profile_id: string;
  profile_dir: string;
  automation_mode: "browser_context" | string;
  uses_system_mouse: boolean;
  desktop_lease_required: boolean;
  is_launched: boolean;
  created_at: number;
  last_activity: number;
  action_count: number;
  headless: boolean;
  mode: string;
  runtime: string;
  has_page: boolean;
  healthy: boolean;
  current_url: string;
  current_title: string;
  browser_regression_enabled: boolean;
  browser_regression_mode: string;
  browser_regression_preview_url: string;
  browser_regression_requires_visible_cursor: boolean;
}

export interface BrowserSessionResponse {
  status: string;
  session: BrowserSession;
}

export interface BrowserSessionsResponse {
  sessions: BrowserSession[];
  count: number;
}

export interface EchoBrowserSessionIdentity {
  sessionId: string;
  projectId: string;
  profileId: string;
  displayName: string;
  scope: "browser" | "thread" | "workspace";
}

export interface RelayStatus {
  connected: boolean;
  connection_state?: "online" | "offline" | "reconnecting" | string;
  extension_version: string;
  pending_commands: number;
  push_connected?: boolean;
  last_seen?: number;
  active_tab?: {
    id?: string | number | null;
    url?: string;
    title?: string;
  } | null;
  control?: {
    mode?: string;
    blocked?: boolean;
    lease?: Record<string, unknown> | null;
    human_interrupt?: Record<string, unknown> | null;
    [key: string]: unknown;
  } | null;
}

function stableBrowserHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function browserScopeSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[\\/]+/g, "-")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "default"
  );
}

function basenameFromPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

export function createEchoBrowserSessionIdentity(
  options: {
    threadId?: string | null;
    workspacePath?: string | null;
    scope?: "browser" | "thread" | "workspace";
  } = {},
): EchoBrowserSessionIdentity {
  const workspacePath = options.workspacePath?.trim();
  const threadId = options.threadId?.trim();
  const scope: EchoBrowserSessionIdentity["scope"] =
    options.scope ??
    (workspacePath ? "workspace" : threadId ? "thread" : "browser");
  const basis =
    scope === "workspace" && workspacePath
      ? workspacePath
      : scope === "thread" && threadId
        ? threadId
        : "standalone";
  const displayName =
    scope === "workspace" && workspacePath
      ? basenameFromPath(workspacePath)
      : scope === "thread" && threadId
        ? `thread/${threadId.slice(0, 8)}`
        : "Browser";
  const label =
    scope === "workspace" && workspacePath
      ? basenameFromPath(workspacePath)
      : displayName;
  const prefix = `echo-${scope}`;
  const slug = browserScopeSegment(`${label}-${stableBrowserHash(basis)}`);
  return {
    sessionId: `${prefix}-${slug}`,
    projectId: `${prefix}:${basis}`,
    profileId: `${prefix}-${slug}`,
    displayName,
    scope,
  };
}

export async function getBrowserSystemInfo(): Promise<BrowserSystemInfoResponse> {
  return (await apiGet("/api/browser/system-info", {
    errorMessage: failed("Failed to get system info"),
  })) as BrowserSystemInfoResponse;
}

export async function getBrowserConfig(): Promise<BrowserConfig> {
  return (await apiGet("/api/browser/config", {
    errorMessage: failed("Failed to get browser config"),
  })) as BrowserConfig;
}

export async function ensureBrowserSession(
  options: {
    sessionId?: string;
    projectId?: string;
    profileId?: string;
    headless?: boolean;
  } = {},
): Promise<BrowserSessionResponse> {
  const sessionId = options.sessionId || "default";
  return (await apiPost("/api/browser/session/ensure", {
    body: {
      session_id: sessionId,
      project_id: options.projectId || sessionId,
      profile_id: options.profileId || options.projectId || sessionId,
      ...(options.headless === undefined ? {} : { headless: options.headless }),
    },
    errorMessage: failed("Failed to ensure browser session"),
  })) as BrowserSessionResponse;
}

export async function getBrowserSessions(): Promise<BrowserSessionsResponse> {
  return (await apiGet("/api/browser/sessions", {
    errorMessage: failed("Failed to get browser sessions"),
  })) as BrowserSessionsResponse;
}

export async function updateBrowserConfig(
  config: Partial<BrowserConfig>,
): Promise<BrowserConfig> {
  return (await apiPut("/api/browser/config", {
    body: config,
    errorMessage: failed("Failed to update browser config"),
  })) as BrowserConfig;
}

export async function getRelayStatus(): Promise<RelayStatus> {
  return (await apiGet("/api/browser/relay/status", {
    errorMessage: failed("Failed to get relay status"),
  })) as RelayStatus;
}

export async function captureBrowserRelayPreview(target: {
  id: string;
  title: string;
  url?: string;
}): Promise<{ dataUrl: string }> {
  const payload = (await apiPost("/api/browser/relay/command", {
    body: {
      action: "screenshot",
      target_tab_id: target.id,
      target_tab_title: target.title,
      target_tab_url: target.url || "",
      timeout_seconds: 4,
      lease_seconds: 5,
    },
    errorMessage: failed("Failed to capture browser preview"),
  })) as {
    dataUrl?: string;
    data?: string;
  };
  const dataUrl = payload.dataUrl || payload.data || "";
  if (!dataUrl) throw new Error("Browser preview returned no image");
  return { dataUrl };
}

export async function openExtensionFolder(): Promise<{
  opened: boolean;
  path: string;
}> {
  return (await apiPost("/api/browser/open-extension-folder", {
    // Historically sent even though the request has no body.
    headers: { "Content-Type": "application/json" },
    errorMessage: failed("Failed to open extension folder"),
  })) as { opened: boolean; path: string };
}

export async function getExtensionPath(): Promise<{
  path: string;
  exists: boolean;
}> {
  return (await apiGet("/api/browser/extension-path", {
    errorMessage: failed("Failed to get extension path"),
  })) as { path: string; exists: boolean };
}
