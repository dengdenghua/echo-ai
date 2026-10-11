import { subscribeAuthenticatedUpdates } from "@/core/auth/updates";

export function subscribeProjectUpdates(
  projectId: string,
  onUpdate: () => void,
): () => void {
  return subscribeAuthenticatedUpdates(
    {
      path: `/api/projects/${encodeURIComponent(projectId)}/updates`,
      idField: "project_id",
      id: projectId,
      readyKind: "project:ready",
      updateKind: "project:update",
    },
    onUpdate,
  );
}
