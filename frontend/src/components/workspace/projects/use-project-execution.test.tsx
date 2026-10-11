import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { ProjectExecutionStatus } from "./project-execution-status";
import {
  projectExecutionBody,
  useProjectExecution,
} from "./use-project-execution";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  refresh: vi.fn(),
  updates: vi.fn<(projectId: string, onUpdate: () => void) => () => void>(
    () => () => {},
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));
vi.mock("./project-updates-api", () => ({
  subscribeProjectUpdates: mocks.updates,
}));

function Harness() {
  const execution = useProjectExecution({
    projectId: "P-1",
    refresh: mocks.refresh,
    errorMessage: () => "safe failure",
  });
  return (
    <>
      <button
        onClick={() =>
          void execution.executeAction({
            action: "run",
            label: "Run project",
            api: { method: "POST", path: "/api/projects/P-1/run" },
          })
        }
      >
        Run
      </button>
      <ProjectExecutionStatus
        job={execution.job}
        isRunning={execution.isRunning}
        cancel={() => void execution.cancelExecution()}
      />
    </>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
});

it("refetches an idle execution from a push hint without waiting for polling", async () => {
  mocks.fetch
    .mockResolvedValueOnce(Response.json({ execution: null }))
    .mockResolvedValue(
      Response.json({
        execution: {
          task_id: "push-task",
          project_id: "P-1",
          status: "completed",
          updated_at: "pushed",
          cancel_requested: false,
          can_takeover: true,
        },
      }),
    );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = renderWithProviders(<Harness />, { queryClient: client });
  try {
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const notify = mocks.updates.mock.calls[0][1];
    await act(async () => notify());
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("本轮执行已结束"),
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(["project-execution", "P-1"])).toMatchObject({
      task_id: "push-task",
      status: "completed",
    });
  } finally {
    view.unmount();
    client.clear();
  }
});

it("uses background execution for run and recover-and-run while preserving controls", () => {
  const api = { method: "POST", path: "/run", body: { max_ticks: 2 } };
  expect(projectExecutionBody({ action: "run", label: "Run", api })).toEqual({
    max_ticks: 2,
    background: true,
  });
  expect(
    projectExecutionBody(
      { action: "recover", label: "Recover", api },
      { run: true, reset_attempts: false },
    ),
  ).toEqual({
    max_ticks: 2,
    run: true,
    reset_attempts: false,
    background: true,
  });
  expect(projectExecutionBody({ action: "tick", label: "Tick", api })).toEqual({
    max_ticks: 2,
  });
});

it("restores durable state after remount and reports accepted requests as queued", async () => {
  let job = {
    task_id: "task",
    request_id: "request",
    status: "running",
    updated_at: "one",
    cancel_requested: false,
  };
  mocks.fetch.mockImplementation((input: string) =>
    Promise.resolve(
      Response.json(
        input.endsWith("/run")
          ? { ok: true, execution: { accepted: true, status: "queued" } }
          : { execution: job },
        { status: input.endsWith("/run") ? 202 : 200 },
      ),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const first = renderWithProviders(<Harness />, { queryClient: client });
  expect(await screen.findByText("后台执行中")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Run"));
  await waitFor(() =>
    expect(mocks.success).toHaveBeenCalledWith("Run project 已提交到后台"),
  );
  expect(mocks.success).not.toHaveBeenCalledWith("Run project 已执行");
  expect(mocks.fetch).toHaveBeenCalledWith(
    "/api/projects/P-1/run",
    expect.objectContaining({ body: JSON.stringify({ background: true }) }),
  );
  first.unmount();
  const restoredClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  renderWithProviders(<Harness />, { queryClient: restoredClient });
  expect(await screen.findByText("后台执行中")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "停止执行" }));
  await waitFor(() =>
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/projects/P-1/execution/cancel",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  job = { ...job, status: "completed", updated_at: "two" };
  await restoredClient.invalidateQueries({
    queryKey: ["project-execution", "P-1"],
  });
  expect(await screen.findByText("本轮执行已结束")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "停止执行" }),
  ).not.toBeInTheDocument();
  expect(mocks.refresh).toHaveBeenCalled();
});

it("keeps a conflict generic and never turns a rejected request into completion", async () => {
  mocks.fetch.mockImplementation((input: string) =>
    Promise.resolve(
      input.endsWith("/run")
        ? new Response("private runtime detail", { status: 409 })
        : Response.json({ execution: null }),
    ),
  );
  renderWithProviders(<Harness />);
  fireEvent.click(screen.getByText("Run"));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("safe failure"));
  expect(mocks.success).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("refreshes an interrupted job until its lease permits takeover, then stops polling", async () => {
  vi.useFakeTimers();
  let canTakeover = false;
  mocks.fetch.mockImplementation(() =>
    Promise.resolve(
      Response.json({
        execution: {
          task_id: "interrupted-task",
          status: "interrupted",
          updated_at: "unchanged-durable-timestamp",
          can_takeover: canTakeover,
          cancel_requested: false,
        },
      }),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = renderWithProviders(<Harness />, { queryClient: client });
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    mocks.refresh.mockClear();
    canTakeover = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["project-execution", "P-1"])).toMatchObject({
      can_takeover: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    client.clear();
    vi.useRealTimers();
  }
});
