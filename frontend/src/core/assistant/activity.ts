import { useQuery } from "@tanstack/react-query";

import { authHeaders } from "@/core/auth/api";
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
  zh: boolean,
): string {
  if (error instanceof AssistantActivityRequestError) {
    if (error.kind === "network") {
      return zh
        ? "无法连接当前主机，请检查连接后重试。"
        : "Could not connect to the selected host. Check the connection and retry.";
    }
    if (error.kind === "invalid_response") {
      return zh
        ? "当前主机返回的活动记录格式不正确，请更新 Echo 后重试。"
        : "The selected host returned invalid activity. Update Echo and retry.";
    }
    if (error.status === 401) {
      return zh
        ? "当前主机的登录已失效，请重新连接或登录后重试。"
        : "Your session on this host has expired. Reconnect or sign in and retry.";
    }
    if (error.status === 403) {
      return zh
        ? "当前账号没有权限查看此主机的助手活动。"
        : "This account cannot view assistant activity on the selected host.";
    }
    if (error.status === 404) {
      return zh
        ? "当前主机尚未提供助手活动，请更新或重启 Echo 服务后重试。"
        : "Assistant activity is not available on this host. Update or restart its Echo service and retry.";
    }
    if (error.status === 408 || error.status === 504) {
      return zh
        ? "读取活动超时，请检查当前主机连接后重试。"
        : "Loading activity timed out. Check the host connection and retry.";
    }
    if (error.status === 429) {
      return zh
        ? "当前请求较多，请稍后刷新。"
        : "Too many requests. Refresh again shortly.";
    }
    if (error.status >= 500) {
      return zh
        ? "当前主机暂时无法响应，请稍后刷新或检查连接。"
        : "The selected host is temporarily unavailable. Refresh later or check its connection.";
    }
  }
  return error instanceof Error
    ? error.message
    : zh
      ? "无法读取活动，请稍后重试。"
      : "Could not load activity. Retry shortly.";
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

function isSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["working", "attention", "completed"].every(
      (key) => Number.isInteger(value[key]) && Number(value[key]) >= 0,
    )
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
    response = await fetch(`${baseURL}/api/assistant/activity?limit=100`, {
      headers: authHeaders(),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (isRecord(error) && error.name === "AbortError")) {
      throw error;
    }
    throw new AssistantActivityRequestError(
      "Could not connect to the selected Echo host",
      0,
      "network",
    );
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new AssistantActivityRequestError(
      isRecord(payload) && typeof payload.detail === "string"
        ? payload.detail
        : `Could not load assistant activity (${response.status})`,
      response.status,
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (
    !isRecord(data) ||
    data.schema !== "echo.assistant_activity.v1" ||
    !Array.isArray(data.items) ||
    !data.items.every(isItem) ||
    !isSummary(data.summary) ||
    typeof data.has_more !== "boolean"
  ) {
    throw new AssistantActivityRequestError(
      "Echo service returned invalid assistant activity",
      response.status,
      "invalid_response",
    );
  }
  return data as unknown as AssistantActivity;
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
