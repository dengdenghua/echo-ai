import { useEffect, useState, type RefObject } from "react";
import { toast } from "sonner";

import {
  normalizeTeamResponseMode,
  type TeamMode,
} from "@/components/workspace/team-mode-picker";
import type { Agent } from "@/core/agents";
import { buildCoworkSelectionSyncPlan, type useReplaceCoworkRoster } from "@/core/cowork";

import type {
  BoundProjectQuery,
  CollabSessionQuery,
  CoworkGroupQuery,
  StateSetter,
} from "./realtime-page-types";

interface CoworkRosterSyncInput {
  threadId: string;
  isNewThread: boolean;
  boundProjectQuery: BoundProjectQuery;
  collabSessionQuery: CollabSessionQuery;
  coworkGroupQuery: CoworkGroupQuery;
  currentTaskAgentName: string;
  selectedCollaboratorIds: string[];
  teamModeIntent: TeamMode;
  persistedCollaboratorKey: string;
  persistedCollaboratorIds: string[];
  savedCollaborationMode: TeamMode | undefined;
  allTaskCollaboratorAgents: Agent[];
  replaceCoworkRosterMutation: ReturnType<typeof useReplaceCoworkRoster>;
  collaboratorSelectionTouchedRef: RefObject<boolean>;
  responseModeIntentTouchedRef: RefObject<boolean>;
  pendingRosterModeRef: RefObject<TeamMode | null>;
  lastCoworkSyncSignatureRef: RefObject<string | null>;
  setSelectedCollaboratorIds: StateSetter<string[]>;
  setTeamModeIntent: StateSetter<TeamMode>;
}

/**
 * Persists this tab's explicit roster / response-mode edits as one atomic
 * cowork write and announces newly joined members.
 */
export function useCoworkRosterSync({
  threadId,
  isNewThread,
  boundProjectQuery,
  collabSessionQuery,
  coworkGroupQuery,
  currentTaskAgentName,
  selectedCollaboratorIds,
  teamModeIntent,
  persistedCollaboratorKey,
  persistedCollaboratorIds,
  savedCollaborationMode,
  allTaskCollaboratorAgents,
  replaceCoworkRosterMutation,
  collaboratorSelectionTouchedRef,
  responseModeIntentTouchedRef,
  pendingRosterModeRef,
  lastCoworkSyncSignatureRef,
  setSelectedCollaboratorIds,
  setTeamModeIntent,
}: CoworkRosterSyncInput) {
  const [membershipNotice, setMembershipNotice] = useState("");
  useEffect(() => {
    if (isNewThread || !threadId || threadId === "new") return;
    // Project membership decides whether the lead agent must remain in the
    // durable roster. Never reconcile against the query's transient empty
    // state during a hard refresh.
    if (boundProjectQuery.isPending) return;

    // This effect is a writer, not another hydration source. A passive tab can
    // have an old local mode while its roster still matches the server; using
    // that match as write authority makes two open tabs continuously overwrite
    // each other (chat -> cluster -> swarm -> ...). Only an explicit roster or
    // response-mode action in this mounted page is allowed to persist state.
    const hasLocalWriteIntent =
      collaboratorSelectionTouchedRef.current ||
      responseModeIntentTouchedRef.current ||
      pendingRosterModeRef.current !== null;
    if (!hasLocalWriteIntent) return;
    const sessionState = collabSessionQuery.data
      ? {
          roster: collabSessionQuery.data.roster,
          mode: collabSessionQuery.data.mode,
          event_count: coworkGroupQuery.data?.state.event_count ?? 0,
          is_one_to_one:
            collabSessionQuery.data.roster.filter(
              (member) => member.kind !== "human",
            ).length <= 1 &&
            collabSessionQuery.data.roster.filter(
              (member) => member.kind === "human",
            ).length <= 1,
          room_id: collabSessionQuery.data.room_id,
        }
      : null;
    // Group state is the write target of replaceCoworkRoster and is updated in
    // the query cache by that mutation. Prefer it over the compatibility
    // session projection; otherwise two briefly out-of-sync sources can
    // alternate the selected mode and append an unbounded event loop.
    const currentCoworkState =
      coworkGroupQuery.data?.state ?? sessionState ?? null;
    if (
      currentCoworkState === null &&
      (collabSessionQuery.isPending || coworkGroupQuery.isPending)
    ) {
      return;
    }

    const plan = buildCoworkSelectionSyncPlan({
      leaderId: currentTaskAgentName,
      collaboratorIds: selectedCollaboratorIds,
      mode:
        pendingRosterModeRef.current ??
        normalizeTeamResponseMode(teamModeIntent),
      current: currentCoworkState,
      keepLeader: Boolean(boundProjectQuery.data),
    });
    if (!plan.hasWork) return;

    const signature = `${threadId}|${plan.signature}`;
    if (lastCoworkSyncSignatureRef.current === signature) return;
    lastCoworkSyncSignatureRef.current = signature;

    replaceCoworkRosterMutation.mutate(
      {
        threadId,
        input: { agent_ids: plan.desiredAgentIds, mode: plan.mode },
      },
      {
        onSuccess: () => {
          const joined = selectedCollaboratorIds.filter(id => !persistedCollaboratorIds.includes(id));
          if (joined.length) {
            const names = joined.map(id => allTaskCollaboratorAgents.find(agent => agent.name === id)?.display_name || id);
            setMembershipNotice(`${names.join("、")} 已加入群聊。欢迎！你想和团队一起做什么？`);
          }

          collaboratorSelectionTouchedRef.current = false;
          responseModeIntentTouchedRef.current = false;
          pendingRosterModeRef.current = null;
        },
        onError: () => {
          // The picker is a draft until the one atomic server write succeeds.
          // Roll back visibly on failure instead of showing members that will
          // disappear on refresh.
          collaboratorSelectionTouchedRef.current = false;
          responseModeIntentTouchedRef.current = false;
          pendingRosterModeRef.current = null;
          lastCoworkSyncSignatureRef.current = null;
          setSelectedCollaboratorIds(persistedCollaboratorIds);
          setTeamModeIntent(
            persistedCollaboratorIds.length > 0
              ? normalizeTeamResponseMode(savedCollaborationMode)
              : "chat",
          );
          toast.error("AI 成员保存失败，请重试");
        },
      },
    );
  }, [
    allTaskCollaboratorAgents,
    collabSessionQuery.data,
    collabSessionQuery.isPending,
    coworkGroupQuery.data?.state,
    coworkGroupQuery.data,
    coworkGroupQuery.isPending,
    boundProjectQuery.data,
    boundProjectQuery.isPending,
    collaboratorSelectionTouchedRef,
    currentTaskAgentName,
    isNewThread,
    lastCoworkSyncSignatureRef,
    pendingRosterModeRef,
    persistedCollaboratorKey,
    persistedCollaboratorIds,
    replaceCoworkRosterMutation,
    responseModeIntentTouchedRef,
    savedCollaborationMode,
    selectedCollaboratorIds,
    setSelectedCollaboratorIds,
    setTeamModeIntent,
    teamModeIntent,
    threadId,
  ]);
  useEffect(() => setMembershipNotice(""), [threadId]);
  return { membershipNotice, setMembershipNotice };
}
