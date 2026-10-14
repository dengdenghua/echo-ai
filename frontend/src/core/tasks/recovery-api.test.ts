import { beforeEach, describe, expect, it, vi } from "vitest";
import { resumeTaskExecution } from "./recovery-api";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/core/api/request", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiPost: post,
}));

const receipt = {
  schema: "echo.task_run_resume_execution.v1",
  accepted: true,
  state: "queued",
  task_id: "T",
  thread_id: "thread",
  turn_id: null,
  request_id: "request",
};

describe("checkpoint recovery receipts", () => {
  beforeEach(() => post.mockReset());
  it("validates and returns a queued receipt through the shared typed request layer", async () => {
    post.mockResolvedValue(receipt);
    expect(await resumeTaskExecution("T", "request")).toEqual(receipt);
    expect(post).toHaveBeenCalledWith(
      "/api/task-runs/{task_id}/resume-execution",
      {
        path: { task_id: "T" },
        body: {
          requestId: "request",
          reason: "operator requested checkpoint recovery",
        },
      },
    );
  });
  it.each([
    null,
    [],
    { ...receipt, state: { toString: () => "queued" } },
    { ...receipt, task_id: "another-owner-task" },
    { ...receipt, turn_id: 123 },
    { ...receipt, turn_id: undefined },
  ])("rejects malformed or mismatched response %j", async (body) => {
    post.mockResolvedValue(body);
    await expect(resumeTaskExecution("T", "request")).rejects.toThrow(
      "Invalid task recovery response",
    );
  });
});
