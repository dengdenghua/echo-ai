import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";

import type { TeamMode } from "@/components/workspace/team-mode-picker";
import { useAgent, type Agent } from "@/core/agents";
import { currentActorId } from "@/core/auth/api";
import {
  useCoworkTrust,
  type TrustScore,
  type useEnsureCollabRoom,
} from "@/core/cowork";
import type { ThreadCollaborationRosterEntry } from "@/core/collaboration/thread-collaboration";

import {
  firstString,
  readGroupPerspective,
  rememberGroupPerspective,
  resolveGroupPerspective,
  type ThreadRouteState,
} from "./page-utils";
import {
  buildCollaborationRosterSeats,
  buildLeaderCollaborationRoster,
  enrichMessageAgentRoster,
  mergeVisibleCollaborationRoster,
  type CollaborationProfile,
} from "./collaboration-roster-utils";
import type {
  BoundProjectQuery,
  CollabSessionQuery,
  RealtimeTranslations,
  StateSetter,
} from "./realtime-page-types";
import type { useThreadIdentity } from "./use-thread-workspace";

type ThreadIdentityQuery = ReturnType<
  typeof useThreadIdentity
>["threadIdentityQuery"];
type EnsureCollabRoomMutation = ReturnType<typeof useEnsureCollabRoom>;

interface CollaborationRosterInput {
  threadId: string;
  isNewThread: boolean;
  privateConversation: boolean;
  embeddedDesignChat: boolean;
  isEchoAssistant: boolean;
  effectiveAgentId: string;
  composerDisplayAgent: CollaborationProfile;
  selectedCollaborators: Agent[];
  savedCollaborationRoster: Parameters<
    typeof mergeVisibleCollaborationRoster
  >[0]["savedCollaborationRoster"];
  coworkCollaborationProfiles: CollaborationProfile[];
  collabSessionQuery: CollabSessionQuery;
  boundProjectQuery: BoundProjectQuery;
}

/**
 * Who is in this conversation: the draft roster, the merged visible roster,
 * whether it is a group, and the workbench seats with their trust scores.
 */
export function useCollaborationRoster({
  threadId,
  isNewThread,
  privateConversation,
  embeddedDesignChat,
  isEchoAssistant,
  effectiveAgentId,
  composerDisplayAgent,
  selectedCollaborators,
  savedCollaborationRoster,
  coworkCollaborationProfiles,
  collabSessionQuery,
  boundProjectQuery,
}: CollaborationRosterInput) {
  const collaborationRoster = useMemo(
    () =>
      buildLeaderCollaborationRoster(
        composerDisplayAgent,
        effectiveAgentId,
        selectedCollaborators,
      ),
    [composerDisplayAgent, effectiveAgentId, selectedCollaborators],
  );
  const collaborationEnabled =
    !privateConversation && !embeddedDesignChat && selectedCollaborators.length > 0;
  const visibleCollaborationRoster = useMemo(
    () =>
      mergeVisibleCollaborationRoster({
        privateConversation,
        collaborationEnabled,
        collaborationRoster,
        savedCollaborationRoster,
        coworkCollaborationProfiles,
      }),
    [
      privateConversation,
      collaborationEnabled,
      collaborationRoster,
      coworkCollaborationProfiles,
      savedCollaborationRoster,
    ],
  );
  const messageAgentRoster = useMemo(
    () =>
      enrichMessageAgentRoster(
        visibleCollaborationRoster,
        coworkCollaborationProfiles,
      ),
    [coworkCollaborationProfiles, visibleCollaborationRoster],
  );
  const visibleCollaborationEnabled =
    !embeddedDesignChat && visibleCollaborationRoster.length > 1;
  const isGroupConversation =
    !privateConversation &&
    !embeddedDesignChat &&
    !isEchoAssistant &&
    (visibleCollaborationEnabled ||
      Boolean(collabSessionQuery.data?.room_id) ||
      Boolean(boundProjectQuery.data));
  // 信任分：外包/外部成员进群前"这个人靠不靠谱"的一眼依据。
  // 随交付/接管事件缓变，两分钟刷新足够。
  const trustQuery = useCoworkTrust(
    isNewThread ? null : threadId,
    isGroupConversation,
  );
  const trustByMemberId = useMemo(() => {
    const map = new Map<string, TrustScore>();
    for (const score of trustQuery.data?.scores ?? []) {
      map.set(score.member_id, score);
    }
    return map;
  }, [trustQuery.data]);
  const collaborationRosterSeats = useMemo(
    () =>
      buildCollaborationRosterSeats({
        visibleCollaborationRoster,
        coworkCollaborationProfiles,
        roomParticipants: collabSessionQuery.data?.room_participants,
        trustByMemberId,
      }),
    [
      collabSessionQuery.data?.room_participants,
      coworkCollaborationProfiles,
      visibleCollaborationRoster,
      trustByMemberId,
    ],
  );
  return {
    collaborationRoster,
    collaborationEnabled,
    visibleCollaborationRoster,
    messageAgentRoster,
    visibleCollaborationEnabled,
    isGroupConversation,
    collaborationRosterSeats,
  };
}

