import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));

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
