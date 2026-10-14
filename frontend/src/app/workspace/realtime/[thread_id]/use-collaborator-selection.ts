import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { useBoundProjectState } from "@/components/workspace/agent-workbench-panel/project-os-tab";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import type { GroupTaskStrategy } from "@/components/workspace/group-task-strategy";
import type { ChatCollaborationRosterEntry } from "@/components/workspace/realtime/task-collaborator-control";
import {
  normalizeTeamResponseMode,
  type TeamMode,
} from "@/components/workspace/team-mode-picker";
import { useRemoteGroupAgents } from "@/core/agents/remote-agents";
import {
  dedupeAgentsByName,
  dedupePersonaAgentsByDisplayName,
  useAgents,
  useMobileDevices,
  type Agent,
} from "@/core/agents";
import {
  consumeTaskCollaboratorPreset,
  TASK_COLLABORATOR_PRESET_EVENT,
  type TaskCollaboratorPreset,
} from "@/core/collaboration/task-collaborator-preset";
import { collaborationRosterFromThread } from "@/core/collaboration/thread-collaboration";
import {
  coworkGroupToCollaborationRoster,
  coworkSessionToCollaborationRoster,
  coworkSessionToMentionMembers,
  useApplyCollabRoomMessageProjectAction,
  useCollabSession,
  useCoworkGroup,
  useEnsureCollabRoom,
  usePostCollabRoomMessage,
  useReplaceCoworkRoster,
} from "@/core/cowork";
import { useDetachProjectFromGroup } from "@/core/projects/hooks";
import type { Team } from "@/core/teams/api";

import type {
  CollabSessionQuery,
  CoworkGroupQuery,
  StateSetter,
} from "./realtime-page-types";
import type { CollaborationProfile } from "./collaboration-roster-utils";
import type { useThreadIdentity } from "./use-thread-workspace";

type ThreadIdentityQuery = ReturnType<
  typeof useThreadIdentity
>["threadIdentityQuery"];

/** Server state the collaboration surfaces read and write for this thread. */
export function useCollaborationQueries({
  threadId,
  isNewThread,
}: {
  threadId: string;
  isNewThread: boolean;
}) {
  const [collaboratorPickerOpen, setCollaboratorPickerOpen] = useState(false);
  const coworkGroupQuery = useCoworkGroup(isNewThread ? null : threadId);
  const collabSessionQuery = useCollabSession(isNewThread ? null : threadId);
  const boundProjectQuery = useBoundProjectState(isNewThread ? null : threadId);
  const detachProjectFromGroupMutation = useDetachProjectFromGroup();
  const { confirm: confirmProjectDetach, confirmDialog: projectDetachDialog } =
    useConfirmDialog();
  const replaceCoworkRosterMutation = useReplaceCoworkRoster();
  const ensureCollabRoomMutation = useEnsureCollabRoom();
  const postCollabRoomMessageMutation = usePostCollabRoomMessage();
  const applyRoomMessageProjectActionMutation =
    useApplyCollabRoomMessageProjectAction();
  return {
    collaboratorPickerOpen,
    setCollaboratorPickerOpen,
    coworkGroupQuery,
    collabSessionQuery,
    boundProjectQuery,
    detachProjectFromGroupMutation,
    confirmProjectDetach,
    projectDetachDialog,
    replaceCoworkRosterMutation,
    ensureCollabRoomMutation,
    postCollabRoomMessageMutation,
    applyRoomMessageProjectActionMutation,
  };
}

/** Every agent that can join this task, plus the @-mention member list. */
export function useTaskCollaboratorAgents({
  collaboratorPickerOpen,
  collabSessionQuery,
  coworkGroupQuery,
}: {
  collaboratorPickerOpen: boolean;
  collabSessionQuery: CollabSessionQuery;
  coworkGroupQuery: CoworkGroupQuery;
}) {
  const { agents: builtinAgents } = useAgents();
  const hasPersistedCollaboration = Boolean(
    collabSessionQuery.data?.room_id ||
    (collabSessionQuery.data &&
      (collabSessionQuery.data.roster.length > 1 ||
        collabSessionQuery.data.mode !== "chat")) ||
    (coworkGroupQuery.data &&
      (coworkGroupQuery.data.state.roster.length > 1 ||
        coworkGroupQuery.data.state.mode !== "chat")),
  );
  const { mobileAgents } = useMobileDevices({
    enabled: collaboratorPickerOpen || hasPersistedCollaboration,
  });
  const remoteAgents = useRemoteGroupAgents(collaboratorPickerOpen || hasPersistedCollaboration);
  const allTaskCollaboratorAgents = useMemo(
    () =>
      dedupePersonaAgentsByDisplayName(
        dedupeAgentsByName([...remoteAgents, ...mobileAgents, ...builtinAgents]),
      ),
    [builtinAgents, mobileAgents, remoteAgents],
  );
  const collaborationMentionMembers = useMemo(
    () =>
      coworkSessionToMentionMembers(
        collabSessionQuery.data,
        allTaskCollaboratorAgents.map((agent) => ({
          name: agent.name,
          display_name: agent.display_name,
          icon: agent.icon,
          description: agent.description,
          avatar_url: agent.avatar_url,
        })),
      ),
    [allTaskCollaboratorAgents, collabSessionQuery.data],
  );
  return {
    hasPersistedCollaboration,
    allTaskCollaboratorAgents,
    collaborationMentionMembers,
  };
}

