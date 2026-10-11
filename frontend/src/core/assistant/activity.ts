import { useQuery } from "@tanstack/react-query";

import { assistantActivityCopy } from "@/core/i18n/locales/assistant-activity";

import { apiFetch, EchoAPIError } from "@/core/api/request";
import { getBackendBaseURL } from "@/core/config";
import { useOptionalAuth } from "@/providers/AuthProvider";

export type AssistantActivityState = "working" | "attention" | "completed";

export interface AssistantActivityItem {
  id: string;
  source: "run" | "project_task" | "collaboration_task";
  title: string;
  status: string;
  state: AssistantActivityState;
  updated_at: string;
  thread_id: string | null;
  project_id: string | null;
  room_id: string | null;
  task_id: string | null;
  run_id: string | null;
  agent_ids: string[];
  project_name: string | null;
  room_name: string | null;
  reason: string | null;
}

export interface AssistantActivity {
  schema: "echo.assistant_activity.v1";
  items: AssistantActivityItem[];
  summary: Record<AssistantActivityState, number>;
  has_more: boolean;
}

export class AssistantActivityRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: "http" | "network" | "invalid_response" = "http",
  ) {
    super(message);
    this.name = "AssistantActivityRequestError";
  }
}

export function assistantActivityErrorMessage(
  error: unknown,
  locale: string | boolean,
): string {
  const copy = assistantActivityCopy(locale).errors;
  if (error instanceof AssistantActivityRequestError) {
    if (error.kind === "network") return copy.network;
    if (error.kind === "invalid_response") return copy.invalid;
    if (error.status === 401) return copy.session;
    if (error.status === 403) return copy.forbidden;
    if (error.status === 404) return copy.unavailable;
    if (error.status === 408 || error.status === 504) return copy.timeout;
    if (error.status === 429) return copy.busy;
    if (error.status >= 500) return copy.server;
  }
  return error instanceof Error ? error.message : copy.unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isItem(value: unknown): value is AssistantActivityItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.source === "string" &&
    ["run", "project_task", "collaboration_task"].includes(value.source) &&
    typeof value.state === "string" &&
    ["working", "attention", "completed"].includes(value.state) &&
    ["title", "status", "updated_at"].every(
      (key) => typeof value[key] === "string",
    ) &&
    [
      "thread_id",
      "project_id",
      "room_id",
      "task_id",
      "run_id",
      "project_name",
      "room_name",
      "reason",
    ].every((key) => value[key] === null || typeof value[key] === "string") &&
    Array.isArray(value.agent_ids) &&
    value.agent_ids.every((id) => typeof id === "string")
  );
}

function isSummary(value: unknown): value is AssistantActivity["summary"] {
  return (
    isRecord(value) &&
    ["working", "attention", "completed"].every(
      (key) => Number.isInteger(value[key]) && Number(value[key]) >= 0,
    )
  );
}

function isActivity(value: unknown): value is AssistantActivity {
  return (
    isRecord(value) &&
    value.schema === "echo.assistant_activity.v1" &&
    Array.isArray(value.items) &&
    value.items.every(isItem) &&
    isSummary(value.summary) &&
    typeof value.has_more === "boolean"
  );
}

export async function listAssistantActivity({
  signal,
  baseURL = getBackendBaseURL(),
}: {
  signal?: AbortSignal;
  baseURL?: string;
} = {}): Promise<AssistantActivity> {
  let response: Response;
  try {
    response = await apiFetch("get", "/api/assistant/activity", {
      query: { limit: 100 },
      baseUrl: baseURL,
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (isRecord(error) && error.name === "AbortError")) {
      throw error;
    }
    if (error instanceof EchoAPIError) {
      throw new AssistantActivityRequestError(error.message, error.status);
    }
    throw new AssistantActivityRequestError(
      "Could not connect to the selected Echo host",
      0,
      "network",
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!isActivity(data)) {
    throw new AssistantActivityRequestError(
      "Echo service returned invalid assistant activity",
      response.status,
      "invalid_response",
    );
  }
  return data;
}

export function useAssistantActivityScope() {
  const auth = useOptionalAuth();
  const baseURL = getBackendBaseURL();
  const account = auth?.isLoading
    ? "auth-loading"
    : auth?.user?.actor_id ||
      auth?.user?.user_id ||
      (auth?.authStatus?.enabled ? "signed-out" : "local");
  return {
    baseURL,
    queryKey: [
      "assistant-activity",
      baseURL,
      auth?.user?.provider ?? "",
      account,
    ] as const,
    available:
      !auth?.isLoading &&
      (!auth?.authStatus?.enabled || !!auth?.isAuthenticated),
  };
}

export function useAssistantActivity(open: boolean) {
  const { baseURL, queryKey, available } = useAssistantActivityScope();
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => listAssistantActivity({ signal, baseURL }),
    enabled: open && available,
    staleTime: 10_000,
    refetchInterval: open ? 15_000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** Only existing source threads can be opened; this view never creates work. */
export function assistantActivityRoute(
  item: Pick<AssistantActivityItem, "thread_id">,
): string | null {
  const threadId = item.thread_id;
  if (!threadId?.trim() || threadId === "new") return null;
  return `/workspace/realtime/${encodeURIComponent(threadId)}`;
}
