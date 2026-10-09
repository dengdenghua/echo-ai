import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

import type {
  CreateTeamTaskInput,
  DeleteTeamTaskResponse,
  ListTeamTasksResponse,
  TeamTask,
  TeamTaskProcessTimeline,
  TeamTaskProcessTimelineResponse,
  UpdateTeamTaskInput,
} from "./types";

/** Keep this module's historical error wording on ``EchoAPIError``. */
function failed(action: string) {
  return (failure: ApiFailure): string =>
    `${action} failed: ${failure.status}${
      failure.text ? ` ${failure.text}` : ` ${failure.statusText}`
    }`;
}

export async function listTasks(roomId?: string | null): Promise<TeamTask[]> {
  const data = (await apiGet("/api/team-tasks", {
    query: { room_id: roomId || undefined },
    errorMessage: failed("List team tasks"),
  })) as ListTeamTasksResponse;
  return data.tasks;
}

export async function createTask(
  input: CreateTeamTaskInput,
): Promise<TeamTask> {
  return (await apiPost("/api/team-tasks", {
    body: {
      ...input,
      description: input.description ?? "",
      sop_template: input.sop_template ?? "",
      assignees: input.assignees ?? [],
      metadata: input.metadata ?? {},
    },
    errorMessage: failed("Create team task"),
  })) as TeamTask;
}

export async function updateTask(
  taskId: string,
  input: UpdateTeamTaskInput,
): Promise<TeamTask> {
  return (await apiPatch("/api/team-tasks/{task_id}", {
    path: { task_id: taskId },
    body: input,
    errorMessage: failed("Update team task"),
  })) as TeamTask;
}

export async function deleteTask(
  taskId: string,
): Promise<DeleteTeamTaskResponse> {
  return (await apiDelete("/api/team-tasks/{task_id}", {
    path: { task_id: taskId },
    errorMessage: failed("Delete team task"),
  })) as DeleteTeamTaskResponse;
}

export async function runTask(taskId: string): Promise<TeamTask> {
  return untypedApi.post<TeamTask>(
    `/api/team-tasks/${encodeURIComponent(taskId)}/run`,
    {
      reason:
        "POST /api/team-tasks/{task_id}/run declares no request body in the OpenAPI snapshot; the client has always sent {}",
      body: {},
      errorMessage: failed("Run team task"),
    },
  );
}

export async function getTaskProcessTimeline(
  taskId: string,
): Promise<TeamTaskProcessTimeline> {
  const data = (await apiGet("/api/team-tasks/{task_id}/process-timeline", {
    path: { task_id: taskId },
    errorMessage: failed("Load team task process timeline"),
  })) as TeamTaskProcessTimelineResponse;
  return data.timeline;
}
