import { failureDetail, untypedApi, type ApiFailure } from "@/core/api/request";

export interface CoordinationTask {
  id: string;
  member_id: string;
  actor_id: string;
  title: string;
  status: string;
  result: string;
  dependencies: string[];
  waiting_for: string[];
  background?: boolean;
  created_at?: number;
}
export interface CoordinationMessage {
  id: string;
  source_id: string;
  target_id: string;
  kind: string;
  body: string;
  state: string;
  artifacts: { path: string; version: string; verification: string }[];
}
export interface CoordinationSnapshot {
  recruitment?: {
    id: string;
    candidate_id: string;
    reason: string;
    prompt: string;
    status: string;
    roster: string[];
  }[];
  can_manage?: boolean;
  tasks: CoordinationTask[];
  messages: CoordinationMessage[];
  resources: { resource: string; task_id: string; expires_at: number }[];
  events: { seq: number; task_id: string; kind: string; detail: string }[];
  actor_id: string;
  runner_enabled: boolean;
  can_write?: boolean;
}

export async function coordinationRequest<T>(
  threadId: string,
  suffix = "",
  body?: unknown,
): Promise<T> {
  const path = `/api/collab/${encodeURIComponent(threadId)}/coordination${suffix}`;
  const options = {
    reason: "callers pass a dynamic coordination sub-route suffix",
    body,
    errorMessage: (failure: ApiFailure) => {
      const detail = failureDetail(failure);
      return typeof detail === "string"
        ? detail
        : `请求失败 (${failure.status})`;
    },
  };
  return body === undefined
    ? untypedApi.get<T>(path, options)
    : untypedApi.post<T>(path, options);
}
