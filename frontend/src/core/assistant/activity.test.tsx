import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AssistantActivityRequestError,
  assistantActivityErrorMessage,
  assistantActivityRoute,
  listAssistantActivity,
  useAssistantActivity,
  type AssistantActivity,
} from "./activity";

const scope = vi.hoisted(() => ({
  baseURL: "/host-a",
  account: "alice",
}));
vi.mock("@/core/config", () => ({ getBackendBaseURL: () => scope.baseURL }));
vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test-session" }),
}));
vi.mock("@/providers/AuthProvider", () => ({
  useOptionalAuth: () => ({
    isLoading: false,
    authStatus: { enabled: true },
    isAuthenticated: true,
    user: { actor_id: scope.account, user_id: scope.account },
  }),
}));

const activity = (title: string): AssistantActivity => ({
  schema: "echo.assistant_activity.v1",
  items: [
    {
      id: "run:1",
      source: "run",
      title,
      status: "running",
      state: "working",
      updated_at: "2026-10-06T00:00:00Z",
      thread_id: "thread/1",
      project_id: null,
      room_id: null,
      task_id: null,
      run_id: "1",
      agent_ids: ["coder"],
      project_name: null,
      room_name: null,
      reason: null,
    },
  ],
  summary: { working: 1, attention: 0, completed: 0 },
  has_more: false,
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("assistant activity source and request boundaries", () => {
  beforeEach(() => {
    scope.baseURL = "/host-a";
    scope.account = "alice";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens an existing thread safely and never falls back to creating work", () => {
    expect(assistantActivityRoute({ thread_id: "thread/1?workspace=x" })).toBe(
      "/workspace/realtime/thread%2F1%3Fworkspace%3Dx",
    );
    expect(assistantActivityRoute({ thread_id: null })).toBeNull();
    expect(assistantActivityRoute({ thread_id: " " })).toBeNull();
    expect(assistantActivityRoute({ thread_id: "new" })).toBeNull();
  });

  it("uses the selected backend, credentials and abort signal", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json(activity("selected")));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await listAssistantActivity({ signal: controller.signal });
    expect(fetch).toHaveBeenCalledWith(
      "/host-a/api/assistant/activity?limit=100",
      {
        headers: { Authorization: "Bearer test-session" },
        signal: controller.signal,
      },
    );
  });

  it("reports service errors and rejects malformed activity instead of rendering it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ detail: "Access denied" }, { status: 403 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(listAssistantActivity()).rejects.toThrow("Access denied");
    fetch.mockResolvedValueOnce(
      Response.json({ ...activity("bad"), items: [{}] }),
    );
    await expect(listAssistantActivity()).rejects.toThrow(
      "invalid assistant activity",
    );
    fetch.mockResolvedValueOnce(
      Response.json({
        ...activity("bad source"),
        items: [{ ...activity("bad source").items[0], source: ["run"] }],
      }),
    );
    await expect(listAssistantActivity()).rejects.toThrow(
      "invalid assistant activity",
    );
  });

  it("does not read activity until the panel opens and cancels on unmount", async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { rerender, unmount } = renderHook(
      ({ open }) => useAssistantActivity(open),
      {
        initialProps: { open: false },
        wrapper: wrapper(),
      },
    );
    expect(fetch).not.toHaveBeenCalled();
    rerender({ open: true });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const signal = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
      .signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("gives actionable host, session and version errors without exposing raw server output", async () => {
    for (const [status, message] of [
      [401, "登录已失效"],
      [403, "没有权限"],
      [404, "更新或重启"],
      [503, "暂时无法响应"],
      [504, "超时"],
    ] as const) {
      const error = new AssistantActivityRequestError(
        "raw internal output",
        status,
      );
      expect(assistantActivityErrorMessage(error, true)).toContain(message);
      expect(assistantActivityErrorMessage(error, false)).not.toContain(
        "raw internal output",
      );
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(listAssistantActivity()).rejects.toMatchObject({
      kind: "network",
    });
    const invalid = new AssistantActivityRequestError(
      "bad JSON",
      200,
      "invalid_response",
    );
    expect(assistantActivityErrorMessage(invalid, true)).toContain(
      "格式不正确",
    );
  });

  it("preserves cancellation so the query does not report a disconnected host", async () => {
    const aborted = new DOMException("cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));
    await expect(listAssistantActivity()).rejects.toBe(aborted);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>old host</html>", { status: 200 }),
        ),
    );
    await expect(listAssistantActivity()).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it.each(["backend", "account"] as const)(
    "immediately hides the previous %s scope even if the new request fails",
    async (boundary) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(activity("private Alice activity")),
        )
        .mockResolvedValueOnce(
          Response.json({ detail: "Unavailable" }, { status: 503 }),
        );
      vi.stubGlobal("fetch", fetch);
      const { result, rerender } = renderHook(
        () => useAssistantActivity(true),
        {
          wrapper: wrapper(),
        },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.items[0]?.title).toBe(
        "private Alice activity",
      );
      if (boundary === "backend") scope.baseURL = "/host-b";
      else scope.account = "bob";
      rerender();
      expect(result.current.data).toBeUndefined();
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});
