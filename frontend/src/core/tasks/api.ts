import {
  apiFetch,
  apiGet,
  apiPost,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

export type PauseReason =
  | "user_request"
  | "budget_near_limit"
  | "iteration_near_limit"
  | "model_spinning"
  | "client_disconnect"
  | "approval_required"
  | "external";

export interface PauseRequest {
  task_id: string;
  reason: PauseReason;
  requested_at: number;
  requested_by: string;
  note: string;
  thread_id: string;
  agent_id: string;
}

export interface ActiveTask {
  task_id: string;
  thread_id: string;
  agent_id: string;
  started_at: number;
  current_iteration: number;
  max_iterations: number;
  /** Cumulative model accounting across every call in this task. */
  tokens_spent: number;
  input_tokens_spent?: number;
  output_tokens_spent?: number;
  cache_read_tokens?: number;
  /** Provider-reported size of the latest live model request. */
  current_context_tokens?: number;
  context_capacity_tokens?: number;
  context_utilization?: number;
  cost_usd: number;
  max_tokens: number;
  max_usd: number;
}

export interface TasksListResponse {
  paused?: PauseRequest[];
  pending?: PauseRequest[];
  active?: ActiveTask[];
}

export interface TaskCheckpoint {
  iteration_completed: number;
  max_iterations: number;
  steps_count: number;
  has_final_answer: boolean;
}

export interface TaskDetail {
  task_id: string;
  is_pending_pause: boolean;
  is_paused: boolean;
  pause_request: PauseRequest | null;
  last_checkpoint?: TaskCheckpoint;
}

export interface ResumeTaskResponse {
  ok: boolean;
  task_id: string;
  extra_tokens: number;
  extra_iterations: number;
  message: string;
}

/** ``"<label>: <statusText>"`` — this module's read-error wording. */
function failed(label: string) {
  return (failure: ApiFailure): string => `${label}: ${failure.statusText}`;
}

/** ``"<label>: <status> <body or statusText>"`` — the write-error wording. */
function failedWithBody(label: string) {
  return (failure: ApiFailure): string =>
    `${label}: ${failure.status} ${failure.text || failure.statusText}`;
}

export async function listTasks(
  status?: "paused" | "pending" | "active" | "all",
  signal?: AbortSignal,
): Promise<TasksListResponse> {
  return untypedApi.get<TasksListResponse>("/api/tasks", {
    reason:
      "GET /api/tasks query `status` is not declared in the OpenAPI snapshot (only workspace_path is)",
    query: { status: status || undefined },
    signal,
    errorMessage: failed("Failed to list tasks"),
  });
}

export async function getTask(taskId: string): Promise<TaskDetail> {
  return (await apiGet("/api/tasks/{task_id}", {
    path: { task_id: taskId },
    errorMessage: failed("Failed to load task"),
  })) as TaskDetail;
}

export async function pauseTask(
  taskId: string,
  reason: PauseReason = "user_request",
  note = "",
): Promise<{ ok: boolean; request: PauseRequest }> {
  return (await apiPost("/api/tasks/{task_id}/pause", {
    path: { task_id: taskId },
    body: { reason, note },
    errorMessage: failedWithBody("Failed to pause"),
  })) as { ok: boolean; request: PauseRequest };
}

export async function resumeTask(
  taskId: string,
  opts: {
    extra_iterations?: number;
    extra_tokens?: number;
    extra_usd?: number;
  } = {},
): Promise<ResumeTaskResponse> {
  return (await apiPost("/api/tasks/{task_id}/resume", {
    path: { task_id: taskId },
    body: opts,
    errorMessage: failedWithBody("Failed to resume"),
  })) as ResumeTaskResponse;
}

export async function deleteTask(taskId: string): Promise<void> {
  // The success body is not read, exactly as before.
  await apiFetch("delete", "/api/tasks/{task_id}", {
    path: { task_id: taskId },
    errorMessage: failedWithBody("Failed to delete"),
  });
}
