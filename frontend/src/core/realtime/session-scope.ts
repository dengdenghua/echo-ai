import { getBackendBaseURL } from "@/core/config";
import { getRemoteExecutionId } from "@/core/execution-location";
import { useOptionalAuth } from "@/providers/AuthProvider";

/** A thread id is meaningful only inside its host and authenticated account. */
export function useThreadSessionScope(threadId: string): string {
  const auth = useOptionalAuth();
  const account = auth?.isLoading
    ? "auth-loading"
    : auth?.user?.actor_id ||
      auth?.user?.user_id ||
      (auth?.authStatus?.enabled ? "signed-out" : "local");
  return JSON.stringify([
    getBackendBaseURL(),
    getRemoteExecutionId() ?? "",
    auth?.user?.provider ?? "",
    account,
    threadId,
  ]);
}
