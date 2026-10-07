import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ReactRouterDOM from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assistantActivityErrorMessage,
  useAssistantActivity,
  type AssistantActivityItem,
} from "@/core/assistant/activity";
import { renderWithProviders } from "@/test/harness";

import { AssistantActivityPanel } from "./assistant-activity-panel";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouterDOM>()),
  useNavigate: () => navigate,
}));
vi.mock("@/core/assistant/activity", () => ({
  useAssistantActivity: vi.fn(),
  assistantActivityErrorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
  assistantActivityRoute: (item: AssistantActivityItem) =>
    item.thread_id
      ? `/workspace/realtime/${encodeURIComponent(item.thread_id)}`
      : null,
}));

function item(
  overrides: Partial<AssistantActivityItem> = {},
): AssistantActivityItem {
  return {
    id: "run-1",
    source: "run",
    title: "Review the change",
    status: "running",
    state: "working",
    updated_at: "2026-10-05T09:30:00Z",
    thread_id: "thread-1",
    project_id: null,
    room_id: null,
    task_id: null,
    run_id: "run-1",
    agent_ids: ["assistant"],
    project_name: null,
    room_name: null,
    reason: null,
    ...overrides,
  };
}

const items = [
  item(),
  item({
    id: "project-task-1",
    source: "project_task",
    title: "Await review",
    state: "attention",
    status: "waiting_approval",
    project_id: "project-1",
    project_name: "Echo",
    reason: "Review the prepared patch before continuing.",
  }),
  item({
    id: "collab-task-1",
    source: "collaboration_task",
    title: "Research finished",
    state: "completed",
    status: "completed",
    room_id: "room-1",
    room_name: "Design room",
    agent_ids: ["researcher", "designer"],
    thread_id: null,
  }),
];

function result(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      schema: "echo.assistant_activity.v1",
      items,
      summary: { working: 1, attention: 1, completed: 1 },
      has_more: false,
    },
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.parse("2026-10-05T09:40:00Z"),
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAssistantActivity>;
}

