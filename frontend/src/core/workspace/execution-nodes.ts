import {
  apiFetch,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

export interface ExecutionNode {
  node_id: string;
  label: string;
  workspace_ids: string[];
  roles: string[];
  online: boolean;
}
export interface NodeTask {
  run_id: string;
  status: string;
  attempt: number;
  lease_owner: string | null;
  error: string | null;
  input: {
    goal: string;
    workspace_id: string;
    node_ids: string[];
    input_snapshot?: {
      sha256: string;
      file_count: number;
      skipped_count: number;
    };
  };
  result: {
    output: string;
    artifacts: { path: string; sha256: string; size: number }[];
  } | null;
}
export interface EngineInvocation {
  run_id: string;
  parent_run_id: string;
  status: string;
  error: string | null;
  input: { task_id: string; engine: string; goal: string; device_id: string };
}
export async function executionRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const options = {
    reason: "callers pass a dynamic /api/execution sub-route",
    body,
    // Historically sent on every call, including bodiless GETs.
    headers: { "Content-Type": "application/json" },
    errorMessage: (failure: ApiFailure) => {
      const detail = failureDetail(failure);
      return typeof detail === "string" ? detail : "Execution request failed";
    },
  };
  return body === undefined
    ? untypedApi.get<T>(`/api/execution${path}`, options)
    : untypedApi.post<T>(`/api/execution${path}`, options);
}
export async function downloadNodeArtifact(
  runId: string,
  index: number,
  name: string,
) {
  // Binary body: take the raw Response and read it as a Blob.
  const response = await apiFetch(
    "get",
    "/api/execution/tasks/{run_id}/artifacts/{index}",
    {
      path: { run_id: runId, index },
      errorMessage: () => "Artifact download failed",
    },
  );
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.split(/[\\/]/).pop() || "artifact";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
