import {
  apiDelete,
  apiGet,
  apiPost,
  failureDetail,
  isApiErrorStatus,
  type ApiFailure,
} from "@/core/api/request";
import { getBackendBaseURL } from "@/core/config";
import { openSseStream } from "@/core/streaming/sse";

import type {
  ActiveAlert,
  AlertRule,
  MetricsSummary,
  Span,
  TelemetryStats,
  TraceSummary,
} from "./types";

/**
 * Process-global observability is intentionally separate from tenant-scoped
 * journal/progress/budget views.  The server requires both this explicit
 * opt-in and a principal with cross-tenant admin permission; keeping URL
 * construction here prevents individual panels from silently falling back to
 * an unscoped request that will always be rejected in shared deployments.
 */
export const GLOBAL_CONTROL_PLANE_ACCESS_CODE =
  "cross_tenant_admin_required" as const;

export class GlobalControlPlaneAccessError extends Error {
  readonly status = 403;
  readonly code = GLOBAL_CONTROL_PLANE_ACCESS_CODE;

  constructor() {
    super(GLOBAL_CONTROL_PLANE_ACCESS_CODE);
    this.name = "GlobalControlPlaneAccessError";
  }
}

export function globalControlPlaneUrl(path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${getBackendBaseURL()}${path}${separator}cross_tenant=true`;
}

export async function requireGlobalControlPlaneResponse(
  response: Response,
  fallback: string,
): Promise<void> {
  if (response.ok) return;
  if (response.status === 403) {
    throw new GlobalControlPlaneAccessError();
  }
  const payload = (await response.json().catch(() => ({}))) as {
    detail?: string;
  };
  throw new Error(payload.detail ?? `${fallback}: ${response.status}`);
}

/** ``"<label>: <statusText>"`` — this module's historical error wording. */
function failed(label: string) {
  return (failure: ApiFailure): string => `${label}: ${failure.statusText}`;
}

/** The body's ``detail`` when present, else ``fallback(failure)``. */
function detailOr(fallback: (failure: ApiFailure) => string) {
  return (failure: ApiFailure): string => {
    const detail = failureDetail(failure);
    return detail === undefined || detail === null
      ? fallback(failure)
      : String(detail);
  };
}

/**
 * Typed counterpart of ``requireGlobalControlPlaneResponse`` for calls made
 * with ``cross_tenant: true``: 403 becomes ``GlobalControlPlaneAccessError``,
 * anything else keeps the ``detail`` / ``"<fallback>: <status>"`` wording.
 */
async function globalControlPlane<T>(
  fallback: string,
  request: (errorMessage: (failure: ApiFailure) => string) => Promise<T>,
): Promise<T> {
  try {
    return await request(detailOr((f) => `${fallback}: ${f.status}`));
  } catch (error) {
    if (isApiErrorStatus(error, 403)) throw new GlobalControlPlaneAccessError();
    throw error;
  }
}

export async function getMetrics(): Promise<Record<string, unknown>> {
  return (await apiGet("/api/metrics", {
    errorMessage: failed("Failed to get metrics"),
  })) as Record<string, unknown>;
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  return (await apiGet("/api/metrics/summary", {
    errorMessage: failed("Failed to get metrics summary"),
  })) as MetricsSummary;
}

export async function getTraces(limit = 100): Promise<TraceSummary[]> {
  return (await apiGet("/api/trace/recent", {
    query: { limit },
    errorMessage: failed("Failed to get traces"),
  })) as TraceSummary[];
}

export async function getTrace(traceId: string): Promise<Span[]> {
  return (await apiGet("/api/trace/{trace_id}", {
    path: { trace_id: traceId },
    errorMessage: failed("Failed to get trace"),
  })) as Span[];
}

export async function getAlerts(): Promise<ActiveAlert[]> {
  return (await apiGet("/api/alerts", {
    errorMessage: failed("Failed to get alerts"),
  })) as ActiveAlert[];
}

export async function getAlertRules(): Promise<AlertRule[]> {
  return (await apiGet("/api/alerts/rules", {
    errorMessage: failed("Failed to get alert rules"),
  })) as AlertRule[];
}

export async function createAlertRule(rule: AlertRule): Promise<AlertRule> {
  return (await apiPost("/api/alerts/rules", {
    body: rule,
    errorMessage: detailOr(failed("Failed to create alert rule")),
  })) as AlertRule;
}

export async function deleteAlertRule(
  name: string,
): Promise<{ success: boolean; name: string }> {
  return (await apiDelete("/api/alerts/rules/{name}", {
    path: { name },
    errorMessage: failed("Failed to delete alert rule"),
  })) as { success: boolean; name: string };
}

export async function getTelemetryStats(): Promise<TelemetryStats> {
  return (await apiGet("/api/telemetry/stats", {
    errorMessage: failed("Failed to get telemetry stats"),
  })) as TelemetryStats;
}

export async function getObservabilityHealth(): Promise<
  Record<string, unknown>
> {
  return (await apiGet("/api/observability/health", {
    errorMessage: failed("Failed to get observability health"),
  })) as Record<string, unknown>;
}

export type ToolEffectState =
  | "claimed"
  | "started"
  | "committed"
  | "indeterminate"
  | "retry_authorized";

export interface ToolEffectReceipt {
  effect_key: string;
  task_id: string;
  step_id: number;
  sucker_id: string;
  side_effecting: boolean;
  state: ToolEffectState;
  holder_id: string;
  fencing_token: number;
  lease_expires_at: number;
  call_id: string;
  reason: string;
  updated_at: number;
  has_result: boolean;
}

export interface ToolEffectsSnapshot {
  backend: string;
  shared_across_hosts: boolean;
  can_authorize_retry: boolean;
  count: number;
  state_counts: Partial<Record<ToolEffectState, number>>;
  receipts: ToolEffectReceipt[];
}

export interface ToolEffectAuthorizationResponse {
  ok: boolean;
  effect_key: string;
  state: "retry_authorized";
  fencing_token: number;
  actor: string;
  audit_warning: string;
}

export async function getToolEffectsSnapshot({
  limit = 100,
  signal,
}: {
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<ToolEffectsSnapshot> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  return globalControlPlane(
    "Failed to load tool effects",
    async (errorMessage) =>
      (await apiGet("/api/tool-effects", {
        query: { limit: safeLimit, cross_tenant: true },
        signal,
        errorMessage,
      })) as ToolEffectsSnapshot,
  );
}

export async function authorizeToolEffectRetry(
  receipt: ToolEffectReceipt,
  reason: string,
): Promise<ToolEffectAuthorizationResponse> {
  return globalControlPlane(
    "Failed to authorize retry",
    async (errorMessage) =>
      (await apiPost("/api/tool-effects/{effect_key}/authorize-retry", {
        path: { effect_key: receipt.effect_key },
        query: { cross_tenant: true },
        body: {
          confirm: "AUTHORIZE RETRY",
          fencing_token: receipt.fencing_token,
          reason,
        },
        errorMessage,
      })) as ToolEffectAuthorizationResponse,
  );
}

// Implementation note.
// Implementation note.
// Implementation note.

export interface EvolutionStatus {
  enabled: boolean;
  reason?: string;
  rules_count?: number;
  memories_count?: number;
  rules_section?: string;
  memories_section?: string;
  rules_lines?: string[];
  memories_lines?: string[];
  trajectories?: {
    total: number;
    react_loop: number;
    react_loop_failures: number;
  };
  react_variants?: ReActVariantStat[];
}

export interface ReActVariantStat {
  name: string;
  max_iterations: number;
  temperature: number;
  assignments: number;
  successes: number;
  failures: number;
  success_rate: number;
}

export async function getEvolutionStatus(
  signal?: AbortSignal,
): Promise<EvolutionStatus> {
  return globalControlPlane(
    "Failed to get evolution status",
    async (errorMessage) =>
      (await apiGet("/api/evolution/status", {
        query: { cross_tenant: true },
        signal,
        errorMessage,
      })) as EvolutionStatus,
  );
}

export interface ReflectionReport {
  skill_forge?: unknown;
  rule_extractor?: { rules: number };
  kg?: { accepted: number; total: number };
  memory?: { memories: number };
  workflow?: { proposals: number; by_kind?: Record<string, number> };
  recipe?: { recipes: number; best: string | null };
  error?: string;
}

/* Implementation note. */
export async function kickReflection(): Promise<ReflectionReport> {
  return (await apiGet("/api/reflect", {
    errorMessage: failed("Failed to kick reflection"),
  })) as ReflectionReport;
}

export async function forgetRule(
  index: number,
): Promise<{ dropped: string; remaining: number }> {
  return globalControlPlane(
    "Failed to delete rule",
    async (errorMessage) =>
      (await apiDelete("/api/evolution/rules/{index}", {
        path: { index },
        query: { cross_tenant: true },
        errorMessage,
      })) as { dropped: string; remaining: number },
  );
}

export async function forgetMemory(
  index: number,
): Promise<{ dropped: string; remaining: number }> {
  return globalControlPlane(
    "Failed to delete memory",
    async (errorMessage) =>
      (await apiDelete("/api/evolution/memories/{index}", {
        path: { index },
        query: { cross_tenant: true },
        errorMessage,
      })) as { dropped: string; remaining: number },
  );
}

// Implementation note.

export interface FileOpEvent {
  event_type: "file_op";
  ts: string;
  task_id: string | null;
  arm_id: string | null;
  path: string;
  action: "create" | "write" | "edit" | "delete" | "rename";
  bytes_delta: number;
  old_size: number | null;
  new_size: number | null;
  sucker_id: string;
  /* Implementation note. */
  diff: string | null;
}

/* Implementation note. */
export function subscribeFileOps(
  onEvent: (e: FileOpEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  // Track the last seen SSE event id so a reconnect can resume from the
  // server's ``Last-Event-ID`` replay instead of losing the gap.
  let lastId: string | null = null;
  return openSseStream({
    url: `${getBackendBaseURL()}/api/files/stream`,
    lastEventId: () => lastId,
    onEvent: (msg) => {
      if (msg.id != null) lastId = msg.id;
      if (msg.event !== "file_op") return;
      try {
        onEvent(JSON.parse(msg.data) as FileOpEvent);
      } catch (e) {
        console.error("file_op parse failed", e, msg.data);
      }
    },
    onError,
  });
}

// ─── Preview refresh events ────────────────────────────────

export interface PreviewRefreshEvent {
  event_type: "preview_refresh";
  ts: string;
  target: string;
  trigger_path: string;
  reason: string;
}

/* Implementation note. */
export function subscribePreviewRefresh(
  onEvent: (e: PreviewRefreshEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  // Track the last seen SSE event id so a reconnect resumes from the
  // server's ``Last-Event-ID`` replay instead of losing the gap.
  let lastId: string | null = null;
  return openSseStream({
    url: `${getBackendBaseURL()}/api/preview/stream`,
    lastEventId: () => lastId,
    onEvent: (msg) => {
      if (msg.id != null) lastId = msg.id;
      if (msg.event !== "preview_refresh") return;
      try {
        onEvent(JSON.parse(msg.data) as PreviewRefreshEvent);
      } catch (e) {
        console.error("preview_refresh parse failed", e, msg.data);
      }
    },
    onError,
  });
}
