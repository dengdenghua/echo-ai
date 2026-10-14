import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";

import { BrandLoadingPanel } from "@/components/brand/brand-progress";
import { getAPIClient } from "@/core/api";
import { isApiErrorStatus } from "@/core/api/request";
import { useI18n } from "@/core/i18n/hooks";
import {
  ASSISTANT_ALIAS_ID,
  personalAssistantThreadId,
} from "@/core/threads/assistant-thread";
import { useAuth } from "@/providers/AuthProvider";

/**
 * Resolves ``/workspace/realtime/echo-assistant`` to this account's own
 * assistant conversation (see ``core/threads/assistant-thread``). Every other
 * thread route renders unchanged.
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
        await getAPIClient().threads.get(ASSISTANT_ALIAS_ID);
        return true;
      } catch (error) {
        // Missing, or another account's: use this account's own thread.
        // Anything else (offline, 5xx) keeps the original behaviour.
        return !isApiErrorStatus(error, 403, 404);
      }
    },
  });
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
