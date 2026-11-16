import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { currentActorId } from "@/core/auth/api";
import { isAssistantThreadId } from "@/core/threads/assistant-thread";

export function isKnowledgeApplication(pathname: string): boolean {
  return ["/workspace/storage", "/workspace/knowledge"].some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

export function validConversationRoute(route: string | null): route is string {
  return (
    !!route &&
    route.length < 4096 &&
    /^\/workspace\/realtime\/[^/?#]+(?:[?#].*)?$/.test(route) &&
    !/[\x00-\x1f]/.test(route)
  );
}

export function isMainConversationRoute(route: string | null): route is string {
  if (!validConversationRoute(route)) return false;
  try {
    return !isAssistantThreadId(
      decodeURIComponent(
        route.split(/[?#]/)[0]!.slice("/workspace/realtime/".length),
      ),
    );
  } catch {
    return false;
  }
}

/** Home owns ordinary conversations; the dedicated assistant must not replace it. */
export function useConversationHomeRoute(): string {
  const { pathname, search } = useLocation();
  const current = `${pathname}${search}`;
  const key = `echo:last-conversation-route:${currentActorId()}`;
  useEffect(() => {
    if (!isMainConversationRoute(current)) return;
    try {
      sessionStorage.setItem(key, current);
    } catch {
      /* Restricted storage. */
    }
  }, [current, key]);
  if (isMainConversationRoute(current)) return current;
  try {
    const saved = sessionStorage.getItem(key);
    if (isMainConversationRoute(saved)) return saved;
  } catch {
    /* Restricted storage. */
  }
  return "/workspace/realtime/new";
}

/** An explicit citation may return to its source, without changing Home. */
export function useConversationReturnRoute(): string {
  const home = useConversationHomeRoute();
  const { search } = useLocation();
  const sourceThread = new URLSearchParams(search).get("sourceThread");
  const source = sourceThread
    ? `/workspace/realtime/${encodeURIComponent(sourceThread)}`
    : null;
  return validConversationRoute(source) ? source : home;
}
