import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

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
  const response = await fetch(`${getBackendBaseURL()}/api/execution${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Execution request failed",
    );
  return data as T;
}
export async function downloadNodeArtifact(
  runId: string,
  index: number,
  name: string,
) {
  const response = await fetch(
    `${getBackendBaseURL()}/api/execution/tasks/${encodeURIComponent(runId)}/artifacts/${index}`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error("Artifact download failed");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.split(/[\\/]/).pop() || "artifact";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