describe("AssistantActivityPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assistantActivityErrorMessage).mockImplementation((error) =>
      error instanceof Error ? error.message : String(error),
    );
    vi.mocked(useAssistantActivity).mockReturnValue(result());
  });

  it("shows readable task states with their original values and filters source records", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssistantActivityPanel open onOpenChange={vi.fn()} />);
    expect(
      screen.getByRole("dialog", { name: "Assistant activity" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Waiting for approval")).toHaveAttribute(
      "title",
      "waiting_approval",
    );
    expect(screen.getByText("Project: Echo")).toBeInTheDocument();
    expect(screen.getByText("Room: Design room")).toBeInTheDocument();
    expect(
      screen.getByText("Agents: researcher, designer"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Needs attention/ }));
    expect(screen.getByText("Await review")).toBeInTheDocument();
    expect(
      screen.getByText("Review the prepared patch before continuing."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Review the change")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Completed/ }));
    expect(screen.getByText("Research finished")).toBeInTheDocument();
    expect(screen.queryByText("Await review")).not.toBeInTheDocument();
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument();
  });

  it("keeps loaded records visible during refresh and explicitly marks a failed refresh", () => {
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({ isFetching: true }),
    );
    const view = renderWithProviders(
      <AssistantActivityPanel open onOpenChange={vi.fn()} />,
    );
    expect(screen.getByText("Review the change")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    expect(screen.getByText("Updating activity…")).toBeInTheDocument();

    const refetch = vi.fn();
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({
        isError: true,
        error: new Error("Selected computer is offline"),
        refetch,
      }),
    );
    view.rerender(<AssistantActivityPanel open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Review the change")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Previously loaded activity",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Selected computer is offline",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("reports initial loading and errors without showing an empty successful result", () => {
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({ data: undefined, isPending: true, isFetching: true }),
    );
    const view = renderWithProviders(
      <AssistantActivityPanel open onOpenChange={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading activity");
    expect(
      screen.queryByText("No assistant activity yet"),
    ).not.toBeInTheDocument();
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({
        data: undefined,
        isError: true,
        error: new Error("Not authorized"),
      }),
    );
    view.rerender(<AssistantActivityPanel open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load assistant activity",
    );
    expect(
      screen.queryByText("No assistant activity yet"),
    ).not.toBeInTheDocument();
  });

  it("opens an existing project conversation and never opens a source without a thread", () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <AssistantActivityPanel open onOpenChange={onOpenChange} />,
    );
    const projectRow = screen.getByText("Await review").closest("li")!;
    fireEvent.click(
      within(projectRow).getByRole("button", { name: "Open source" }),
    );
    expect(navigate).toHaveBeenCalledWith("/workspace/realtime/thread-1", {
      state: { openProjectWorkbench: true },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const unavailable = within(
      screen.getByText("Research finished").closest("li")!,
    ).getByRole("button", { name: "Open source" });
    expect(unavailable).toBeDisabled();
    expect(
      screen.getByText("No source conversation is linked to this activity."),
    ).toBeInTheDocument();
    fireEvent.click(unavailable);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard filters and escape dismissal", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <AssistantActivityPanel open onOpenChange={onOpenChange} />,
    );
    screen.getByRole("tab", { name: /All/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Working/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText("Await review")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("delegates close focus restoration to the supplied callback", async () => {
    const onCloseAutoFocus = vi.fn((event: Event) => event.preventDefault());
    const view = renderWithProviders(
      <AssistantActivityPanel
        open
        onOpenChange={vi.fn()}
        onCloseAutoFocus={onCloseAutoFocus}
      />,
    );
    view.rerender(
      <AssistantActivityPanel
        open={false}
        onOpenChange={vi.fn()}
        onCloseAutoFocus={onCloseAutoFocus}
      />,
    );
    await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledTimes(1));
    expect(onCloseAutoFocus.mock.calls[0]![0].defaultPrevented).toBe(true);
  });

  it("shows the recent-record limit and uses browser date formatting", () => {
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({
        data: { ...result().data, has_more: true },
      }),
    );
    renderWithProviders(<AssistantActivityPanel open onOpenChange={vi.fn()} />);
    expect(
      screen.getByText(/Showing the latest 3 activities/),
    ).toBeInTheDocument();
    const time = screen
      .getByText("Review the change")
      .closest("li")!
      .querySelector("time");
    expect(time).toHaveAttribute("dateTime", items[0]!.updated_at);
    expect(time).toHaveTextContent(
      new Date(items[0]!.updated_at).toLocaleString(),
    );
  });

  it("explains ended executions without marking their project tasks delivered and keeps unknown reasons", () => {
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({
        data: {
          ...result().data,
          summary: { working: 1, attention: 3, completed: 0 },
          items: [
            item({
              source: "project_task",
              project_id: "project-1",
              title: "Unfinished project task",
              status: "running",
              reason: "execution_completed",
            }),
            item({ id: "paused", state: "attention", reason: "run:paused" }),
            item({
              id: "future",
              state: "attention",
              reason: "run:future_state",
            }),
            item({
              id: "custom",
              state: "attention",
              reason: "Check the customer's revised requirements.",
            }),
          ],
        },
      }),
    );
    for (const locale of ["en-US", "zh-CN"] as const) {
      const zh = locale === "zh-CN";
      const view = renderWithProviders(
        <AssistantActivityPanel open onOpenChange={vi.fn()} />,
        { locale },
      );
      const project = screen
        .getByText("Unfinished project task")
        .closest("li")!;
      expect(project).toHaveTextContent(
        zh
          ? "本次执行已结束，项目任务尚未完成。"
          : "This execution has ended; the project task is not yet complete.",
      );
      expect(
        within(project).getByText(zh ? "执行中" : "Running"),
      ).toHaveAttribute("title", "running");
      expect(
        screen.getByText(zh ? "关联运行已暂停" : "Linked run: Paused"),
      ).toBeInTheDocument();
      expect(screen.getByText("run:future_state")).toBeInTheDocument();
      expect(
        screen.getByText("Check the customer's revised requirements."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/delivered|已交付/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: zh ? /已完成/ : /Completed/ }),
      ).toHaveTextContent("0");
      view.unmount();
    }
  });

  it("renders an empty result in Chinese and disables queries when closed", () => {
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({
        data: {
          ...result().data,
          items: [],
          summary: { working: 0, attention: 0, completed: 0 },
        },
      }),
    );
    const view = renderWithProviders(
      <AssistantActivityPanel open onOpenChange={vi.fn()} />,
      { locale: "zh-CN" },
    );
    expect(
      screen.getByRole("dialog", { name: "助手活动" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("暂无助手活动");
    view.rerender(
      <AssistantActivityPanel open={false} onOpenChange={vi.fn()} />,
    );
    expect(useAssistantActivity).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("searches titles, projects, rooms, actual persona names and statuses together with the selected filter", async () => {
    const user = userEvent.setup();
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({
        data: {
          ...result().data,
          items: [item({ agent_ids: ["coder"] }), ...items.slice(1)],
        },
      }),
    );
    renderWithProviders(<AssistantActivityPanel open onOpenChange={vi.fn()} />);
    const search = screen.getByRole("textbox", { name: "Search activity" });
    fireEvent.change(search, { target: { value: "review change" } });
    expect(screen.getByText("Review the change")).toBeInTheDocument();
    expect(screen.queryByText("Await review")).not.toBeInTheDocument();
    for (const term of ["Echo", "waiting_approval", "Waiting for approval"]) {
      fireEvent.change(search, { target: { value: term } });
      expect(screen.getByText("Await review")).toBeInTheDocument();
      expect(screen.queryByText("Review the change")).not.toBeInTheDocument();
    }
    fireEvent.change(search, { target: { value: "design room" } });
    expect(screen.getByText("Research finished")).toBeInTheDocument();
    for (const term of ["Kane", "coder"]) {
      fireEvent.change(search, { target: { value: term } });
      expect(screen.getByText("Review the change")).toBeInTheDocument();
      expect(screen.getByText("Agents: Kane")).toHaveAttribute(
        "title",
        "coder",
      );
    }
    fireEvent.change(search, { target: { value: "Echo" } });
    await user.click(screen.getByRole("tab", { name: /Working/ }));
    expect(
      screen.getByText("No matching activity. Try another search or filter."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Needs attention/ }),
    ).toHaveTextContent("1");
    expect(
      screen.getByText(/Filter counts cover the latest 3 records/),
    ).toHaveTextContent("0 matches");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getByText("Review the change")).toBeInTheDocument();
    expect(screen.queryByText("Await review")).not.toBeInTheDocument();
  });

  it("localizes common statuses and reuses real persona labels while preserving unknown values", () => {
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({
        data: {
          ...result().data,
          items: [
            item({
              status: "waiting_approval",
              agent_ids: ["general", "coder", "custom-role"],
            }),
            item({
              id: "unknown",
              status: "future_state",
              title: "Unknown state",
            }),
          ],
        },
      }),
    );
    renderWithProviders(
      <AssistantActivityPanel open onOpenChange={vi.fn()} />,
      { locale: "zh-CN" },
    );
    expect(screen.getByText("等待确认")).toHaveAttribute(
      "title",
      "waiting_approval",
    );
    expect(screen.getByText("角色: Eve, Kane, custom-role")).toHaveAttribute(
      "title",
      "general, coder, custom-role",
    );
    expect(screen.getByText("future_state")).toHaveAttribute(
      "title",
      "future_state",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "搜索活动" }), {
      target: { value: "等待确认 Kane" },
    });
    expect(screen.getByText("Review the change")).toBeInTheDocument();
    expect(screen.queryByText("Unknown state")).not.toBeInTheDocument();
  });

  it("uses the friendly error message and retains the actual last-successful data time", () => {
    const error = new Error("HTTP 503");
    vi.mocked(assistantActivityErrorMessage).mockReturnValue(
      "所选服务暂不可用，请稍后重试。",
    );
    vi.mocked(useAssistantActivity).mockReturnValue(
      result({ isError: true, error }),
    );
    renderWithProviders(
      <AssistantActivityPanel open onOpenChange={vi.fn()} />,
      { locale: "zh-CN" },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "所选服务暂不可用，请稍后重试。",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("HTTP 503");
    expect(assistantActivityErrorMessage).toHaveBeenCalledWith(error, true);
    expect(screen.getByText(/上次成功读取/)).toHaveTextContent(
      new Date(result().dataUpdatedAt).toLocaleString(),
    );
    expect(
      screen.getByText(/上次成功读取/).querySelector("time"),
    ).toHaveAttribute("dateTime", "2026-10-05T09:40:00.000Z");
    expect(screen.getByText("Review the change")).toBeInTheDocument();
  });
});
