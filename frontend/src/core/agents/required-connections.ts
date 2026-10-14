import { apiGet, isApiErrorStatus } from "@/core/api/request";
import type { CapabilityInfo } from "./agent-world-api";

export type RequiredConnectionState =
  | "missing"
  | "install"
  | "permissions"
  | "disabled"
  | "connect"
  | "configured"
  | "unknown";
export interface RequiredConnection {
  id: string;
  name: string;
  state: RequiredConnectionState;
}

/** Only inspect the exact declared dependency; never select a fuzzy match. */
export async function inspectRequiredConnection(
  id: string,
  signal?: AbortSignal,
): Promise<RequiredConnection> {
  const result: RequiredConnection = { id, name: id, state: "unknown" };
  try {
    let capability: CapabilityInfo;
    try {
      capability = (await apiGet("/api/capabilities/{cid}", {
        path: { cid: id },
        signal,
      })) as CapabilityInfo;
    } catch (error) {
      if (isApiErrorStatus(error, 404)) return { ...result, state: "missing" };
      // Other HTTP failures fall through to the outer "unknown" result.
      throw error;
    }
    if (capability.id !== id || capability.source !== "connector")
      return result;
    result.name = capability.name_zh || capability.name || id;
    if (!capability.installed) return { ...result, state: "install" };
    if (
      capability.permission_review_required ||
      capability.permission_active === false
    )
      return { ...result, state: "permissions" };
    if (!capability.enabled) return { ...result, state: "disabled" };
    if (capability.auth_mode === "none")
      return { ...result, state: "configured" };
    const auth = (await apiGet("/api/capabilities/{cid}/status", {
      path: { cid: id },
      signal,
    })) as { connected?: boolean };
    return {
      ...result,
      state:
        auth.connected === true
          ? "configured"
          : auth.connected === false
            ? "connect"
            : "unknown",
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return result;
  }
}

/** Bound catalog/status requests even when a package declares many connections. */
export async function inspectRequiredConnections(
  ids: readonly string[],
  signal?: AbortSignal,
) {
  const results: RequiredConnection[] = [];
  for (let offset = 0; offset < ids.length; offset += 4) {
    signal?.throwIfAborted();
    results.push(
      ...(await Promise.all(
        ids
          .slice(offset, offset + 4)
          .map((id) => inspectRequiredConnection(id, signal)),
      )),
    );
  }
  return results;
}
