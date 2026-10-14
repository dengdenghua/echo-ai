import { useEffect, useRef } from "react";
import { getAPIClient } from "@/core/api";
import { authHeaders, currentActorId } from "@/core/auth/api";
import { subscribeWorkspaceFileUpdates } from "./workspace-file-updates-api";

/** Read the authorized thread binding; a caller-supplied thread never selects a broadcast target. */
export function useWorkspaceFileUpdates(
  threadId: string | null | undefined,
  workDir: string,
  refresh: () => void,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let unsubscribe: (() => void) | undefined;
    const bind = async () => {
      const current = ++generation;
      unsubscribe?.();
      unsubscribe = undefined;
      const actor = currentActorId();
      const authorization = authHeaders().Authorization ?? "";
      try {
        const prefix = workDir.match(/^([^:/\\]{2,}):[\\/]/)?.[1];
        const thread =
          !prefix && threadId && threadId !== "new"
            ? await getAPIClient().threads.get(threadId)
            : null;
        const workspaceId = prefix ?? thread?.metadata?.workspace_id;
        if (
          disposed ||
          current !== generation ||
          actor !== currentActorId() ||
          authorization !== (authHeaders().Authorization ?? "")
        )
          return;
        if (typeof workspaceId !== "string" || !workspaceId) return;
        unsubscribe = subscribeWorkspaceFileUpdates(workspaceId, () => {
          if (!disposed && current === generation) refreshRef.current();
        });
      } catch {
        // Membership failures or unavailable live delivery retain manual HTTP refresh.
      }
    };
    const changed = () => void bind();
    changed();
    window.addEventListener("echo:workspace-changed", changed);
    return () => {
      disposed = true;
      generation += 1;
      unsubscribe?.();
      window.removeEventListener("echo:workspace-changed", changed);
    };
  }, [threadId, workDir]);
}
