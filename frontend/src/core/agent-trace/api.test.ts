import { afterEach, describe, expect, test, vi } from "vitest";

import { E2E_SURPASS_TARGET_SCORE, queueAgentScorecardGaps } from "./api";
import { resumeTaskExecution } from "@/core/tasks/recovery-api";

describe("agent trace evolution API helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("queues scorecard gaps against the E2E surpass target by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        schema: "echo.agent_scorecard_gap_queue.v1",
        created: 0,
        updated: 0,
        total: 0,
        items: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueAgentScorecardGaps();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/evolution/agent-scorecard/gaps/queue",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          target_score: E2E_SURPASS_TARGET_SCORE,
          limit: 10,
          reason: "operator panel real score gap review",
          dimension_id: "",
        }),
      }),
    );
  });

  test("uses the background execution recovery API with a stable request id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        schema: "echo.task_run_resume_execution.v1",
        accepted: true,
        state: "queued",
        task_id: "native/task",
        thread_id: "thread-1",
        turn_id: null,
        request_id: "recovery-request-1",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await resumeTaskExecution(
      "native/task",
      "recovery-request-1",
    );
    expect(result.accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/task-runs/native%2Ftask/resume-execution",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          requestId: "recovery-request-1",
          reason: "operator requested checkpoint recovery",
        }),
      }),
    );
  });
});