/**
 * The roster/response-mode draft of this tab. The refs record whether this
 * mounted page has an explicit write intent the roster sync may persist.
 */
export function useCollaboratorSelectionState(threadId: string) {
  const [selectedCollaboratorIds, setSelectedCollaboratorIds] = useState<
    string[]
  >([]);
  const [teamModeIntent, setTeamModeIntent] = useState<TeamMode>("chat");
  const [groupTaskStrategy, setGroupTaskStrategy] =
    useState<GroupTaskStrategy>("auto");
  const [humanInviteDialogOpen, setHumanInviteDialogOpen] = useState(false);
  const [humanInviteRoomId, setHumanInviteRoomId] = useState("");
  const [promoteGroupDialogOpen, setPromoteGroupDialogOpen] = useState(false);
  const collaboratorSelectionTouchedRef = useRef(false);
  const responseModeIntentTouchedRef = useRef(false);
  const pendingRosterModeRef = useRef<TeamMode | null>(null);
  const lastCoworkSyncSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    collaboratorSelectionTouchedRef.current = false;
    responseModeIntentTouchedRef.current = false;
    pendingRosterModeRef.current = null;
    lastCoworkSyncSignatureRef.current = null;
    setSelectedCollaboratorIds([]);
    setTeamModeIntent("chat");
    setGroupTaskStrategy("auto");
    setHumanInviteDialogOpen(false);
    setHumanInviteRoomId("");
    setPromoteGroupDialogOpen(false);
  }, [threadId]);

  return {
    selectedCollaboratorIds,
    setSelectedCollaboratorIds,
    teamModeIntent,
    setTeamModeIntent,
    groupTaskStrategy,
    setGroupTaskStrategy,
    humanInviteDialogOpen,
    setHumanInviteDialogOpen,
    humanInviteRoomId,
    setHumanInviteRoomId,
    promoteGroupDialogOpen,
    setPromoteGroupDialogOpen,
    collaboratorSelectionTouchedRef,
    responseModeIntentTouchedRef,
    pendingRosterModeRef,
    lastCoworkSyncSignatureRef,
  };
}

