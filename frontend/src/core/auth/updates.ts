import { authHeaders, currentActorId } from "@/core/auth/api";
import { openAuthenticatedWebSocket } from "@/core/auth/websocket";
import { getBackendWebSocketBaseURL } from "@/core/config";

export interface UpdateSubscription {
  path: string;
  idField: string;
  id: string;
  readyKind: string;
  updateKind: string;
}

function isUpdateFrame(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Hints invalidate authorized HTTP reads; frames never contain source data. */
export function subscribeAuthenticatedUpdates(
  subscription: UpdateSubscription,
  onUpdate: () => void,
): () => void {
  let disposed = false;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = 500;

  const connect = () => {
    if (disposed || typeof WebSocket === "undefined") return;
    const authorization = authHeaders().Authorization ?? "";
    const actor = currentActorId();
    const token = authorization.replace(/^Bearer\s+/i, "");
    const base = getBackendWebSocketBaseURL().replace(/\/+$/, "");
    let current: WebSocket;
    try {
      current = openAuthenticatedWebSocket(
        `${base}${subscription.path}`,
        token,
      );
    } catch {
      timer = setTimeout(connect, delay);
      delay = Math.min(10_000, delay * 2);
      return;
    }
    socket = current;
    current.onmessage = (event) => {
      if (disposed || socket !== current) return;
      if (
        (authHeaders().Authorization ?? "") !== authorization ||
        currentActorId() !== actor
      ) {
        current.close();
        return;
      }
      try {
        const frame: unknown = JSON.parse(String(event.data));
        if (
          isUpdateFrame(frame) &&
          subscription.idField in frame &&
          frame[subscription.idField] === subscription.id &&
          "type" in frame &&
          (frame.type === subscription.readyKind ||
            frame.type === subscription.updateKind)
        ) {
          delay = 500;
          onUpdate();
        }
      } catch {
        // HTTP catch-up remains available when a frame is malformed or missed.
      }
    };
    current.onclose = () => {
      if (disposed || socket !== current) return;
      socket = null;
      timer = setTimeout(connect, delay);
      delay = Math.min(10_000, delay * 2);
    };
    current.onerror = () => current.close();
  };

  connect();
  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    socket?.close();
    socket = null;
  };
}
