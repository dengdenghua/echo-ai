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
  TeamTask,
  TeamTaskProcessTimeline,
  UpdateTeamTaskInput,
} from "./types";
import { looseBody } from "@/core/api/response";
import {
  isDeleteTeamTaskResponse,
  isListTeamTasksResponse,
  isTeamTask,
  isTeamTaskProcessTimelineResponse,
} from "./guards";

/** Keep this module's historical error wording on ``EchoAPIError``. */
function failed(action: string) {
  return (failure: ApiFailure): string =>
    `${action} failed: ${failure.status}${
      failure.text ? ` ${failure.text}` : ` ${failure.statusText}`
    }`;
}

export async function listTasks(roomId?: string | null): Promise<TeamTask[]> {
  const data = looseBody(
    await apiGet("/api/team-tasks", {
      query: { room_id: roomId || undefined },
      errorMessage: failed("List team tasks"),
    }),
    isListTeamTasksResponse,
  );
  return data.tasks;
}

export async function createTask(
  input: CreateTeamTaskInput,
): Promise<TeamTask> {
  return looseBody(
    await apiPost("/api/team-tasks", {
      body: {
        ...input,
        description: input.description ?? "",
        sop_template: input.sop_template ?? "",
        assignees: input.assignees ?? [],
        metadata: input.metadata ?? {},
      },
      errorMessage: failed("Create team task"),
    }),
    isTeamTask,
  );
}

export async function updateTask(
  taskId: string,
  input: UpdateTeamTaskInput,
): Promise<TeamTask> {
  return looseBody(
    await apiPatch("/api/team-tasks/{task_id}", {
      path: { task_id: taskId },
      body: input,
      errorMessage: failed("Update team task"),
    }),
    isTeamTask,
  );
}

export async function deleteTask(
  taskId: string,
): Promise<DeleteTeamTaskResponse> {
  return looseBody(
    await apiDelete("/api/team-tasks/{task_id}", {
      path: { task_id: taskId },
      errorMessage: failed("Delete team task"),
    }),
    isDeleteTeamTaskResponse,
  );
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
  const data = looseBody(
    await apiGet("/api/team-tasks/{task_id}/process-timeline", {
      path: { task_id: taskId },
      errorMessage: failed("Load team task process timeline"),
    }),
    isTeamTaskProcessTimelineResponse,
  );
  return data.timeline;
}
