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
  return (await apiPost("/api/teach-repeat/record/start", {
    body: request,
    errorMessage: detailOr("Failed to start recording"),
  })) as StartRecordingResponse;
}

export async function stopRecording(
  request: StopRecordingRequest,
): Promise<StopRecordingResponse> {
  return (await apiPost("/api/teach-repeat/record/stop", {
    body: request,
    errorMessage: detailOr("Failed to stop recording"),
  })) as StopRecordingResponse;
}

export async function appendRecordingEvents(
  threadId: string,
  events: RecordingEvent[],
): Promise<AppendRecordingEventsResponse> {
  return (await apiPost("/api/teach-repeat/record/events", {
    body: { thread_id: threadId, events },
    errorMessage: detailOr("Failed to append recording events"),
  })) as AppendRecordingEventsResponse;
}

export async function getRecordingStatus(
  threadId: string,
): Promise<RecordingStatus> {
  return (await apiGet("/api/teach-repeat/record/status", {
    query: { thread_id: threadId },
    errorMessage: failed("Failed to get recording status"),
  })) as RecordingStatus;
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
  return (await apiGet("/api/teach-repeat/templates", {
    query: {
      skip: opts?.skip,
      limit: opts?.limit,
      search: opts?.search || undefined,
      tag: opts?.tag || undefined,
    },
    errorMessage: failed("Failed to list templates"),
  })) as TemplateListResponse;
}

export async function getTemplate(id: string): Promise<WorkflowTemplate> {
  return (await apiGet("/api/teach-repeat/templates/{template_id}", {
    path: { template_id: id },
    errorMessage: failed("Failed to get template"),
  })) as WorkflowTemplate;
}

export async function updateTemplate(
  id: string,
  request: TemplateUpdateRequest,
): Promise<WorkflowTemplate> {
  return (await apiPut("/api/teach-repeat/templates/{template_id}", {
    path: { template_id: id },
    body: request,
    errorMessage: failed("Failed to update template"),
  })) as WorkflowTemplate;
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch("delete", "/api/teach-repeat/templates/{template_id}", {
    path: { template_id: id },
    errorMessage: failed("Failed to delete template"),
  });
}

export async function duplicateTemplate(id: string): Promise<WorkflowTemplate> {
  return (await apiPost("/api/teach-repeat/templates/{template_id}/duplicate", {
    path: { template_id: id },
    errorMessage: failed("Failed to duplicate template"),
  })) as WorkflowTemplate;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export async function replayTemplate(
  id: string,
  request: ReplayRequest,
): Promise<ReplayResult> {
  return (await apiPost("/api/teach-repeat/templates/{template_id}/replay", {
    path: { template_id: id },
    body: request,
    errorMessage: detailOr("Failed to replay template"),
  })) as ReplayResult;
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
