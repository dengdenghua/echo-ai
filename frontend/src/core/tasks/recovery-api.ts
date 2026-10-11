import { apiPost, EchoAPIError } from "@/core/api/request";
import { AgentTraceRequestError } from "@/core/agent-trace/api";

export interface TaskResumeExecutionResult {
  schema: "echo.task_run_resume_execution.v1";
  accepted: boolean;
  state: "queued" | "turn_started" | "replayed";
  task_id: string;
  thread_id: string;
  turn_id: string | null;
  request_id: string;
}

export async function resumeTaskExecution(
  taskId: string,
  requestId: string,
): Promise<TaskResumeExecutionResult> {
  let result: unknown;
  try {
    result = await apiPost("/api/task-runs/{task_id}/resume-execution", {
      path: { task_id: taskId },
      body: { requestId, reason: "operator requested checkpoint recovery" },
    });
  } catch (error) {
    if (error instanceof EchoAPIError) {
      throw new AgentTraceRequestError(error.status, error.detail);
    }
    throw error;
  }
  if (!result || typeof result !== "object") {
    throw new Error("Invalid task recovery response");
  }
  const body = result as Record<string, unknown>;
  if (
    body.schema !== "echo.task_run_resume_execution.v1" ||
    typeof body.accepted !== "boolean" ||
    !["queued", "turn_started", "replayed"].includes(String(body.state)) ||
    body.task_id !== taskId ||
    typeof body.thread_id !== "string" ||
    typeof body.request_id !== "string"
  ) {
    throw new Error("Invalid task recovery response");
  }
  return body as unknown as TaskResumeExecutionResult;
}
