// Browser session API, its payload types and the screenshot helpers behind
// the agent browser preview (browser-preview-panel.tsx).
import { getBackendBaseURL } from "@/core/config";
import { authHeaders, jsonAuthHeaders } from "@/core/auth/api";
import type { EchoBrowserSessionIdentity } from "@/core/browser/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserSession {
  session_id: string;
  project_id?: string;
  profile_id?: string;
  profile_dir?: string;
  automation_mode?: string;
  uses_system_mouse?: boolean;
  desktop_lease_required?: boolean;
  is_launched: boolean;
  created_at: number;
  last_activity: number;
  action_count: number;
  headless?: boolean;
  viewport_width?: number;
  viewport_height?: number;
  mode?: string;
  runtime?: string;
  has_page?: boolean;
  healthy?: boolean;
  current_url?: string;
  current_title?: string;
  launch_error?: string;
}

export interface ActionLogEntry {
  action: string;
  detail: string;
  status?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface PageInfo {
  url: string;
  title: string;
}

export async function dataUrlToFile(
  dataUrl: string,
  filename: string,
  fallbackMime = "image/png",
): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, {
    type: blob.type || fallbackMime,
  });
}

export async function renderAnnotatedScreenshot(
  screenshot: string,
  points: Array<{ x: number; y: number }>,
  note: string,
): Promise<string> {
  if (typeof document === "undefined" || !screenshot) return screenshot;
  const image = new Image();
  image.src = `data:image/png;base64,${screenshot}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to render annotation"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return `data:image/png;base64,${screenshot}`;
  context.drawImage(image, 0, 0);
  const radius = Math.max(18, Math.round(canvas.width / 80));
  context.font = `600 ${Math.max(16, radius * 0.85)}px sans-serif`;
  points.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(8, 120, 138, 0.18)"; // ECHO Snow core: exported image, theme-independent
    context.fill();
    context.lineWidth = Math.max(3, Math.round(radius / 6));
    context.strokeStyle = "#08788a";
    context.stroke();
    context.fillStyle = "#08788a";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(index + 1), point.x, point.y);
  });
  if (note.trim()) {
    const padding = Math.max(12, Math.round(canvas.width / 120));
    const maxWidth = canvas.width - padding * 2;
    const metrics = context.measureText(note.trim());
    const boxWidth = Math.min(
      maxWidth,
      Math.max(180, metrics.width + padding * 2),
    );
    const boxHeight = Math.max(34, radius * 1.8);
    context.fillStyle = "rgba(255, 255, 255, 0.94)";
    context.strokeStyle = "rgba(8, 120, 138, 0.45)";
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(padding, padding, boxWidth, boxHeight, 8);
    context.fill();
    context.stroke();
    context.fillStyle = "#111317"; // ECHO Snow ink
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(
      note.trim().slice(0, 160),
      padding * 1.5,
      padding + boxHeight / 2,
    );
  }
  return canvas.toDataURL("image/png");
}

export interface BrowserSessionHealth {
  schema: "echo.browser_session_health.v1";
  exists: boolean;
  healthy: boolean;
  score: number;
  issues: string[];
  session: BrowserSession;
  recent_actions: ActionLogEntry[];
  replay_ready: boolean;
  stale_seconds?: number;
}

export interface BrowserSemanticSnapshot {
  role?: string;
  name?: string;
  url?: string;
  text?: string;
  truncated?: boolean;
  nodes?: Array<{
    tag: string;
    role: string;
    name: string;
    text: string;
    selector: string;
  }>;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export const browserApi = {
  async sessionStatus(
    sessionId: string,
  ): Promise<{ exists: boolean; session: BrowserSession }> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/browser/session/status?session_id=${encodeURIComponent(sessionId)}`,
      { headers: authHeaders() },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(data.detail || "Failed to get browser session status");
    }
    return res.json();
  },

  async ensure(
    identity: EchoBrowserSessionIdentity,
  ): Promise<{ status: string; session: BrowserSession }> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/browser/session/ensure`,
      {
        method: "POST",
        headers: jsonAuthHeaders(),
        body: JSON.stringify({
          session_id: identity.sessionId,
          project_id: identity.projectId,
          profile_id: identity.profileId,
          headless: true,
        }),
      },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(data.detail || "Failed to start browser session");
    }
    return res.json();
  },

  async setViewport(
    identity: EchoBrowserSessionIdentity,
    width: number,
    height: number,
  ): Promise<{ ok: boolean; session: BrowserSession }> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/browser/session/viewport`,
      {
        method: "POST",
        headers: jsonAuthHeaders(),
        body: JSON.stringify({
          session_id: identity.sessionId,
          project_id: identity.projectId,
          profile_id: identity.profileId,
          width,
          height,
          headless: true,
        }),
      },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(data.detail || "Failed to update browser viewport");
    }
    return res.json();
  },

  async reset(identity: EchoBrowserSessionIdentity): Promise<void> {
    await fetch(`${getBackendBaseURL()}/api/browser/session/reset`, {
      method: "POST",
      headers: jsonAuthHeaders(),
      body: JSON.stringify({
        session_id: identity.sessionId,
        project_id: identity.projectId,
        profile_id: identity.profileId,
      }),
    });
  },

  async navigate(
    identity: EchoBrowserSessionIdentity,
    url: string,
  ): Promise<PageInfo> {
    const res = await fetch(`${getBackendBaseURL()}/api/browser/navigate`, {
      method: "POST",
      headers: jsonAuthHeaders(),
      body: JSON.stringify({
        session_id: identity.sessionId,
        project_id: identity.projectId,
        profile_id: identity.profileId,
        url,
      }),
    });
    if (!res.ok) throw new Error("Navigation failed");
    return res.json();
  },

  async action(
    identity: EchoBrowserSessionIdentity,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${getBackendBaseURL()}/api/browser/action`, {
      method: "POST",
      headers: jsonAuthHeaders(),
      body: JSON.stringify({
        session_id: identity.sessionId,
        project_id: identity.projectId,
        profile_id: identity.profileId,
        action,
        ...params,
      }),
    });
    if (!res.ok) throw new Error("Action failed");
    return res.json();
  },

  async semanticSnapshot(
    identity: EchoBrowserSessionIdentity,
  ): Promise<BrowserSemanticSnapshot> {
    const res = await fetch(`${getBackendBaseURL()}/api/browser/action`, {
      method: "POST",
      headers: jsonAuthHeaders(),
      body: JSON.stringify({
        session_id: identity.sessionId,
        project_id: identity.projectId,
        profile_id: identity.profileId,
        action: "aria",
      }),
    });
    if (!res.ok) throw new Error("Semantic snapshot failed");
    const data = await res.json();
    const snapshot: BrowserSemanticSnapshot = data.nodes ?? {};
    return snapshot;
  },

  async queueReplayCase(sessionId: string): Promise<{ ok: boolean }> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/browser/session/replay-case/queue`,
      {
        method: "POST",
        headers: jsonAuthHeaders(),
        body: JSON.stringify({
          session_id: sessionId,
          reason: "agent preview handoff",
          priority: "normal",
        }),
      },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(data.detail || "Failed to queue replay case");
    }
    return res.json();
  },

  async screenshotBase64(
    sessionId: string,
  ): Promise<{ base64: string; width: number; height: number }> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/browser/screenshot/base64?session_id=${encodeURIComponent(sessionId)}`,
      { headers: authHeaders() },
    );
    if (!res.ok) throw new Error("Screenshot failed");
    return res.json();
  },

  async pageInfo(sessionId: string): Promise<PageInfo> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/browser/page-info?session_id=${encodeURIComponent(sessionId)}`,
      { headers: authHeaders() },
    );
    if (!res.ok) throw new Error("Failed to get page info");
    return res.json();
  },

  async actionLog(
    sessionId: string,
    limit = 50,
  ): Promise<{ actions: ActionLogEntry[] }> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/browser/action-log?session_id=${encodeURIComponent(sessionId)}&limit=${limit}`,
      { headers: authHeaders() },
    );
    if (!res.ok) return { actions: [] };
    return res.json();
  },

  async sessionHealth(sessionId: string): Promise<BrowserSessionHealth | null> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/browser/session/health?session_id=${encodeURIComponent(sessionId)}`,
      { headers: authHeaders() },
    );
    if (!res.ok) return null;
    return res.json();
  },
};
