import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTraceRequestError } from "@/core/agent-trace/api";
import type * as AgentTraceAPI from "@/core/agent-trace/api";
import { useTaskRecoveryActions } from "./use-task-recovery-actions";

const api = vi.hoisted(() => ({ takeover: vi.fn(), resume: vi.fn() }));
vi.mock("@/core/agent-trace/api", async (importOriginal) => ({
  ...(await importOriginal<typeof AgentTraceAPI>()),
  takeoverTaskRun: api.takeover,
}));
vi.mock("@/core/tasks/recovery-api", () => ({
  resumeTaskExecution: api.resume,
}));

function actions() {
  const callbacks = {
    setBusyId: vi.fn(),
    setError: vi.fn(),
    setLastApplyResult: vi.fn(),
    refreshTaskRuns: vi.fn().mockResolvedValue(undefined),
    refreshQueue: vi.fn().mockResolvedValue(undefined),
    to: (source: string) => source,
  };
  const hook = renderHook(() => useTaskRecoveryActions(callbacks));
  return { ...hook, callbacks };
}

describe("task recovery actions", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requests execution once and refreshes the authoritative state after acceptance", async () => {
    api.resume.mockResolvedValue({ accepted: true, state: "queued" });
    const { result, callbacks } = actions();
    await act(() => result.current.onResumeTaskRun("native-task"));
    expect(api.resume).toHaveBeenCalledExactlyOnceWith(
      "native-task",
      expect.any(String),
    );
    expect(callbacks.refreshTaskRuns).toHaveBeenCalledOnce();
    expect(callbacks.refreshQueue).toHaveBeenCalledOnce();
    expect(callbacks.setLastApplyResult).toHaveBeenCalledWith(
      "Recovery requested for task native-task.",
    );
    expect(callbacks.setBusyId.mock.calls).toEqual([
      ["resume-task:native-task"],
      [null],
    ]);
    expect(api.takeover).not.toHaveBeenCalled();
  });

  it("surfaces an approval conflict without clearing the queue or retrying the request", async () => {
    api.resume.mockRejectedValue(
      new AgentTraceRequestError(
        409,
        "task is waiting for its original approval decision",
      ),
    );
    const { result, callbacks } = actions();
    await act(() => result.current.onResumeTaskRun("native-task"));
    expect(callbacks.setError).toHaveBeenCalledWith(
      "task is waiting for its original approval decision",
    );
    expect(callbacks.setLastApplyResult).not.toHaveBeenCalled();
    expect(callbacks.refreshQueue).not.toHaveBeenCalled();
    expect(callbacks.setBusyId).toHaveBeenLastCalledWith(null);
    expect(api.resume).toHaveBeenCalledOnce();
    expect(api.takeover).not.toHaveBeenCalled();
  });

  it("keeps takeover separate from execution authorization", async () => {
    api.takeover.mockResolvedValue({ task_run: { status: "running" } });
    const { result, callbacks } = actions();
    await act(() => result.current.onTakeoverTaskRun("expired-task"));
    expect(api.takeover).toHaveBeenCalledExactlyOnceWith("expired-task");
    expect(api.resume).not.toHaveBeenCalled();
    expect(callbacks.setLastApplyResult).toHaveBeenCalledWith(
      "Took over task expired-task.",
    );
  });
});
