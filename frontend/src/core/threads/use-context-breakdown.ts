import { useEffect, useRef, useState } from "react";

import { untypedApi } from "@/core/api/request";
import { swallow } from "@/core/utils/log";
import {
  normalizeContextBreakdown,
  type ContextBreakdownSegment,
} from "@/core/threads/context-breakdown";

/**
 * The thread's real context composition, as measured by the server.
 *
 * ``source`` distinguishes the two answers the endpoint can give: ``request``
 * means the ReAct loop measured the payload it actually sent, ``estimate``
 * means the server could only split the stored messages (a thread this server
 * never ran, or one that has not sent a turn yet). The caller renders both,
 * but only the first is a reading rather than an approximation.
 */
export interface ContextBreakdown {
  segments: ContextBreakdownSegment[];
  totalTokens: number;
  source: "request" | "estimate";
}

export function useContextBreakdown(
  threadId: string | null | undefined,
  options: { refreshKey?: string | number | null } = {},
) {
  const { refreshKey } = options;
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const active =
    typeof threadId === "string" && threadId.length > 0 && threadId !== "new";

  useEffect(() => {
    // A brand-new thread has no id to ask about yet, and a stale answer from
    // the previous thread would be worse than no answer.
    if (!active || !threadId) {
      setBreakdown(null);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    void (async () => {
      try {
        const payload = await untypedApi.get<{
          segments?: unknown;
          total_tokens?: unknown;
          source?: unknown;
        }>(`/api/threads/${encodeURIComponent(threadId)}/context-breakdown`, {
          reason: "the context-breakdown route is not in the OpenAPI snapshot",
          signal: controller.signal,
          errorMessage: (failure) =>
            `context breakdown unavailable (${failure.status})`,
        });
        if (controller.signal.aborted) return;
        const segments = normalizeContextBreakdown(payload.segments);
        if (!segments) {
          setBreakdown(null);
          return;
        }
        setBreakdown({
          segments,
          totalTokens:
            typeof payload.total_tokens === "number" ? payload.total_tokens : 0,
          source: payload.source === "request" ? "request" : "estimate",
        });
      } catch (cause) {
        if (controller.signal.aborted) return;
        // The ring keeps its own estimate; a failed fetch is not an error the
        // reader needs to see.
        swallow(cause, "context-breakdown");
        setBreakdown(null);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [active, threadId, refreshKey]);

  return { breakdown, isLoading };
}
