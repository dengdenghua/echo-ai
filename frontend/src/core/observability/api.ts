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
import { looseBody } from "@/core/api/response";
import { isRecord } from "@/core/utils/guards";
import {
  hasDropped,
  hasSuccess,
  isActiveAlertList,
  isAlertRule,
  isAlertRuleList,
  isEvolutionStatus,
  isMetricsSummary,
  isReflectionReport,
  isSpanList,
  isTelemetryStats,
  isToolEffectAuthorizationResponse,
  isToolEffectsSnapshot,
  isTraceSummaryList,
} from "./guards";

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
  return looseBody(
    await apiGet("/api/metrics", {
      errorMessage: failed("Failed to get metrics"),
    }),
    isRecord,
  );
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  return looseBody(
    await apiGet("/api/metrics/summary", {
      errorMessage: failed("Failed to get metrics summary"),
    }),
    isMetricsSummary,
  );
}

export async function getTraces(limit = 100): Promise<TraceSummary[]> {
  return looseBody(
    await apiGet("/api/trace/recent", {
      query: { limit },
      errorMessage: failed("Failed to get traces"),
    }),
    isTraceSummaryList,
  );
}

export async function getTrace(traceId: string): Promise<Span[]> {
  return looseBody(
    await apiGet("/api/trace/{trace_id}", {
      path: { trace_id: traceId },
      errorMessage: failed("Failed to get trace"),
    }),
    isSpanList,
  );
}

export async function getAlerts(): Promise<ActiveAlert[]> {
  return looseBody(
    await apiGet("/api/alerts", {
      errorMessage: failed("Failed to get alerts"),
    }),
    isActiveAlertList,
  );
}

export async function getAlertRules(): Promise<AlertRule[]> {
  return looseBody(
    await apiGet("/api/alerts/rules", {
      errorMessage: failed("Failed to get alert rules"),
    }),
    isAlertRuleList,
  );
}

export async function createAlertRule(rule: AlertRule): Promise<AlertRule> {
  return looseBody(
    await apiPost("/api/alerts/rules", {
      body: rule,
      errorMessage: detailOr(failed("Failed to create alert rule")),
    }),
    isAlertRule,
  );
}

export async function deleteAlertRule(
  name: string,
): Promise<{ success: boolean; name: string }> {
  return looseBody(
    await apiDelete("/api/alerts/rules/{name}", {
      path: { name },
      errorMessage: failed("Failed to delete alert rule"),
    }),
    hasSuccess,
  );
}

export async function getTelemetryStats(): Promise<TelemetryStats> {
  return looseBody(
    await apiGet("/api/telemetry/stats", {
      errorMessage: failed("Failed to get telemetry stats"),
    }),
    isTelemetryStats,
  );
}

export async function getObservabilityHealth(): Promise<
  Record<string, unknown>
> {
  return looseBody(
    await apiGet("/api/observability/health", {
      errorMessage: failed("Failed to get observability health"),
    }),
    isRecord,
  );
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
      looseBody(
        await apiGet("/api/tool-effects", {
          query: { limit: safeLimit, cross_tenant: true },
          signal,
          errorMessage,
        }),
        isToolEffectsSnapshot,
      ),
  );
}

export async function authorizeToolEffectRetry(
  receipt: ToolEffectReceipt,
  reason: string,
): Promise<ToolEffectAuthorizationResponse> {
  return globalControlPlane("Failed to authorize retry", async (errorMessage) =>
    looseBody(
      await apiPost("/api/tool-effects/{effect_key}/authorize-retry", {
        path: { effect_key: receipt.effect_key },
        query: { cross_tenant: true },
        body: {
          confirm: "AUTHORIZE RETRY",
          fencing_token: receipt.fencing_token,
          reason,
        },
        errorMessage,
      }),
      isToolEffectAuthorizationResponse,
    ),
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
      looseBody(
        await apiGet("/api/evolution/status", {
          query: { cross_tenant: true },
          signal,
          errorMessage,
        }),
        isEvolutionStatus,
      ),
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
  return looseBody(
    await apiGet("/api/reflect", {
      errorMessage: failed("Failed to kick reflection"),
    }),
    isReflectionReport,
  );
}

export async function forgetRule(
  index: number,
): Promise<{ dropped: string; remaining: number }> {
  return globalControlPlane("Failed to delete rule", async (errorMessage) =>
    looseBody(
      await apiDelete("/api/evolution/rules/{index}", {
        path: { index },
        query: { cross_tenant: true },
        errorMessage,
      }),
      hasDropped,
    ),
  );
}

export async function forgetMemory(
  index: number,
): Promise<{ dropped: string; remaining: number }> {
  return globalControlPlane("Failed to delete memory", async (errorMessage) =>
    looseBody(
      await apiDelete("/api/evolution/memories/{index}", {
        path: { index },
        query: { cross_tenant: true },
        errorMessage,
      }),
      hasDropped,
    ),
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
