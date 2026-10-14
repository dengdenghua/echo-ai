import { subscribeAuthenticatedUpdates } from "@/core/auth/updates";

export function subscribeWorkspaceFileUpdates(
  workspaceId: string,
  onUpdate: () => void,
): () => void {
  return subscribeAuthenticatedUpdates(
    {
      path: `/api/fs/workspaces/${encodeURIComponent(workspaceId)}/updates`,
      idField: "workspace_id",
      id: workspaceId,
      readyKind: "workspace:ready",
      updateKind: "workspace:update",
    },
    onUpdate,
  );
}
