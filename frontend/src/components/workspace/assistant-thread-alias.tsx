import { useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";

import { BrandLoadingPanel } from "@/components/brand/brand-progress";
import { getAPIClient } from "@/core/api";
import { markThreadBorn, markThreadUnborn } from "@/core/api/unborn-threads";
import { eventBus } from "@/core/events";
import { useI18n } from "@/core/i18n/hooks";
import {
  ASSISTANT_ALIAS_ID,
  isAssistantThreadId,
  personalAssistantThreadId,
} from "@/core/threads/assistant-thread";
import { useAuth } from "@/providers/AuthProvider";

/**
 * Resolves ``/workspace/realtime/echo-assistant`` to this account's own
 * assistant conversation (see ``core/threads/assistant-thread``). Every other
 * thread route renders unchanged.
 *
 * The assistant conversation only exists on the server after its first
 * message. Until then it is marked not-yet-created, so the page's reads are
 * answered locally instead of a dozen 404s; the first run clears the mark.
 */
export function AssistantThreadAlias({ children }: { children: ReactNode }) {
  const { threadId } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const { authStatus, user } = useAuth();
  const actorId = (user?.actor_id || user?.user_id || "").trim();
  const isAlias = threadId === ASSISTANT_ALIAS_ID;
  // Sign-in off means one person: the alias is their conversation.
  const perAccount = isAlias && authStatus?.enabled === true && !!actorId;
  const legacy = useQuery({
    queryKey: ["assistant-thread", "legacy-readable", actorId],
    enabled: perAccount,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        // Missing, or another account's: use this account's own thread.
        return (await getAPIClient().threads.exists(ASSISTANT_ALIAS_ID)).exists;
      } catch {
        // Offline or 5xx: keep the original behaviour.
        return true;
      }
    },
  });
  // The conversation this route will show, once no redirect is pending.
  const ownId =
    threadId && isAssistantThreadId(threadId) && !perAccount ? threadId : null;
  const own = useQuery({
    queryKey: ["assistant-thread", "exists", ownId],
    enabled: ownId !== null,
    // Probe on every visit: another device may have started it meanwhile.
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const id = ownId;
      if (!id) return true;
      markThreadBorn(id);
      try {
        // Asked without a 404: before the first message, "not yet" is the
        // expected answer, not an error for the console.
        if ((await getAPIClient().threads.exists(id)).exists) return true;
      } catch {
        return true;
      }
      markThreadUnborn(id);
      return false;
    },
  });
  useEffect(() => {
    if (!ownId) return;
    return eventBus.on("thread:run-status", (payload) => {
      if (payload.threadId === ownId && payload.state === "running") {
        markThreadBorn(ownId);
      }
    });
  }, [ownId]);

  if (ownId !== null) {
    if (own.isPending) {
      return (
        <BrandLoadingPanel label={t.common.loading} className="min-h-40" />
      );
    }
    return <>{children}</>;
  }
  if (!perAccount) return <>{children}</>;
  if (legacy.isPending) {
    return <BrandLoadingPanel label={t.common.loading} className="min-h-40" />;
  }
  if (legacy.data) return <>{children}</>;
  return (
    <Navigate
      replace
      to={`/workspace/realtime/${personalAssistantThreadId(actorId)}${location.search}`}
      state={location.state}
    />
  );
}
