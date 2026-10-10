import { QueryClient } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eventBus } from "@/core/events";
import { resetThreadAttentionForTests } from "@/core/notification/attention-store";
import type * as SystemNotify from "@/core/notification/system-notify";
import type { TasksListResponse } from "@/core/tasks/api";
import { renderWithProviders } from "@/test/harness";

import { AttentionNotifierHost } from "./attention-notifier-host";

const tasksState = vi.hoisted(() => ({
  current: {
    data: undefined as TasksListResponse | undefined,
    refetch: vi.fn(),
  },
}));

vi.mock("@/core/tasks/hooks", () => ({
  useTasks: () => tasksState.current,
}));

const notify = vi.hoisted(() => ({ show: vi.fn(() => true) }));

vi.mock("@/core/notification/system-notify", async (importOriginal) => ({
  ...(await importOriginal<typeof SystemNotify>()),
  showSystemNotification: notify.show,
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function setFocus(focused: boolean) {
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
}

function renderHost(initialRoute = "/workspace/realtime/t2") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  queryClient.setQueryData(
    ["threads", "search", { limit: 50 }, null],
    [{ thread_id: "t1", metadata: { title: "整理季度报表" }, values: {} }],
  );
  const view = renderWithProviders(
    <>
      <AttentionNotifierHost />
      <LocationProbe />
    </>,
    { initialRoute, locale: "zh-CN", queryClient },
  );
  return {
    ...view,
    rerenderHost: () =>
      view.rerender(
        <>
          <AttentionNotifierHost />
          <LocationProbe />
        </>,
      ),
  };
}

function publish(
  threadId: string,
  state: "running" | "waiting" | "done" | "error" | null,
  extra: Record<string, unknown> = {},
) {
  act(() => {
    eventBus.emit("thread:run-status", { threadId, state, ...extra });
  });
}

describe("<AttentionNotifierHost />", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    tasksState.current = { data: undefined, refetch: vi.fn() };
    notify.show.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetThreadAttentionForTests();
  });

  it("notifies a completion while Echo is in the background", () => {
    setFocus(false);
    renderHost("/workspace/realtime/t1");
    publish("t1", "running", { title: "写周报" });
    publish("t1", "done");
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(notify.show).toHaveBeenCalledTimes(1);
    expect(notify.show).toHaveBeenCalledWith(
      {
        title: "任务已完成",
        body: "写周报",
        tag: "echo-attention:t1",
        href: "/workspace/realtime/t1",
        threadId: "t1",
      },
      expect.objectContaining({ onClick: expect.any(Function) }),
    );
  });

  it("stays quiet for the focused thread but not for others", () => {
    setFocus(true);
    renderHost("/workspace/realtime/t1");
    publish("t1", "running");
    publish("t1", "waiting", { attention: { kind: "approval" } });
    expect(notify.show).not.toHaveBeenCalled();

    publish("t9", "running");
    publish("t9", "waiting", { attention: { kind: "approval" } });
    expect(notify.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "需要你的审批", threadId: "t9" }),
      expect.anything(),
    );
  });

  it("respects the master notification switch", () => {
    setFocus(false);
    window.localStorage.setItem(
      "echo.local-settings",
      JSON.stringify({ notification: { enabled: false } }),
    );
    try {
      renderHost();
      publish("t1", "running");
      publish("t1", "error");
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(notify.show).not.toHaveBeenCalled();
    } finally {
      window.localStorage.removeItem("echo.local-settings");
    }
  });

  it("announces background tasks from the polled task list", () => {
    setFocus(true);
    const view = renderHost();
    tasksState.current = {
      ...tasksState.current,
      data: {
        active: [
          {
            task_id: "task-1",
            thread_id: "t1",
            agent_id: "general",
            started_at: 1,
            current_iteration: 1,
            max_iterations: 10,
            tokens_spent: 0,
            cost_usd: 0,
            max_tokens: 0,
            max_usd: 0,
          },
        ],
      },
    };
    view.rerenderHost();
    tasksState.current = {
      ...tasksState.current,
      data: {
        paused: [
          {
            task_id: "task-1",
            thread_id: "t1",
            agent_id: "general",
            reason: "budget_near_limit",
            requested_at: 5,
            requested_by: "system",
            note: "",
          },
        ],
      },
    };
    view.rerenderHost();

    expect(notify.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "任务已暂停：预算已达上限",
        // Title resolved from the cached thread list.
        body: "整理季度报表\n点击前往处理。",
      }),
      expect.anything(),
    );
  });

  it("opens the thread when a desktop notification is clicked", () => {
    setFocus(false);
    let clicked: ((payload: unknown) => void) | undefined;
    window.echo = {
      notifications: { show: vi.fn(), isSupported: vi.fn() },
      on: vi.fn((channel: string, listener: (payload: unknown) => void) => {
        if (channel === "notification:clicked") clicked = listener;
        return () => undefined;
      }),
    } as unknown as NonNullable<Window["echo"]>;
    const view = renderHost();

    act(() => {
      clicked?.({ href: "//evil.example/x", threadId: "t1", tag: null });
    });
    expect(view.getByTestId("location")).toHaveTextContent(
      "/workspace/realtime/t2",
    );
    act(() => {
      clicked?.({ href: "/workspace/realtime/t1", threadId: "t1", tag: null });
    });
    expect(view.getByTestId("location")).toHaveTextContent(
      "/workspace/realtime/t1",
    );
  });

  it("polls the task list slowly while nothing is running", () => {
    setFocus(false);
    renderHost();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(tasksState.current.refetch).toHaveBeenCalledTimes(1);
  });
});
