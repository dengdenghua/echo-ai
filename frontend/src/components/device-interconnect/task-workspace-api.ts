import { authHeaders as authHeader } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

export type TaskStage = { device_id: string; task: string };

export type DeviceTask = {
  stages?: TaskStage[];
  stage_index?: number;
  stage_status?: string;
  stage_history?: (TaskStage & {
    results: DeviceTask["results"];
    result_review: DeviceTask["result_review"];
  })[];
  id: string;
  task: string;
  device_id: string;
  source_device: string | null;
  status: string;
  current_step: number;
  in_flight_step: number | null;
  steps: { action: string; arguments: Record<string, unknown> }[];
  results: {
    step: number;
    action: string;
    success: boolean;
    summary?: string;
    error?: string;
  }[];
  revision: string;
  busy: boolean;
  result_review?: {
    outcome: "achieved" | "not_achieved";
    reviewed_by: string;
    reviewed_at: number;
    revision: string;
  } | null;
  error?: string;
};
export async function taskWorkspaceRequest<T>(
  command: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/tentacle/task-workspace/${command}`,
    {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof result?.detail === "string" ? result.detail : "任务服务暂不可用",
    );
  if (!result || typeof result !== "object")
    throw new Error("设备中心响应不完整");
  return result as T;
}
