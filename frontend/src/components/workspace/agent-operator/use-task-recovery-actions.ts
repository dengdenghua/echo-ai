import { useCallback } from "react";

import { takeoverTaskRun } from "@/core/agent-trace/api";
import { resumeTaskExecution } from "@/core/tasks/recovery-api";
import { swallow } from "@/core/utils/log";
import { formatOperatorCopy, readRequestErrorMessage } from "./operator-utils";

export function useTaskRecoveryActions({
  setBusyId,
  setError,
  setLastApplyResult,
  refreshTaskRuns,
  refreshQueue,
  to,
}: {
  setBusyId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setLastApplyResult: (message: string) => void;
  refreshTaskRuns: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  to: (source: string) => string;
}) {
  const runAction = useCallback(
    async (taskId: string, action: "takeover" | "resume") => {
      setBusyId(`${action}-task:${taskId}`);
      try {
        if (action === "takeover") {
          await takeoverTaskRun(taskId);
        } else {
          const result = await resumeTaskExecution(taskId, crypto.randomUUID());
          if (!result.accepted)
            throw new Error(to("Task recovery was not accepted."));
        }
        setLastApplyResult(
          formatOperatorCopy(
            to,
            action === "takeover"
              ? "Took over task {task}."
              : "Recovery requested for task {task}.",
            { task: taskId },
          ),
        );
        await Promise.all([refreshTaskRuns(), refreshQueue()]);
        setError(null);
      } catch (error) {
        swallow(error);
        setError(readRequestErrorMessage(error));
      } finally {
        setBusyId(null);
      }
    },
    [
      setBusyId,
      setError,
      setLastApplyResult,
      refreshTaskRuns,
      refreshQueue,
      to,
    ],
  );
  return {
    onTakeoverTaskRun: (taskId: string) => runAction(taskId, "takeover"),
    onResumeTaskRun: (taskId: string) => runAction(taskId, "resume"),
  };
}