/**
 * A group has one canonical timeline but several valid first-person
 * viewpoints. Keep the selected viewpoint scoped to this group instead of
 * using the global role picker as a request to leave for a new task.
 */
export function useGroupPerspective({
  threadId,
  isGroupConversation,
  visibleCollaborationRoster,
  activeAgentId,
  effectiveAgentId,
  displayAgent,
}: {
  threadId: string;
  isGroupConversation: boolean;
  visibleCollaborationRoster: ThreadCollaborationRosterEntry[];
  activeAgentId: string;
  effectiveAgentId: string;
  displayAgent: Agent | null;
}) {
  const [groupPerspectiveAgentId, setGroupPerspectiveAgentId] = useState<
    string | null
  >(() => readGroupPerspective(threadId));
  const groupPerspectiveAgentIds = useMemo(
    () => new Set(visibleCollaborationRoster.map((member) => member.agent_id)),
    [visibleCollaborationRoster],
  );
  const mainPerspectiveAgentId =
    isGroupConversation &&
    groupPerspectiveAgentId &&
    groupPerspectiveAgentIds.has(groupPerspectiveAgentId)
      ? groupPerspectiveAgentId
      : effectiveAgentId;
  const { agent: perspectiveAgent } = useAgent(
    mainPerspectiveAgentId !== effectiveAgentId ? mainPerspectiveAgentId : null,
  );
  const perspectiveDisplayAgent = perspectiveAgent ?? displayAgent;
  const perspectiveComposerAgent = useMemo(
    () =>
      perspectiveDisplayAgent ?? {
        name: mainPerspectiveAgentId,
        display_name: mainPerspectiveAgentId,
        avatar_url: null,
        icon: null,
      },
    [mainPerspectiveAgentId, perspectiveDisplayAgent],
  );
  useEffect(() => {
    if (!isGroupConversation) {
      setGroupPerspectiveAgentId(null);
      return;
    }
    setGroupPerspectiveAgentId((current) =>
      resolveGroupPerspective(
        current,
        activeAgentId,
        threadId,
        groupPerspectiveAgentIds,
        effectiveAgentId,
      ),
    );
  }, [
    activeAgentId,
    effectiveAgentId,
    groupPerspectiveAgentIds,
    isGroupConversation,
    threadId,
  ]);
  useEffect(() => {
    if (!isGroupConversation) return;
    rememberGroupPerspective(threadId, mainPerspectiveAgentId);
  }, [isGroupConversation, mainPerspectiveAgentId, threadId]);
  return {
    setGroupPerspectiveAgentId,
    groupPerspectiveAgentIds,
    mainPerspectiveAgentId,
    perspectiveDisplayAgent,
    perspectiveComposerAgent,
  };
}

