/** Execution scope belongs to this renderer URL, never to a thread id. */
export const REMOTE_EXECUTION_PARAM = "echoRemote";

export function getRemoteExecutionId(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(
    REMOTE_EXECUTION_PARAM,
  );
  return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
}

export function executionProxyPath(id = getRemoteExecutionId()): string {
  return id ? `/api/remote-backends/${encodeURIComponent(id)}/http` : "";
}

/** Keep existing local keys; remote machines must not inherit local folders,
 * drafts or model overrides, even when their thread ids happen to match. */
export function executionStorageKey(key: string): string {
  const id = getRemoteExecutionId();
  return id ? `echo.remote.${id}:${key}` : key;
}

export function executionLocationURL(remoteId: string | null): string {
  const url = new URL(window.location.href);
  const gateway = url.searchParams.get("echoBackend");
  url.search = "";
  if (gateway) url.searchParams.set("echoBackend", gateway);
  if (remoteId) url.searchParams.set(REMOTE_EXECUTION_PARAM, remoteId);
  else url.searchParams.delete(REMOTE_EXECUTION_PARAM);
  // A full reload discards runtime-owned query caches and reconnects sockets.
  // Thread ids, projects, local paths and pending prompts never cross hosts.
  url.hash = "/workspace/realtime/new";
  return url.toString();
}