/** The roster already saved for this thread (cowork group/session or metadata). */
export function usePersistedCollaborationRoster({
  allTaskCollaboratorAgents,
  selectedCollaboratorIds,
  threadIdentityQuery,
  currentTaskAgentName,
  composerDisplayAgent,
  collabSessionQuery,
  coworkGroupQuery,
}: {
  allTaskCollaboratorAgents: Agent[];
  selectedCollaboratorIds: string[];
  threadIdentityQuery: ThreadIdentityQuery;
  currentTaskAgentName: string;
  composerDisplayAgent: CollaborationProfile;
  collabSessionQuery: CollabSessionQuery;
  coworkGroupQuery: CoworkGroupQuery;
}) {
  const selectedCollaborators = useMemo(() => {
    const selected = new Set(selectedCollaboratorIds);
    return allTaskCollaboratorAgents.filter((agent) =>
      selected.has(agent.name),
    );
  }, [allTaskCollaboratorAgents, selectedCollaboratorIds]);
  const persistedCollaborationRoster = useMemo(
    () =>
      collaborationRosterFromThread(
        threadIdentityQuery.data?.metadata,
        threadIdentityQuery.data?.values,
        currentTaskAgentName,
      ),
    [
      currentTaskAgentName,
      threadIdentityQuery.data?.metadata,
      threadIdentityQuery.data?.values,
    ],
  );
  const coworkCollaborationProfiles = useMemo(
    () => [composerDisplayAgent, ...allTaskCollaboratorAgents],
    [allTaskCollaboratorAgents, composerDisplayAgent],
  );
  const coworkCollaborationRoster = useMemo(() => {
    const sessionRoster = coworkSessionToCollaborationRoster(
      collabSessionQuery.data,
      currentTaskAgentName,
      coworkCollaborationProfiles,
    );
    const groupRoster = coworkGroupToCollaborationRoster(
      coworkGroupQuery.data,
      currentTaskAgentName,
      coworkCollaborationProfiles,
    );
    if (sessionRoster.length === 0) return groupRoster;
    if (groupRoster.length === 0) return sessionRoster;
    const seen = new Map<string, ChatCollaborationRosterEntry>();
    for (const entry of sessionRoster) seen.set(entry.agent_id, entry);
    for (const entry of groupRoster) {
      if (!seen.has(entry.agent_id)) seen.set(entry.agent_id, entry);
    }
    return Array.from(seen.values());
  }, [
    collabSessionQuery.data,
    coworkCollaborationProfiles,
    coworkGroupQuery.data,
    currentTaskAgentName,
  ]);
  const savedCollaborationRoster = useMemo(() => {
    if (coworkCollaborationRoster.length > 0) return coworkCollaborationRoster;
    return persistedCollaborationRoster;
  }, [coworkCollaborationRoster, persistedCollaborationRoster]);
  const persistedCollaboratorIds = useMemo(
    () =>
      savedCollaborationRoster
        .filter(
          (agent) =>
            agent.role !== "tl" && agent.agent_id !== currentTaskAgentName,
        )
        .map((agent) => agent.agent_id),
    [currentTaskAgentName, savedCollaborationRoster],
  );
  const persistedCollaboratorKey = persistedCollaboratorIds.join("\u0000");
  const savedCollaborationMode =
    coworkGroupQuery.data?.state.mode ?? collabSessionQuery.data?.mode;
  return {
    selectedCollaborators,
    coworkCollaborationProfiles,
    savedCollaborationRoster,
    persistedCollaboratorIds,
    persistedCollaboratorKey,
    savedCollaborationMode,
  };
}

interface TaskCollaboratorPresetsInput {
  threadId: string;
  isNewThread: boolean;
  privateConversation: boolean;
  embeddedDesignChat: boolean;
  currentTaskAgentName: string;
  threadIdentityQuery: ThreadIdentityQuery;
  localStartedThreadIdRef: RefObject<string | null>;
  persistedCollaboratorKey: string;
  persistedCollaboratorIds: string[];
  savedCollaborationMode: TeamMode | undefined;
  collaboratorSelectionTouchedRef: RefObject<boolean>;
  responseModeIntentTouchedRef: RefObject<boolean>;
  setSelectedCollaboratorIds: StateSetter<string[]>;
  setTeamModeIntent: StateSetter<TeamMode>;
  setCollaboratorPickerOpen: StateSetter<boolean>;
}

/**
 * Applies roster presets (team templates, deep links, the welcome team) and
 * hydrates the draft from the saved roster until this tab touches it.
 */