/** The signed-in person's seat in the linked room and what it may do. */
export function useCollaborationParticipant({
  boundProjectQuery,
  threadIdentityQuery,
  collabSessionQuery,
  initialPrompt,
  user,
  t,
}: {
  boundProjectQuery: BoundProjectQuery;
  threadIdentityQuery: ThreadIdentityQuery;
  collabSessionQuery: CollabSessionQuery;
  initialPrompt: string;
  user: Parameters<typeof currentActorId>[0];
  t: RealtimeTranslations;
}) {
  const collaborationTeamName =
    boundProjectQuery.data?.project.name ||
    firstString(threadIdentityQuery.data?.values?.title, initialPrompt) ||
    t.collab.defaultTeamName;
  const currentInviteActor = currentActorId(user);
  const currentRoomParticipant = useMemo(
    () =>
      (collabSessionQuery.data?.room_participants ?? []).find((participant) => {
        const actorId =
          typeof participant.actor_id === "string"
            ? participant.actor_id.trim()
            : "";
        const participantId =
          typeof participant.id === "string" ? participant.id.trim() : "";
        return (
          actorId === currentInviteActor ||
          participantId === currentInviteActor ||
          participantId === `actor-${currentInviteActor}`
        );
      }),
    [collabSessionQuery.data?.room_participants, currentInviteActor],
  );
  const canManageHumanInvites = useMemo(() => {
    const participantRole =
      typeof currentRoomParticipant?.role === "string"
        ? currentRoomParticipant.role.trim().toLowerCase()
        : "";
    if (participantRole) return participantRole === "owner";
    const metadata = threadIdentityQuery.data?.metadata;
    const ownerActorId =
      metadata && typeof metadata["owner_actor_id"] === "string"
        ? metadata["owner_actor_id"].trim()
        : "";
    return (
      !ownerActorId ||
      ownerActorId === currentInviteActor
    );
  }, [currentInviteActor, currentRoomParticipant, threadIdentityQuery.data]);
  const canWriteConversation =
    !collabSessionQuery.data?.room_id ||
    canManageHumanInvites ||
    currentRoomParticipant?.role === "member";
  const realtimeRoomParticipant =
    currentRoomParticipant ??
    (canManageHumanInvites
      ? (collabSessionQuery.data?.room_participants ?? []).find(
          (participant) =>
            String(participant.role ?? "")
              .trim()
              .toLowerCase() === "owner",
        )
      : undefined);
  const realtimeParticipantId = firstString(
    realtimeRoomParticipant?.id,
    realtimeRoomParticipant?.participant_id,
    currentInviteActor,
  );
  const realtimeParticipantName =
    firstString(
      realtimeRoomParticipant?.display_name,
      realtimeRoomParticipant?.name,
    ) || "我";
  return {
    collaborationTeamName,
    currentInviteActor,
    currentRoomParticipant,
    canManageHumanInvites,
    canWriteConversation,
    realtimeRoomParticipant,
    realtimeParticipantId,
    realtimeParticipantName,
  };
}

interface HumanInviteRoomInput {
  threadId: string;
  isNewThread: boolean;
  t: RealtimeTranslations;
  visibleCollaborationRoster: ThreadCollaborationRosterEntry[];
  collaborationTeamName: string;
  teamModeIntent: TeamMode;
  effectiveAgentId: string;
  ensureCollabRoomMutation: EnsureCollabRoomMutation;
  collabSessionQuery: CollabSessionQuery;
  humanInviteRoomId: string;
  setHumanInviteRoomId: StateSetter<string>;
  setHumanInviteDialogOpen: StateSetter<boolean>;
  routeState: ThreadRouteState | null;
  navigate: NavigateFunction;
  pathname: string;
  search: string;
}

/**
 * The linked Team Room that real people are invited into: its member payload,
 * on-demand creation, and the one-shot "invite people next" route request.
 */
export function useHumanInviteRoom({
  threadId,
  isNewThread,
  t,
  visibleCollaborationRoster,
  collaborationTeamName,
  teamModeIntent,
  effectiveAgentId,
  ensureCollabRoomMutation,
  collabSessionQuery,
  humanInviteRoomId,
  setHumanInviteRoomId,
  setHumanInviteDialogOpen,
  routeState,
  navigate,
  pathname,
  search,
}: HumanInviteRoomInput) {
  const collaborationRoomMemberPayload = useMemo(
    () =>
      visibleCollaborationRoster.map((agent) => ({
        name: agent.agent_id,
        display_name: agent.display_name,
        description:
          agent.role === "tl"
            ? t.collab.common.leader
            : t.collab.common.aiMember,
        avatar_url: agent.avatar_url ?? undefined,
        icon: agent.icon ?? undefined,
      })),
    [t, visibleCollaborationRoster],
  );
  const collaborationRoomSignature = useMemo(
    () =>
      [
        threadId,
        collaborationTeamName,
        teamModeIntent,
        ...collaborationRoomMemberPayload.map((member) => member.name),
      ].join("\u0000"),
    [
      collaborationRoomMemberPayload,
      collaborationTeamName,
      teamModeIntent,
      threadId,
    ],
  );
  const resolvedHumanInviteRoomId =
    humanInviteRoomId || collabSessionQuery.data?.room_id || "";
  const ensureHumanInviteRoom = useCallback(async () => {
    if (isNewThread || !threadId || threadId === "new") {
      throw new Error("请先发送一条消息，再邀请真人加入群聊");
    }
    const response = await ensureCollabRoomMutation.mutateAsync({
      threadId,
      input: {
        id: `collab-${threadId}`,
        name: collaborationTeamName,
        members: collaborationRoomMemberPayload,
        leaderId: collaborationRoomMemberPayload[0]?.name ?? effectiveAgentId,
        mode: teamModeIntent,
      },
    });
    const roomId =
      response.session.room_id ||
      (typeof response.room.id === "string" ? response.room.id : "");
    if (!roomId) throw new Error("群聊房间创建失败，请重试");
    setHumanInviteRoomId(roomId);
    return roomId;
  }, [
    collaborationRoomMemberPayload,
    collaborationTeamName,
    effectiveAgentId,
    ensureCollabRoomMutation,
    isNewThread,
    setHumanInviteRoomId,
    teamModeIntent,
    threadId,
  ]);
  const handleOpenHumanInvite = useCallback(async () => {
    try {
      await ensureHumanInviteRoom();
      setHumanInviteDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法创建邀请链接");
    }
  }, [ensureHumanInviteRoom, setHumanInviteDialogOpen]);
  const humanInviteRouteOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      isNewThread ||
      !routeState?.openHumanInviteAfterCreate ||
      humanInviteRouteOpenedRef.current === threadId
    ) {
      return;
    }
    humanInviteRouteOpenedRef.current = threadId;
    const nextState = { ...routeState };
    delete nextState.openHumanInviteAfterCreate;
    void handleOpenHumanInvite().finally(() => {
      navigate(`${pathname}${search}`, {
        replace: true,
        state: nextState,
      });
    });
  }, [
    handleOpenHumanInvite,
    isNewThread,
    pathname,
    search,
    navigate,
    routeState,
    threadId,
  ]);
  return {
    collaborationRoomMemberPayload,
    collaborationRoomSignature,
    resolvedHumanInviteRoomId,
    ensureHumanInviteRoom,
    handleOpenHumanInvite,
  };
}

