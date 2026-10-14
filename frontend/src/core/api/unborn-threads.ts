import type { ApiFailure } from "./client";

/**
 * Threads known not to exist on the server yet, such as an account's 「助手」
 * conversation before its first message. Reads for them get the 404 the
 * server would give, without a request: opening that page used to put a
 * dozen failed requests in the console and kept polling for more.
 */
const unborn = new Set<string>();
// EchoClient paths leave out the ``/api`` prefix its base URL adds.
const THREAD_READ = /^(?:\/api)?\/(?:threads|cowork|collab)\/([^/?#]+)/;

export function markThreadUnborn(threadId: string) {
  unborn.add(threadId);
}

export function markThreadBorn(threadId: string) {
  unborn.delete(threadId);
}

/** The 404 a read of a not-yet-created thread gets, or null to send it. */
export function unbornThreadFailure(
  method: string,
  path: string,
): ApiFailure | null {
  if (unborn.size === 0 || method.toUpperCase() !== "GET") return null;
  const match = THREAD_READ.exec(path);
  if (!match?.[1]) return null;
  let threadId: string;
  try {
    threadId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!unborn.has(threadId)) return null;
  return {
    method: method.toUpperCase(),
    path,
    status: 404,
    statusText: "Not Found",
    text: "",
    payload: undefined,
    detail: "thread not created yet",
  };
}