export function useTaskCollaboratorPresets({
  threadId,
  isNewThread,
  privateConversation,
  embeddedDesignChat,
  currentTaskAgentName,
  threadIdentityQuery,
  localStartedThreadIdRef,
  persistedCollaboratorKey,
  persistedCollaboratorIds,
  savedCollaborationMode,
  collaboratorSelectionTouchedRef,
  responseModeIntentTouchedRef,
  setSelectedCollaboratorIds,
  setTeamModeIntent,
  setCollaboratorPickerOpen,
}: TaskCollaboratorPresetsInput) {
  const applyTaskCollaboratorPreset = useCallback(
    (preset: TaskCollaboratorPreset) => {
      const nextIds = Array.from(
        new Set(
          (preset.collaboratorIds ?? [])
            .map((id) => id.trim())
            .filter((id) => id && id !== currentTaskAgentName),
        ),
      );
      collaboratorSelectionTouchedRef.current = true;
      setSelectedCollaboratorIds(nextIds);
      setTeamModeIntent(
        nextIds.length > 0
          ? normalizeTeamResponseMode(preset.mode ?? "cluster")
          : "chat",
      );
      if (preset.openPicker) {
        setCollaboratorPickerOpen(true);
      }
    },
    [
      collaboratorSelectionTouchedRef,
      currentTaskAgentName,
      setCollaboratorPickerOpen,
      setSelectedCollaboratorIds,
      setTeamModeIntent,
    ],
  );
  const welcomeRosterLoadedRef = useRef<string | null>(null);
  const handleWelcomeTeamLoaded = useCallback((team: Team) => {
    if (!isNewThread || welcomeRosterLoadedRef.current === team.id) return;
    welcomeRosterLoadedRef.current = team.id;
    applyTaskCollaboratorPreset({ leaderId: team.leaderId, collaboratorIds: team.members.map(member => member.name), mode: "cluster" });
  }, [isNewThread, applyTaskCollaboratorPreset]);
  useEffect(() => {
    if (privateConversation) {
      setSelectedCollaboratorIds([]);
      setTeamModeIntent("chat");
      return;
    }
    const storedPreset = consumeTaskCollaboratorPreset();
    if (storedPreset) {
      applyTaskCollaboratorPreset(storedPreset);
    }
    const handler = (event: Event) => {
      const preset = (event as CustomEvent<TaskCollaboratorPreset>).detail;
      if (preset) {
        applyTaskCollaboratorPreset(preset);
      }
    };
    window.addEventListener(TASK_COLLABORATOR_PRESET_EVENT, handler);
    return () =>
      window.removeEventListener(TASK_COLLABORATOR_PRESET_EVENT, handler);
  }, [
    applyTaskCollaboratorPreset,
    privateConversation,
    setSelectedCollaboratorIds,
    setTeamModeIntent,
  ]);
  useEffect(() => {
    if (
      embeddedDesignChat ||
      isNewThread ||
      threadIdentityQuery.isPending ||
      localStartedThreadIdRef.current === threadId
    ) {
      return;
    }
    if (collaboratorSelectionTouchedRef.current) {
      return;
    }
    setSelectedCollaboratorIds((current) =>
      current.join("\u0000") === persistedCollaboratorKey
        ? current
        : persistedCollaboratorIds,
    );
    if (
      !responseModeIntentTouchedRef.current &&
      persistedCollaboratorIds.length > 0
    ) {
      setTeamModeIntent(normalizeTeamResponseMode(savedCollaborationMode));
    }
  }, [
    collaboratorSelectionTouchedRef,
    embeddedDesignChat,
    isNewThread,
    localStartedThreadIdRef,
    persistedCollaboratorKey,
    persistedCollaboratorIds,
    responseModeIntentTouchedRef,
    savedCollaborationMode,
    setSelectedCollaboratorIds,
    setTeamModeIntent,
    threadId,
    threadIdentityQuery.isPending,
  ]);
  return { applyTaskCollaboratorPreset, handleWelcomeTeamLoaded };
}

/** Picker callbacks: each records an explicit write intent for the roster sync. */
export function useCollaboratorSelectionHandlers({
  currentTaskAgentName,
  persistedCollaboratorIds,
  savedCollaborationMode,
  collaboratorSelectionTouchedRef,
  responseModeIntentTouchedRef,
  pendingRosterModeRef,
  setSelectedCollaboratorIds,
  setTeamModeIntent,
}: {
  currentTaskAgentName: string;
  persistedCollaboratorIds: string[];
  savedCollaborationMode: TeamMode | undefined;
  collaboratorSelectionTouchedRef: RefObject<boolean>;
  responseModeIntentTouchedRef: RefObject<boolean>;
  pendingRosterModeRef: RefObject<TeamMode | null>;
  setSelectedCollaboratorIds: StateSetter<string[]>;
  setTeamModeIntent: StateSetter<TeamMode>;
}) {
  const handleSelectedCollaboratorIdsChange = useCallback(
    (ids: string[]) => {
      const leader = currentTaskAgentName.trim();
      const nextIds = Array.from(
        new Set(ids.map((id) => id.trim()).filter((id) => id && id !== leader)),
      );
      collaboratorSelectionTouchedRef.current = true;
      pendingRosterModeRef.current =
        nextIds.length === 0
          ? "chat"
          : persistedCollaboratorIds.length === 0
            ? "cluster"
            : normalizeTeamResponseMode(savedCollaborationMode);
      setSelectedCollaboratorIds(nextIds);
      if (nextIds.length === 0) {
        setTeamModeIntent("chat");
      }
    },
    [
      collaboratorSelectionTouchedRef,
      currentTaskAgentName,
      pendingRosterModeRef,
      persistedCollaboratorIds.length,
      savedCollaborationMode,
      setSelectedCollaboratorIds,
      setTeamModeIntent,
    ],
  );
  const handleTeamModeIntentChange = useCallback((mode: TeamMode) => {
    responseModeIntentTouchedRef.current = true;
    setTeamModeIntent(mode);
  }, [responseModeIntentTouchedRef, setTeamModeIntent]);
  return { handleSelectedCollaboratorIdsChange, handleTeamModeIntentChange };
}
