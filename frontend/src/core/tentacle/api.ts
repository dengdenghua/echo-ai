/**
 * Tentacle (Mobile Device) API client.
 *
 * Wraps the REST endpoints exposed by `runtime.tentacle.dashboard`:
 *   GET  /api/tentacle/devices          — list connected devices
 *   GET  /api/tentacle/devices/:id      — device detail
 *   POST /api/tentacle/task             — submit natural-language task
 *   GET  /api/tentacle/tasks            — task history
 *   GET  /api/tentacle/stats            — coordinator stats
 */

import {
  apiFetch,
  apiGet,
  apiPost,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";
import { looseBody } from "@/core/api/response";
import { isRecord } from "@/core/utils/guards";
import {
  hasLastScreenStats,
  hasSamples,
  hasScreenStats,
  hasSuccess,
  isDeviceHealth,
  isDeviceLease,
  isDeviceProcedureList,
  isPcScreenStats,
  isScreenAnalysis,
  isSimulationReport,
  isTaskRecord,
  isTaskRecordList,
  isTentacleDevice,
  isTentacleDeviceList,
  isTentacleStats,
} from "./guards";

// ── Types ──────────────────────────────────────────────

export interface TentacleDevice {
  tentacle_id: string;
  type: string;
  platform: string;
  status: "online" | "offline" | "busy" | "connecting";
  is_online: boolean;
  is_busy: boolean;
  capabilities: string[];
  total_capabilities: number;
  last_used_ago: number | null;
  meta: Record<string, unknown>;
  health?: DeviceHealth;
}

export interface DeviceHealth {
  device_id: string;
  level: "healthy" | "degraded" | "unhealthy" | "offline";
  score: number;
  reasons: string[];
  heartbeat_age_s?: number;
}

export interface TaskStep {
  call_id: string;
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  data: string | null;
  error: string | null;
  duration_ms: number;
}

export interface TaskRecord {
  task_id: string;
  task: string;
  tentacle_id: string;
  success: boolean;
  steps: number;
  results: TaskStep[];
  duration_ms: number;
  timestamp: number;
  error?: string;
}

export interface TentacleStats {
  pool: {
    total: number;
    online: number;
    busy: number;
    offline: number;
  };
  ws_connected: number;
}

export interface SkillInfo {
  name: string;
  description?: string;
  category?: string;
  enabled?: boolean;
}

export interface DeviceLease {
  leased: boolean;
  lease: null | {
    owner: string;
    task_id: string;
    lease_id: string;
    expires_in_s: number;
  };
}

export interface DeviceProcedure {
  procedure_id: string;
  device_id: string;
  status:
    | "draft"
    | "running"
    | "paused"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "emergency_stopped";
  current_step: number;
  steps: Array<{
    step_id: string;
    action: string;
    arguments: Record<string, unknown>;
  }>;
  receipt_ids: string[];
  error: string | null;
  updated_at: number;
}

// ── VLM / Screen-stream types ──────────────────────────

export interface SuggestedAction {
  action: string; // "tap", "swipe", "type" etc.
  target: string; // target description
  coordinates: [number, number] | null;
  text: string | null;
  confidence: number;
}

export interface ScreenAnalysis {
  description: string;
  suggested_actions: SuggestedAction[];
  current_app: string | null;
  screen_state: string;
}

// ── API ────────────────────────────────────────────────

/** ``body.detail`` when truthy, else the status text — the historical wording. */
function failed(failure: ApiFailure): string {
  return String(failureDetail(failure) || failure.statusText);
}

/**
 * Options every JSON tentacle call shares. The client has always sent a JSON
 * content type, including on bodiless GETs.
 */
const JSON_CALL = {
  headers: { "Content-Type": "application/json" },
  errorMessage: failed,
};

export async function listDevices(signal?: AbortSignal): Promise<TentacleDevice[]> {
  return looseBody(await apiGet("/api/tentacle/devices", {
    ...JSON_CALL,
    signal,
  }), isTentacleDeviceList);
}

export async function getDevice(tentacleId: string): Promise<TentacleDevice> {
  return looseBody(await apiGet("/api/tentacle/devices/{tentacle_id}", {
    ...JSON_CALL,
    path: { tentacle_id: tentacleId },
  }), isTentacleDevice);
}

export async function getDeviceManifest(
  tentacleId: string,
): Promise<Record<string, unknown>> {
  return looseBody(await apiGet("/api/tentacle/devices/{tentacle_id}/manifest", {
    ...JSON_CALL,
    path: { tentacle_id: tentacleId },
  }), isRecord);
}

export async function getDeviceLease(tentacleId: string): Promise<DeviceLease> {
  return looseBody(await apiGet("/api/tentacle/devices/{tentacle_id}/lease", {
    ...JSON_CALL,
    path: { tentacle_id: tentacleId },
  }), isDeviceLease);
}

export async function getDeviceHealth(
  tentacleId: string,
): Promise<DeviceHealth> {
  return looseBody(await apiGet("/api/tentacle/devices/{tentacle_id}/health", {
    ...JSON_CALL,
    path: { tentacle_id: tentacleId },
  }), isDeviceHealth);
}

export async function getDeviceTelemetry(
  tentacleId: string,
  metric?: string,
): Promise<{
  samples: Array<Record<string, unknown>>;
  faults: Array<Record<string, unknown>>;
}> {
  return looseBody(await apiGet("/api/tentacle/devices/{tentacle_id}/telemetry", {
    ...JSON_CALL,
    path: { tentacle_id: tentacleId },
    query: { metric: metric || undefined },
  }), hasSamples);
}

export async function listProcedures(): Promise<DeviceProcedure[]> {
  return looseBody(await apiGet("/api/tentacle/procedures", {
    ...JSON_CALL,
  }), isDeviceProcedureList);
}

export async function controlProcedure(
  procedureId: string,
  action: "run" | "pause" | "resume" | "cancel" | "emergency-stop",
): Promise<DeviceProcedure> {
  return untypedApi.post<DeviceProcedure>(
    `/api/tentacle/procedures/${encodeURIComponent(procedureId)}/${action}`,
    {
      reason:
        "dynamic action segment; pause/cancel/emergency-stop declare no body but the client sends {}",
      ...JSON_CALL,
      body: {},
    },
  );
}

export interface SimulationReport {
  procedure_id: string;
  device_id: string;
  success: boolean;
  initial_state: Record<string, unknown>;
  final_state: Record<string, unknown>;
  errors: string[];
  steps: Array<{
    step_id: string;
    action: string;
    success: boolean;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    errors: string[];
    warnings: string[];
  }>;
}

export async function dryRunProcedure(
  procedureId: string,
  scenario?: {
    initial_state?: Record<string, unknown>;
    injected_faults?: Record<string, string>;
  },
): Promise<SimulationReport> {
  return looseBody(await apiPost("/api/tentacle/procedures/{procedure_id}/dry-run", {
    ...JSON_CALL,
    path: { procedure_id: procedureId },
    body: scenario ?? {},
  }), isSimulationReport);
}

export async function submitTask(
  task: string,
  tentacleId?: string,
): Promise<TaskRecord> {
  const body: Record<string, string> = { task };
  if (tentacleId) body.tentacle_id = tentacleId;
  return looseBody(await apiPost("/api/tentacle/task", {
    ...JSON_CALL,
    body,
  }), isTaskRecord);
}

export async function listTasks(): Promise<TaskRecord[]> {
  return looseBody(await apiGet("/api/tentacle/tasks", {
    ...JSON_CALL,
  }), isTaskRecordList);
}

export async function getStats(): Promise<TentacleStats> {
  return looseBody(await apiGet("/api/tentacle/stats", {
    ...JSON_CALL,
  }), isTentacleStats);
}

// ── VLM / Screenshot ───────────────────────────────────

export async function analyzeDevice(
  tentacleId: string,
  task: string,
): Promise<ScreenAnalysis> {
  return looseBody(await apiPost("/api/tentacle/devices/{tentacle_id}/analyze", {
    ...JSON_CALL,
    path: { tentacle_id: tentacleId },
    body: { task },
  }), isScreenAnalysis);
}

export async function getDeviceScreenshot(tentacleId: string): Promise<Blob> {
  const res = await apiFetch(
    "get",
    "/api/tentacle/devices/{tentacle_id}/screenshot",
    {
      path: { tentacle_id: tentacleId },
      // This call has always been origin-relative (no backend base URL).
      baseUrl: "",
      errorMessage: failed,
    },
  );
  return res.blob();
}

// ── PC Screen Capture ──────────────────────────────────

export interface PcScreenStats {
  running: boolean;
  frame_count: number;
  last_frame_ts: number;
  avg_frame_size_kb: number;
  errors: number;
  config: {
    fps: number;
    scale: number;
    jpeg_quality: number;
    backend: string;
  };
}

export async function startPcScreenCapture(opts?: {
  fps?: number;
  scale?: number;
  quality?: number;
}): Promise<{ status: string; stats: PcScreenStats }> {
  return looseBody(await apiPost("/api/tentacle/pc-screen/start", {
    ...JSON_CALL,
    body: opts || {},
  }), hasScreenStats);
}

export async function stopPcScreenCapture(): Promise<{
  status: string;
  last_stats: PcScreenStats;
}> {
  return looseBody(await apiPost("/api/tentacle/pc-screen/stop", {
    ...JSON_CALL,
  }), hasLastScreenStats);
}

export async function getPcScreenStats(): Promise<PcScreenStats> {
  return looseBody(await apiGet("/api/tentacle/pc-screen/stats", {
    ...JSON_CALL,
  }), isPcScreenStats);
}

// ── Skills ─────────────────────────────────────────────

export async function listSkills(): Promise<SkillInfo[]> {
  return untypedApi.get<SkillInfo[]>("/api/tentacle/skills", {
    reason: "the tentacle skills route is not in the OpenAPI snapshot",
    ...JSON_CALL,
  });
}

// ── Remote Input ───────────────────────────────────────

export interface RemoteInputEvent {
  action:
    | "tap"
    | "double_tap"
    | "long_press"
    | "swipe"
    | "type_text"
    | "key_press"
    | "click"
    | "double_click"
    | "right_click"
    | "middle_click"
    | "mouse_move"
    | "drag_start"
    | "drag_move"
    | "drag_end"
    | "scroll"
    | "zoom"
    | "key_combo";
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  dx?: number;
  dy?: number;
  deltaX?: number;
  deltaY?: number;
  duration_ms?: number;
  text?: string;
  key?: string;
  button?: "left" | "right" | "middle";
}

export async function sendRemoteInput(
  event: RemoteInputEvent,
): Promise<{ success: boolean; error: string | null }> {
  return looseBody(await apiPost("/api/tentacle/remote-input", {
    ...JSON_CALL,
    body: event,
  }), hasSuccess);
}
