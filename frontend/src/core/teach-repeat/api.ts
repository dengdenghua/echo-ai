/** API client for the Teach & Repeat system. */

import {
  apiFetch,
  apiGet,
  apiPost,
  apiPut,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

import type {
  AdaptiveReplayRequest,
  AppendRecordingEventsResponse,
  RecordingEvent,
  RecordingStatus,
  ReplayRequest,
  ReplayResult,
  StartRecordingRequest,
  StartRecordingResponse,
  StopRecordingRequest,
  StopRecordingResponse,
  TemplateListResponse,
  TemplateUpdateRequest,
  WorkflowTemplate,
} from "./types";
import { looseBody } from "@/core/api/response";
import {
  isAppendRecordingEventsResponse,
  isRecordingStatus,
  isReplayResult,
  isStartRecordingResponse,
  isStopRecordingResponse,
  isTemplateListResponse,
  isWorkflowTemplate,
} from "./guards";

/** ``label: statusText``, this module's historical error wording. */
function failed(label: string) {
  return (failure: ApiFailure): string => `${label}: ${failure.statusText}`;
}

/** The JSON ``detail`` of the error body when present, else ``failed``. */
function detailOr(label: string) {
  return (failure: ApiFailure): string => {
    const detail = failureDetail(failure);
    return detail === undefined || detail === null
      ? failed(label)(failure)
      : String(detail);
  };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export async function startRecording(
  request: StartRecordingRequest,
): Promise<StartRecordingResponse> {
  return looseBody(
    await apiPost("/api/teach-repeat/record/start", {
      body: request,
      errorMessage: detailOr("Failed to start recording"),
    }),
    isStartRecordingResponse,
  );
}

export async function stopRecording(
  request: StopRecordingRequest,
): Promise<StopRecordingResponse> {
  return looseBody(
    await apiPost("/api/teach-repeat/record/stop", {
      body: request,
      errorMessage: detailOr("Failed to stop recording"),
    }),
    isStopRecordingResponse,
  );
}

export async function appendRecordingEvents(
  threadId: string,
  events: RecordingEvent[],
): Promise<AppendRecordingEventsResponse> {
  return looseBody(
    await apiPost("/api/teach-repeat/record/events", {
      body: { thread_id: threadId, events },
      errorMessage: detailOr("Failed to append recording events"),
    }),
    isAppendRecordingEventsResponse,
  );
}

export async function getRecordingStatus(
  threadId: string,
): Promise<RecordingStatus> {
  return looseBody(
    await apiGet("/api/teach-repeat/record/status", {
      query: { thread_id: threadId },
      errorMessage: failed("Failed to get recording status"),
    }),
    isRecordingStatus,
  );
}

// ---------------------------------------------------------------------------
// Templates CRUD
// ---------------------------------------------------------------------------

export async function listTemplates(opts?: {
  skip?: number;
  limit?: number;
  search?: string;
  tag?: string;
}): Promise<TemplateListResponse> {
  return looseBody(
    await apiGet("/api/teach-repeat/templates", {
      query: {
        skip: opts?.skip,
        limit: opts?.limit,
        search: opts?.search || undefined,
        tag: opts?.tag || undefined,
      },
      errorMessage: failed("Failed to list templates"),
    }),
    isTemplateListResponse,
  );
}

export async function getTemplate(id: string): Promise<WorkflowTemplate> {
  return looseBody(
    await apiGet("/api/teach-repeat/templates/{template_id}", {
      path: { template_id: id },
      errorMessage: failed("Failed to get template"),
    }),
    isWorkflowTemplate,
  );
}

export async function updateTemplate(
  id: string,
  request: TemplateUpdateRequest,
): Promise<WorkflowTemplate> {
  return looseBody(
    await apiPut("/api/teach-repeat/templates/{template_id}", {
      path: { template_id: id },
      body: request,
      errorMessage: failed("Failed to update template"),
    }),
    isWorkflowTemplate,
  );
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch("delete", "/api/teach-repeat/templates/{template_id}", {
    path: { template_id: id },
    errorMessage: failed("Failed to delete template"),
  });
}

export async function duplicateTemplate(id: string): Promise<WorkflowTemplate> {
  return looseBody(
    await apiPost("/api/teach-repeat/templates/{template_id}/duplicate", {
      path: { template_id: id },
      errorMessage: failed("Failed to duplicate template"),
    }),
    isWorkflowTemplate,
  );
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export async function replayTemplate(
  id: string,
  request: ReplayRequest,
): Promise<ReplayResult> {
  return looseBody(
    await apiPost("/api/teach-repeat/templates/{template_id}/replay", {
      path: { template_id: id },
      body: request,
      errorMessage: detailOr("Failed to replay template"),
    }),
    isReplayResult,
  );
}

export async function replayAdaptive(
  id: string,
  request: AdaptiveReplayRequest,
): Promise<ReplayResult> {
  return untypedApi.post<ReplayResult>(
    `/api/teach-repeat/templates/${encodeURIComponent(id)}/replay-adaptive`,
    {
      reason:
        "templates/{id}/replay-adaptive is not in the OpenAPI snapshot (the " +
        "backend declares templates/{id}/replay/adaptive); URL kept as-is",
      body: request,
      errorMessage: detailOr("Failed to run adaptive replay"),
    },
  );
}
