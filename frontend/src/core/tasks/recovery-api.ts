import { apiPost, EchoAPIError } from "@/core/api/request";
import { AgentTraceRequestError } from "@/core/agent-trace/api";
import { isRecord } from "@/core/utils/guards";

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
  if (!isRecord(result)) {
    throw new Error("Invalid task recovery response");
  }
  if (
    result.schema !== "echo.task_run_resume_execution.v1" ||
    typeof result.accepted !== "boolean" ||
    (result.state !== "queued" &&
      result.state !== "turn_started" &&
      result.state !== "replayed") ||
    result.task_id !== taskId ||
    typeof result.thread_id !== "string" ||
    (result.turn_id !== null && typeof result.turn_id !== "string") ||
    typeof result.request_id !== "string"
  ) {
    throw new Error("Invalid task recovery response");
  }
  return {
    schema: result.schema,
    accepted: result.accepted,
    state: result.state,
    task_id: result.task_id,
    thread_id: result.thread_id,
    turn_id: result.turn_id,
    request_id: result.request_id,
  };
}