/**
 * Groups and project threads always get a canonical room; also drops the
 * current leader from the collaborator draft whenever the leader changes.
 */
export function useCanonicalCollabRoom({
  threadId,
  isNewThread,
  embeddedDesignChat,
  visibleCollaborationEnabled,
  boundProjectQuery,
  collabSessionQuery,
  ensureCollabRoomMutation,
  collaborationRoomSignature,
  collaborationRoomMemberPayload,
  collaborationTeamName,
  effectiveAgentId,
  teamModeIntent,
  currentTaskAgentName,
  setSelectedCollaboratorIds,
}: {
  threadId: string;
  isNewThread: boolean;
  embeddedDesignChat: boolean;
  visibleCollaborationEnabled: boolean;
  boundProjectQuery: BoundProjectQuery;
  collabSessionQuery: CollabSessionQuery;
  ensureCollabRoomMutation: EnsureCollabRoomMutation;
  collaborationRoomSignature: string;
  collaborationRoomMemberPayload: ReturnType<
    typeof useHumanInviteRoom
  >["collaborationRoomMemberPayload"];
  collaborationTeamName: string;
  effectiveAgentId: string;
  teamModeIntent: TeamMode;
  currentTaskAgentName: string;
  setSelectedCollaboratorIds: StateSetter<string[]>;
}) {
  const lastEnsuredCollabRoomRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      embeddedDesignChat ||
      isNewThread ||
      !threadId ||
      threadId === "new" ||
      (!visibleCollaborationEnabled && !boundProjectQuery.data) ||
      collabSessionQuery.isPending ||
      collabSessionQuery.data?.room_id ||
      ensureCollabRoomMutation.isPending
    ) {
      return;
    }
    if (lastEnsuredCollabRoomRef.current === collaborationRoomSignature) {
      return;
    }
    lastEnsuredCollabRoomRef.current = collaborationRoomSignature;
    ensureCollabRoomMutation.mutate(
      {
        threadId,
        input: {
          id: `collab-${threadId}`,
          name: collaborationTeamName,
          members: collaborationRoomMemberPayload,
          leaderId: collaborationRoomMemberPayload[0]?.name ?? effectiveAgentId,
          mode: teamModeIntent,
        },
      },
      {
        onError: () => {
          if (lastEnsuredCollabRoomRef.current === collaborationRoomSignature) {
            lastEnsuredCollabRoomRef.current = null;
          }
        },
      },
    );
  }, [
    collabSessionQuery.data?.room_id,
    collabSessionQuery.isPending,
    boundProjectQuery.data,
    collaborationRoomMemberPayload,
    collaborationRoomSignature,
    collaborationTeamName,
    embeddedDesignChat,
    effectiveAgentId,
    ensureCollabRoomMutation,
    isNewThread,
    teamModeIntent,
    threadId,
    visibleCollaborationEnabled,
  ]);
  useEffect(() => {
    setSelectedCollaboratorIds((current) =>
      current.filter((id) => id !== currentTaskAgentName),
    );
  }, [currentTaskAgentName, setSelectedCollaboratorIds]);
}
