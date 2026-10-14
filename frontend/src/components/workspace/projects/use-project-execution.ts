import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  apiGet,
  apiPost,
  untypedApi,
  EchoAPIError,
  type ApiFailure,
} from "@/core/api/request";
import type { components } from "@/core/api/openapi-types";
import { subscribeProjectUpdates } from "./project-updates-api";

export interface ExecutionAction {
  action: string;
  label: string;
  api?: { method: string; path: string; body?: Record<string, unknown> };
}

export type ProjectExecution = components["schemas"]["ProjectExecutionState"];

const active = (job?: ProjectExecution | null) =>
  !!job && ["queued", "pending", "running"].includes(job.status);
const failure = "操作失败，请稍后重试。";

// The server names project actions in English; the projects workbench is
// Chinese, so known actions get their own label and unknown ones keep the
// server's.
const ACTION_LABELS: Record<string, string> = {
  run: "运行",
  tick: "推进一步",
  recover: "恢复",
  recover_and_run: "恢复并运行",
  inspect: "查看",
  report: "报告",
};

export function projectActionLabel(
  spec: Pick<ExecutionAction, "action" | "label">,
) {
  return ACTION_LABELS[spec.action] ?? spec.label;
}

export function projectExecutionBody(
  spec: ExecutionAction,
  overrides?: Record<string, unknown>,
) {
  const body = { ...(spec.api?.body ?? {}), ...(overrides ?? {}) };
  if (spec.action === "run" || body.run === true) body.background = true;
  return body;
}

export function useProjectExecution({
  projectId,
  refresh,
  errorMessage,
}: {
  projectId: string | null;
  refresh: () => void;
  errorMessage: (failure: ApiFailure) => string;
}) {
  const queryClient = useQueryClient();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastReceipt = useRef("");
  const execution = useQuery<ProjectExecution | null>({
    queryKey: ["project-execution", projectId],
    enabled: !!projectId,
    retry: false,
    queryFn: async () => {
      const payload = await apiGet("/api/projects/{project_id}/execution", {
        path: { project_id: projectId ?? "" },
      });
      return payload.execution ?? null;
    },
    refetchInterval: (query) =>
      active(query.state.data) ||
      (query.state.data?.status === "interrupted" &&
        query.state.data.can_takeover === false)
        ? 2000
        : false,
  });
  const job = execution.data;
  useEffect(() => {
    if (!projectId) return;
    return subscribeProjectUpdates(projectId, () => {
      void queryClient.invalidateQueries({
        queryKey: ["project-execution", projectId],
      });
      refreshRef.current();
    });
  }, [projectId, queryClient]);
  useEffect(() => {
    if (!job) return;
    const receipt = `${job.task_id}:${job.updated_at}:${job.status}:${job.can_takeover}`;
    if (receipt !== lastReceipt.current) {
      lastReceipt.current = receipt;
      refreshRef.current();
    }
  }, [job]);

  const executeAction = async (
    spec: ExecutionAction,
    overrides?: Record<string, unknown>,
  ) => {
    if (!spec.api) return;
    try {
      const body = projectExecutionBody(spec, overrides);
      if (
        spec.api.method.toUpperCase() !== "POST" ||
        !spec.api.path.startsWith("/api/projects/")
      )
        throw new Error("Unsupported project action");
      const response = await untypedApi.fetch("post", spec.api.path, {
        reason:
          "Server action_specs select a project route and variable intervention body at runtime",
        body: Object.keys(body).length ? body : undefined,
        errorMessage,
      });
      toast.success(
        response.status === 202
          ? `${projectActionLabel(spec)} 已提交到后台`
          : `${projectActionLabel(spec)} 已执行`,
      );
      await execution.refetch();
      refreshRef.current();
    } catch (error) {
      toast.error(error instanceof EchoAPIError ? error.message : failure);
    }
  };

  const cancelExecution = async () => {
    if (!projectId) return;
    try {
      await apiPost("/api/projects/{project_id}/execution/cancel", {
        path: { project_id: projectId },
        errorMessage,
      });
      await execution.refetch();
      refreshRef.current();
    } catch (error) {
      toast.error(error instanceof EchoAPIError ? error.message : failure);
    }
  };

  return { job, isRunning: active(job), executeAction, cancelExecution };
}
