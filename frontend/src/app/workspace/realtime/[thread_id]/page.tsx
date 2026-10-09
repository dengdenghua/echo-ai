import { InviteDialog } from "@/components/workspace/collab/invite-dialog";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FinalArtifactCompletionNotice } from "@/components/workspace/realtime/final-artifact-completion-notice";
import { ProjectProposalNotice } from "@/components/workspace/realtime/project-proposal-notice";
import { RightPanelMenu } from "@/components/workspace/realtime/right-panel-menu";
import { ConversationEmptyState } from "@/components/workspace/realtime/conversation-empty-state";
import { TaskDeliveryReview } from "@/components/workspace/task-delivery-review";
import { resolveGroupProjectCapabilityAction } from "@/components/workspace/realtime/group-project-capability";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import {
  ArtifactsProvider,
  useArtifacts,
} from "@/components/workspace/artifacts";
import type { ProjectFullState } from "@/components/workspace/agent-workbench-panel/project-os-tab";
import { CollaborationRealtimeBridge } from "@/components/workspace/collab";
import { ChatBox, useThreadChat } from "@/components/workspace/chats";
import { ChatsDrawer } from "@/components/workspace/chats-drawer";
import { RecRecorderOverlay } from "@/components/workspace/rec-recorder-overlay";
import { preferredWorkbenchTab } from "@/core/workspace/workbench-preferences";
import { ChatPageLayout } from "@/components/workspace/chat-page-layout";
import {
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
  MessageList,
} from "@/components/workspace/messages";
import { LoadOlderTurnsBanner } from "@/components/workspace/messages/load-older-turns-banner";
import { ThreadProviders } from "@/components/workspace/messages/context";
import { FileReferenceScope } from "@/core/navigation/file-reference";
import { AutomationPreviewHost } from "@/components/workspace/automation-preview-host";
import { PlanPanel } from "@/components/workspace/plan-panel";
import { StreamingDebugger } from "@/components/workspace/streaming-debugger";
import { ContextCompressionIndicator } from "@/components/workspace/context-compression-indicator";
import { TeamWelcomeCard } from "@/components/workspace/team-welcome-card";
import {
  usePlanActionHandler,
  useRegenerateHandler,
} from "@/components/workspace/use-thread-page";
import { SubtasksProvider } from "@/core/tasks/context";
import { useDeferredRouteCommit } from "@/core/router/use-deferred-route-commit";
import { useThreadSettings } from "@/core/settings";
import { useExecutionEngine } from "@/core/threads/use-execution-engine";
import { useThreadWorkLocation } from "@/core/execution/work-location";
import {
  useThreadStream,
  type ThreadStreamOptions,
} from "@/core/threads/hooks";
import { useHistoryDraft } from "@/core/threads/use-history-draft";
import { eventBus, useEvent } from "@/core/events";
import { canAccessGlobalControlPlane } from "@/core/auth/control-plane-access";
import { useAuth } from "@/providers/AuthProvider";
import { useTasks } from "@/core/tasks/hooks";
import type { CoworkRoomMessage } from "@/core/cowork";
import { useI18n } from "@/core/i18n/hooks";
import { ToolEffectsProvider } from "@/core/observability/tool-effects-context";
import { useModels } from "@/core/models/hooks";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import {
  firstString,
  normalizeReasoningEffortForUi,
  type ThreadRouteState,
} from "./page-utils";
import { buildCollaborationTurnContext } from "./collaboration-roster-utils";
import {
  RealtimeChatHeader,
  RealtimeHeaderMemberControl,
  RealtimeProjectStatusBadge,
} from "./realtime-chat-header";
import { RealtimeChatInput } from "./realtime-chat-input";
import { RealtimeComposerArea } from "./realtime-composer-area";
import {
  RealtimeAutomationSurface,
  RealtimeResearchErrorSurface,
  RealtimeResearchHistorySurface,
  RealtimeResearchSurface,
  RealtimeTeachRepeatSurface,
  RealtimeWorkbenchSurface,
} from "./realtime-secondary-panel";
import { buildRealtimeStreamContext } from "./realtime-stream-context";
import {
  useAgentDisplayEvents,
  useAgentRunState,
  useLastTurnView,
  useSidebarRunStatus,
} from "./use-agent-run-state";
import {
  useAutomationTarget,
  useObservedAutomationTarget,
} from "./use-automation-target";
import {
  useCollaborationParticipant,
  useCollaborationRoster,
  useCanonicalCollabRoom,
  useGroupPerspective,
  useHumanInviteRoom,
} from "./use-collaboration-roster";
import {
  useCollaborationQueries,
  useCollaboratorSelectionHandlers,
  useCollaboratorSelectionState,
  usePersistedCollaborationRoster,
  useTaskCollaboratorAgents,
  useTaskCollaboratorPresets,
} from "./use-collaborator-selection";
import { useCoworkRosterSync } from "./use-cowork-roster-sync";
import { useEmbeddedDesignChat, useDesignThreadBridge } from "./use-embedded-design-chat";
import {
  useConversationMode,
  useProjectAgentModeHandlers,
  useProjectAgentModeState,
} from "./use-project-agent-mode";
import {
  useProjectCapabilityDetach,
  useProjectMessageActions,
  useProjectWorkbenchOpener,
  useRoomTimelineMessageActions,
} from "./use-project-room-actions";
import {
  useActiveAgentSync,
  useEchoAssistantChannels,
  useRealtimeAgentRoute,
  useRealtimeDisplayAgent,
} from "./use-realtime-agent";
import {
  useComposerSettingsHandlers,
  useRealtimeSubmit,
} from "./use-realtime-submit";
import {
  useDeepResearchLauncher,
  useResearchViewState,
} from "./use-research-view-state";
import {
  useArtifactOpenRequests,
  useRightPanelSwitches,
  useWorkbenchPanelOpeners,
} from "./use-right-panel-navigation";
import {
  useContextWindow,
  useConversationTimelineEntries,
  useModelSwitchTimeline,
} from "./use-thread-timeline";
import {
  resolveWorkspaceScope,
  usePersistedWorkspaceSync,
  useThreadIdentity,
  useThreadWorkspace,
  useWorkDirSelection,
} from "./use-thread-workspace";
import {
  useDirectTurnSenders,
  useNetworkAuthorizationRegen,
  useNewThreadRoutePromotion,
  usePendingNewSessionSend,
  useRealtimeStopController,
  useThreadRouting,
} from "./use-turn-lifecycle";
import {
  useWorkbenchAutoBehaviour,
  useWorkbenchAvailability,
} from "./use-workbench-availability";
import {
  useProjectWorkbenchRouteOpen,
  useUtilityPanels,
  useWorkbenchFocusState,
  useWorkbenchSurfaceState,
} from "./use-workbench-surface";

/**
 * Plain chat workspace. Mirrors the team / code page architecture
 * (`ThreadProviders → ChatBox → ChatPageLayout`) so headers, message
 * list, composer, and Welcome state all share the same Echo-style
 * design. No file tree, no team-mode picker — just the conversation.
 */
export default function RealtimePage() {
  const chatState = useThreadChat();

  return (
    <ArtifactsProvider threadId={chatState.threadId}>
      <RealtimePageContent chatState={chatState} />
    </ArtifactsProvider>
  );
}

function RealtimePageContent({
  chatState,
}: {
  chatState: ReturnType<typeof useThreadChat>;
}) {
  const { t } = useI18n();
  const { authStatus, user, isLoading: authLoading } = useAuth();
  const { threadId, isNewThread, setIsNewThread } = chatState;
  const activeThreadIdRef = useRef(threadId);
  useLayoutEffect(() => {
    activeThreadIdRef.current = threadId;
  }, [threadId]);
  const {
    artifacts,
    open: artifactsOpen,
    select: selectArtifact,
    setOpen: setArtifactsOpen,
    setArtifacts,
  } = useArtifacts();
  const [settings, setSettings] = useThreadSettings(threadId);
  const [mounted, setMounted] = useState(false);
  const {
    researchJob,
    researchLoading,
    researchError,
    showResearch,
    setResearchJob,
    setResearchLoading,
    setResearchError,
    setShowResearch,
    researchOperationRef,
  } = useResearchViewState(threadId, activeThreadIdRef);
  const [chatsDrawerOpen, setChatsDrawerOpen] = useState(false);
  const {
    recorderPluginEnabled,
    showAutomationPanel,
    setShowAutomationPanel,
    showTeachRepeatPanel,
    setShowTeachRepeatPanel,
    closeSpecialUtilityPanels,
    openTeachRepeatPanel,
    toggleAutomationPanel,
    recOverlayOpen,
    setRecOverlayOpen,
    recIsRecording,
    setRecIsRecording,
  } = useUtilityPanels({ threadId, isNewThread });
  const {
    projectAgentMode,
    setProjectAgentMode,
    projectDetection,
    setProjectDetection,
    modeManualOverride,
    setModeManualOverride,
    modeIntentSuggestion,
    setModeIntentSuggestion,
  } = useProjectAgentModeState();
  const localStartedThreadIdRef = useRef<string | null>(null);
  const threadQueryScope = { threadId, isNewThread, localStartedThreadIdRef };
  const { workDir, setWorkDir, handleWorkDirChange, threadWorkspaceQuery } =
    useThreadWorkspace(threadQueryScope);
  const { automationTarget, setAutomationTarget, handleAutomationTargetChange } =
    useAutomationTarget(threadId);
  const { threadIdentityQuery, headerThreadTitle } =
    useThreadIdentity(threadQueryScope);
  const {
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
  } = useCollaborationQueries({ threadId, isNewThread });
  usePersistedWorkspaceSync({
    ...threadQueryScope,
    threadWorkspaceQuery,
    setWorkDir,
  });

  const { models } = useModels();
  const {
    hasPersistedCollaboration,
    allTaskCollaboratorAgents,
    collaborationMentionMembers,
  } = useTaskCollaboratorAgents({
    collaboratorPickerOpen,
    collabSessionQuery,
    coworkGroupQuery,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const {
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
  } = useCollaboratorSelectionState(threadId);

  const navigate = useNavigate();
  const location = useLocation();
  const {
    showResearchHistory,
    setShowResearchHistory,
    showAgentPlan,
    setShowAgentPlan,
    agentWorkbenchTab,
    setAgentWorkbenchTab,
    agentWorkbenchTabTouched,
    setAgentWorkbenchTabTouched,
    agentWorkbenchManuallyOpened,
    setAgentWorkbenchManuallyOpened,
  } = useWorkbenchSurfaceState({
    threadId,
    isNewThread,
    pathname: location.pathname,
  });
  // Every explicit surface switch hands the one right-hand panel over with
  // the same setters; spread into the hooks that open a surface.
  const workbenchSurfaceSetters = {
    closeSpecialUtilityPanels,
    setArtifactsOpen,
    setShowResearch,
    setShowAgentPlan,
    setShowResearchHistory,
    setAgentWorkbenchManuallyOpened,
    setAgentWorkbenchTab,
    setAgentWorkbenchTabTouched,
  };
  const workbenchFocus = useWorkbenchFocusState({
    threadId,
    ...workbenchSurfaceSetters,
  });
  const {
    focusedWorkbenchAgentId,
    focusedWorkbenchAgentView,
    focusedWorkbenchAgentSnapshot,
    focusedWorkbenchTurnIndex,
    focusedWorkbenchAgentNonce,
    focusedWorkbenchEventId,
    focusedWorkbenchEventKind,
    focusedWorkbenchEventView,
    focusedWorkbenchEventNonce,
    focusedWorkbenchProcessEvent,
    focusedWorkbenchEffectKey,
  } = workbenchFocus;
  const routeState = (location.state as ThreadRouteState | null) ?? null;
  const isProjectHomeThread = Boolean(
    threadIdentityQuery.data?.metadata?.["project_home"] ||
    threadIdentityQuery.data?.values?.["project_home"],
  );
  useProjectWorkbenchRouteOpen({
    threadId,
    isNewThread,
    openProjectWorkbench: routeState?.openProjectWorkbench,
    isProjectHomeThread,
    boundProjectData: boundProjectQuery.data,
    ...workbenchSurfaceSetters,
  });
  const params = useParams<{ agentName?: string }>();
  const qc = useQueryClient();
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const {
    embeddedDesignChat,
    embeddedDesignProject,
    embeddedCreationSpace,
    embeddedCreativeProject,
    embeddedDesignStageNodeId,
    embeddedDesignParentOrigin,
    embeddedDesignContext,
    designCapabilities,
  } = useEmbeddedDesignChat({
    searchParams,
    designCapabilitiesMetadata:
      threadIdentityQuery.data?.metadata?.design_capabilities,
    setProjectAgentMode,
  });
  const {
    initialPrompt,
    privateConversation,
    queryAgentName,
    routeAgentName,
    isAgentRoute,
    isRealtimeRoute,
    memoryMode,
    activeAgentId,
    activeAgent,
    hintedWorkspacePath,
    resolvedThreadOwnerAgentId,
    legacyOnDemandThreadOwnerId,
    allowThreadFork,
  } = useRealtimeAgentRoute({
    searchParams,
    agentNameParam: params.agentName,
    pathname: location.pathname,
    isNewThread,
    routeState,
    threadIdentityData: threadIdentityQuery.data,
  });
  // 「助手」侧栏入口使用固定的 echo-assistant 持久会话（见
  // workspace-sidebar 的 ECHO_THREAD_ID）。历史上该线程可能因
  // 创建时选中的 agent 而写入 general 等身份，这里在渲染层强制归位
  // 为 echo，避免助手页面被解析成别的 agent；发送层 agent_name
  // 同源修正存量数据。
  const effectiveAgentId = isNewThread
    ? activeAgentId
    : (threadId === "echo-assistant"
        ? "echo"
        : resolvedThreadOwnerAgentId) || activeAgentId;

  // A bound project owns the right-hand surface. Otherwise the persona's
  // preset is the default, with the user's last manual tab remembered per
  // persona. Runtime focus events still take precedence by marking the tab as
  // touched before this passive defaulting effect can run.
  useEffect(() => {
    if (boundProjectQuery.isPending || agentWorkbenchTabTouched) return;
    setAgentWorkbenchTab(
      preferredWorkbenchTab(effectiveAgentId, Boolean(boundProjectQuery.data)),
    );
  }, [
    agentWorkbenchTabTouched,
    boundProjectQuery.data,
    boundProjectQuery.isPending,
    effectiveAgentId,
    setAgentWorkbenchTab,
    threadId,
  ]);
  const {
    isEchoAssistant,
    displayAgent,
    currentTaskAgentName,
    composerDisplayAgent,
  } = useRealtimeDisplayAgent({
    effectiveAgentId,
    activeAgentId,
    activeAgent,
    resolvedThreadOwnerAgentId,
  });
  const connectedChannels = useEchoAssistantChannels(isEchoAssistant);
  const {
    selectedCollaborators,
    coworkCollaborationProfiles,
    savedCollaborationRoster,
    persistedCollaboratorIds,
    persistedCollaboratorKey,
    savedCollaborationMode,
  } = usePersistedCollaborationRoster({
    allTaskCollaboratorAgents,
    selectedCollaboratorIds,
    threadIdentityQuery,
    currentTaskAgentName,
    composerDisplayAgent,
    collabSessionQuery,
    coworkGroupQuery,
  });
  const collaboratorSelectionRefs = {
    collaboratorSelectionTouchedRef,
    responseModeIntentTouchedRef,
    setSelectedCollaboratorIds,
    setTeamModeIntent,
  };
  const { applyTaskCollaboratorPreset, handleWelcomeTeamLoaded } =
    useTaskCollaboratorPresets({
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
      setCollaboratorPickerOpen,
      ...collaboratorSelectionRefs,
    });
  const { membershipNotice, setMembershipNotice } = useCoworkRosterSync({
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
    pendingRosterModeRef,
    lastCoworkSyncSignatureRef,
    ...collaboratorSelectionRefs,
  });
  const { handleSelectedCollaboratorIdsChange, handleTeamModeIntentChange } =
    useCollaboratorSelectionHandlers({
      currentTaskAgentName,
      persistedCollaboratorIds,
      savedCollaborationMode,
      pendingRosterModeRef,
      ...collaboratorSelectionRefs,
    });
  const {
    collaborationRoster,
    collaborationEnabled,
    visibleCollaborationRoster,
    messageAgentRoster,
    visibleCollaborationEnabled,
    isGroupConversation,
    collaborationRosterSeats,
  } = useCollaborationRoster({
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
  });
  const {
    setGroupPerspectiveAgentId,
    groupPerspectiveAgentIds,
    mainPerspectiveAgentId,
    perspectiveDisplayAgent,
    perspectiveComposerAgent,
  } = useGroupPerspective({
    threadId,
    isGroupConversation,
    visibleCollaborationRoster,
    activeAgentId,
    effectiveAgentId,
    displayAgent,
  });
  const {
    collaborationTeamName,
    currentInviteActor,
    currentRoomParticipant,
    canManageHumanInvites,
    canWriteConversation,
    realtimeRoomParticipant,
    realtimeParticipantId,
    realtimeParticipantName,
  } = useCollaborationParticipant({
    boundProjectQuery,
    threadIdentityQuery,
    collabSessionQuery,
    initialPrompt,
    user,
    t,
  });
  const [replyTarget, setReplyTarget] = useState<CoworkRoomMessage | null>(
    null,
  );
  const projectCapabilityAction = resolveGroupProjectCapabilityAction({
    isNewThread,
    isGroupConversation,
    hasBoundProject: Boolean(boundProjectQuery.data),
    canManageGroup: canManageHumanInvites,
  });
  const canPromoteGroupToProject = projectCapabilityAction === "create";
  const collaborationContext = useMemo(
    () =>
      buildCollaborationTurnContext({
        collaborationEnabled,
        collaborationRoster,
        collaborationTeamName,
        effectiveAgentId,
        selectedCollaborators,
        t,
        teamModeIntent,
        threadId,
        replyTarget,
      }),
    [
      collaborationEnabled,
      collaborationRoster,
      collaborationTeamName,
      effectiveAgentId,
      selectedCollaborators,
      t,
      teamModeIntent,
      threadId,
      replyTarget,
    ],
  );
  const {
    collaborationRoomMemberPayload,
    collaborationRoomSignature,
    resolvedHumanInviteRoomId,
    ensureHumanInviteRoom,
    handleOpenHumanInvite,
  } = useHumanInviteRoom({
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
    pathname: location.pathname,
    search: location.search,
  });
  useCanonicalCollabRoom({
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
  });
  const effectiveReasoningEffort = normalizeReasoningEffortForUi(
    settings.context.reasoning_effort,
  );
  const {
    effectiveWorkDir,
    projectWorkspacePath,
    personalWorkspacePath,
    isProjectCodeMode,
  } = resolveWorkspaceScope({
    ...threadQueryScope,
    isPending: threadWorkspaceQuery.isPending,
    hintedWorkspacePath,
    workDir,
    personalSpaceRoot: settings.personal_space.default_folder,
    embeddedDesignChat,
    embeddedCreationSpace,
    perspectiveDisplayAgent,
    mainPerspectiveAgentId,
  });
  const {
    isCodingWorkspaceMode,
    codeModeUnlocked,
    projectSignals,
    projectModePreset,
    activeGroupTaskContext,
    effectiveMode,
    streamMode,
  } = useConversationMode({
    isProjectCodeMode,
    projectWorkspacePath,
    projectDetection,
    projectAgentMode,
    groupTaskStrategy,
    effectiveAgentId,
    isEchoAssistant,
    routeMode: settings.context.mode,
    isAgentRoute,
    isRealtimeRoute,
    collaborationEnabled,
  });
  const [workLocation, setWorkLocation] = useThreadWorkLocation(threadId);
  const executionSelection = useExecutionEngine({
    threadId,
    parentThreadId:
      firstString(threadIdentityQuery.data?.metadata?.parent_thread_id) ||
      undefined,
    principal: user?.actor_id || user?.user_id || "local",
    roleBackend: perspectiveDisplayAgent?.capabilities?.execution_backend,
    // General/Design and directory scope do not determine task intent.
    // Automatic selection is resolved by the host from the submitted request.
    codingTask: false,
    orchestrated: collaborationEnabled,
    nativeTopology: collaborationEnabled && teamModeIntent === "cluster",
    enabled: !embeddedDesignChat && !authLoading,
  });
  const selectedExecutionEngine = executionSelection.engine;
  const executionEnginePreference = executionSelection.preference;
  const rememberExecutionEngineForThread = executionSelection.rememberForThread;
  const {
    threadRouteFor,
    markSidebarThreadRunning,
    clearSidebarThreadStatus,
    newThreadRouteForMode,
  } = useThreadRouting({
    activeAgentId,
    embeddedDesignChat,
    embeddedDesignProject,
    embeddedCreationSpace,
    embeddedCreativeProject,
    embeddedDesignParentOrigin,
  });
  const openWorkDirInNewTask = useWorkDirSelection({
    isNewThread,
    effectiveAgentId,
    effectiveWorkDir,
    hintedWorkspacePath,
    handleWorkDirChange,
  });

  // ── Agent-switch refresh ───────────────────────────────────
  // When the user picks a different agent in the footer dropdown while
  // looking at an existing thread, we need to:
  //   1. Leave the stale conversation window (it belonged to the old
  //      agent · showing its messages while the new agent answers the
  //      next turn is confusing and mixes personas).
  //   2. Invalidate the thread-list query so the sidebar re-fetches the
  //      new agent's threads (metadata.agent filter changed).
  // Skip the navigate+invalidate on the FIRST observed value (page
  // mount) — only react to actual changes.
  const [composerSeed, setComposerSeed] = useState(initialPrompt);
  useHistoryDraft(threadId, setComposerSeed);
  const boundProjectState: ProjectFullState | null | undefined =
    boundProjectQuery.data;
  const openProjectWorkbenchForEntity = useProjectWorkbenchOpener({
    boundProjectState,
    ...workbenchSurfaceSetters,
  });
  const handleDetachProjectCapability = useProjectCapabilityDetach({
    threadId,
    isNewThread,
    t,
    boundProjectQuery,
    boundProjectState,
    canManageHumanInvites,
    confirmProjectDetach,
    detachProjectFromGroupMutation,
    setAgentWorkbenchTab,
    setAgentWorkbenchManuallyOpened,
  });
  const {
    projectMilestoneOptions,
    defaultProjectMilestoneId,
    projectMessageActions,
  } = useProjectMessageActions({
    threadId,
    isNewThread,
    boundProjectQuery,
    boundProjectState,
    collabSessionQuery,
    currentInviteActor,
    currentRoomParticipant,
    collaborationRoomMemberPayload,
    collaborationTeamName,
    effectiveAgentId,
    teamModeIntent,
    ensureCollabRoomMutation,
    postCollabRoomMessageMutation,
    applyRoomMessageProjectActionMutation,
    openProjectWorkbenchForEntity,
  });
  const roomTimelineMessageActions = useRoomTimelineMessageActions({
    threadId,
    canWriteConversation,
    boundProjectQuery,
    boundProjectState,
    collabSessionQuery,
    projectMilestoneOptions,
    defaultProjectMilestoneId,
    openProjectWorkbenchForEntity,
    setReplyTarget,
    setComposerSeed,
  });
  const { stageRoute: stageThreadRoute, commitRoute: commitThreadRoute } =
    useDeferredRouteCommit();
  useEffect(() => {
    if (initialPrompt) setComposerSeed(initialPrompt);
  }, [initialPrompt]);
  useActiveAgentSync({
    isNewThread,
    routeAgentName,
    queryAgentName,
    privateConversation,
    activeAgentId,
    effectiveAgentId,
    isGroupConversation,
    mainPerspectiveAgentId,
    memoryMode,
    settings,
    setSettings,
    applyTaskCollaboratorPreset,
    navigate,
    qc,
  });

  useEvent(
    "agent:changed",
    ({ name, source }) => {
      // thread: 由当前 thread owner 驱动的同步，不导航
      // system: 由 URL/路由驱动的同步（页面首次加载、query 变化），不导航
      if (source === "thread" || source === "system") return;
      // In a group, role switching is a first-person viewpoint change inside
      // the same canonical conversation. Do not turn it into a new task or
      // throw the user out of the room; only the main-role context changes.
      if (isGroupConversation && groupPerspectiveAgentIds.has(name)) {
        setGroupPerspectiveAgentId(name);
        return;
      }
      if (!name || name === activeAgentId) return;
      qc.invalidateQueries({ queryKey: ["threads", "search"] });
      navigate(taskWorkspaceRoute({ agentId: name }), { replace: false });
    },
    [
      activeAgentId,
      groupPerspectiveAgentIds,
      isGroupConversation,
      navigate,
      qc,
    ],
  );

  const streamOptions = useMemo<ThreadStreamOptions>(
    () => ({
      threadId,
      context: buildRealtimeStreamContext({
        settingsContext: settings.context,
        customInstructions: settings.personal_space.custom_instructions,
        effectiveReasoningEffort,
        streamMode,
        effectiveMode,
        isProjectCodeMode,
        isCodingWorkspaceMode,
        projectWorkspacePath,
        personalWorkspacePath,
        projectAgentMode,
        projectModePreset,
        projectSignals,
        designCapabilities,
        embeddedDesignChat,
        embeddedDesignContext,
        executionEnginePreference,
        selectedExecutionEngine,
        automationTarget,
        collaborationContext,
        isGroupConversation,
        activeGroupTaskContext,
        privateConversation,
        mainPerspectiveAgentId,
        workLocation,
      }),
      onStart: (startedThreadId) => {
        rememberExecutionEngineForThread(startedThreadId);
        if (startedThreadId !== threadId) {
          clearSidebarThreadStatus(threadId);
        }
        markSidebarThreadRunning(startedThreadId);
        localStartedThreadIdRef.current = startedThreadId;
        setIsNewThread(false);
        const targetPath = threadRouteFor(startedThreadId);
        // The live page deliberately stays mounted until the turn settles, so
        // React Router cannot own this transition yet. Keep sidebar selection
        // and its thread list in sync with the server-issued id immediately.
        eventBus.emit("thread:route-sync", {
          href: targetPath,
          threadId: startedThreadId,
        });
        void qc.invalidateQueries({ queryKey: ["threads", "search"] });
        // Keep the /new route mounted for the lifetime of the first turn.
        // Changing the hash here still notifies the desktop HashRouter and
        // tears down its WebSocket, even when history.replaceState is used.
        // The sidebar already follows thread:route-sync; commit the actual URL
        // once onFinish confirms that the server-owned turn is terminal.
        stageThreadRoute(targetPath);
      },
      onFinish: () => {
        // Drop the locally-started marker once the turn is terminal. It exists
        // only to keep identity/workspace queries paused during the first turn
        // (the server-issued id may not be queryable yet); leaving it set would
        // permanently disable threadIdentityQuery, pinning the header/browser
        // title to "未命名" on every thread the user has messaged this session.
        localStartedThreadIdRef.current = null;
        void qc.invalidateQueries({ queryKey: ["threads", "search"] });
        commitThreadRoute();
      },
    }),
    [
      activeGroupTaskContext,
      automationTarget,
      clearSidebarThreadStatus,
      collaborationContext,
      privateConversation,
      commitThreadRoute,
      embeddedDesignChat,
      embeddedDesignContext,
      designCapabilities,
      mainPerspectiveAgentId,
      effectiveMode,
      effectiveReasoningEffort,
      isCodingWorkspaceMode,
      isGroupConversation,
      isProjectCodeMode,
      markSidebarThreadRunning,
      personalWorkspacePath,
      projectAgentMode,
      projectModePreset,
      projectSignals,
      projectWorkspacePath,
      qc,
      selectedExecutionEngine,
      executionEnginePreference,
      rememberExecutionEngineForThread,
      setIsNewThread,
      settings.context,
      settings.personal_space.custom_instructions,
      stageThreadRoute,
      streamMode,
      threadId,
      threadRouteFor,
      workLocation,
    ],
  );
  const [
    thread,
    sendMessage,
    isUploading,
    allToolEvents,
    lastTurnToolEvents,
    realtimeApprovals,
  ] = useThreadStream(streamOptions);
  const { modelSwitchTimelineEntries, handleModelSwitchNotice } =
    useModelSwitchTimeline({
      threadId,
      isNewThread,
      messageCount: thread.messages.length,
    });
  const conversationTimelineEntries = useConversationTimelineEntries({
    collabSessionQuery,
    loadedItemIds: realtimeApprovals.loadedItemIds,
    messages: thread.messages,
    currentInviteActor,
    roomTimelineMessageActions,
    openProjectWorkbenchForEntity,
    modelSwitchTimelineEntries,
  });
  const {
    isCompressingContext,
    maxContextTokens,
    contextTokens,
    contextSegments,
    handleCompressContext,
  } = useContextWindow({
    threadId,
    thread,
    models,
    modelName: settings.context.model_name,
    t,
  });

  useNewThreadRoutePromotion({
    threadId,
    isNewThread,
    persistedMessageCount: thread.values.messages.length,
    isLoading: thread.isLoading,
    setIsNewThread,
    threadRouteFor,
    stageThreadRoute,
    commitThreadRoute,
  });

  useRegenerateHandler(thread, sendMessage, threadId);
  usePlanActionHandler(sendMessage, threadId);

  const { pendingNetworkRegen, handleAuthorizeNetwork } =
    useNetworkAuthorizationRegen({ threadId, settings, setSettings });

  const {
    previewBlocks,
    lastTurnMessages,
    lastTurnUserInput,
    resultPreviewUrl,
    progressOutline,
  } = useLastTurnView(thread.messages);
  const {
    agentDisplayEvents,
    workbenchDisplayEvents,
    latestWorkspaceFocusTab,
    replayBlocks,
    handleExportReplay,
    latestArtifactFocusPath,
  } = useAgentDisplayEvents({
    thread,
    lastTurnToolEvents,
    allToolEvents,
    lastTurnMessages,
    focusedWorkbenchTurnIndex,
    initialPrompt,
    t,
  });
  const isAgentWorkflowMode =
    effectiveMode === "deep" ||
    effectiveMode === "react" ||
    effectiveMode === "code";
  const tasks = useTasks("all");
  const latestAutomationEvent = useObservedAutomationTarget({
    lastTurnToolEvents,
    embeddedDesignChat,
    isLoading: thread.isLoading,
    setAutomationTarget,
  });
  const {
    hasPausedOrPendingBackgroundTask,
    hasReportArtifact,
    finalArtifactEntries,
    hasFinalArtifact,
    agentRunInterrupted,
    agentRunBlocked,
    agentRunSettled,
    hasCompletedAgentOutput,
    agentRunFailed,
    sidebarRunState,
  } = useAgentRunState({
    threadId,
    isLoading: thread.isLoading,
    error: thread.error,
    streamingMessage: thread.streamingMessage,
    lastTurnToolEvents,
    agentDisplayEvents,
    lastTurnMessages,
    tasksData: tasks.data,
  });
  const sidebarThreadId =
    thread.threadId ?? localStartedThreadIdRef.current ?? threadId;
  useDesignThreadBridge({
    embeddedDesignChat,
    embeddedDesignParentOrigin,
    embeddedDesignStageNodeId,
    sidebarThreadId,
    agentRunInterrupted,
    agentRunFailed,
    hasCompletedAgentOutput,
    sidebarRunState,
    lastTurnMessages,
    threadTitle: thread.values?.title,
    resultPreviewUrl,
    finalArtifactEntries,
  });
  useSidebarRunStatus({
    sidebarThreadId,
    threadRouteFor,
    sidebarRunState,
    agentRunSettled,
    agentRunFailed,
    hasCompletedAgentOutput,
    streaming: Boolean(thread.streamingMessage),
  });
  const {
    hasRenderableAgentWorkbench,
    canOpenAgentWorkbench,
    durableCollaborationEnabled,
    showAgentWorkbench,
    artifactCount,
    settledWorkbenchTurnKey,
    hasCurrentTurnAgentResponse,
  } = useWorkbenchAvailability({
    threadId,
    isNewThread,
    embeddedDesignChat,
    isAgentWorkflowMode,
    isCodingWorkspaceMode,
    isRealtimeRoute,
    collaborationEnabled,
    boundProjectData: boundProjectQuery.data,
    agentDisplayEvents,
    hasCompletedAgentOutput,
    agentRunSettled,
    agentRunFailed,
    hasPausedOrPendingBackgroundTask,
    previewBlocks,
    agentWorkbenchManuallyOpened,
    showResearchHistory,
    showResearch,
    researchJob,
    researchError,
    artifacts,
    messages: thread.messages,
    lastTurnMessages,
  });
  useWorkbenchAutoBehaviour({
    isNewThread,
    isLoading: thread.isLoading,
    canOpenAgentWorkbench,
    hasRenderableAgentWorkbench,
    durableCollaborationEnabled,
    showAgentWorkbench,
    agentWorkbenchManuallyOpened,
    agentWorkbenchTabTouched,
    agentWorkbenchTab,
    agentRunSettled,
    hasCurrentTurnAgentResponse,
    settledWorkbenchTurnKey,
    artifacts,
    artifactCount,
    artifactsOpen,
    showAgentPlan,
    previewBlocks,
    resultPreviewUrl,
    latestWorkspaceFocusTab,
    latestArtifactFocusPath,
    selectArtifact,
    ...workbenchSurfaceSetters,
  });

  const {
    handleAcceptModeIntent,
    handleProjectAgentModeStateChange,
    handleProjectAgentModeUserChange,
    handleDismissModeIntent,
  } = useProjectAgentModeHandlers({
    threadId,
    sidebarThreadId,
    isNewThread,
    t,
    navigate,
    embeddedDesignChat,
    embeddedDesignParentOrigin,
    effectiveWorkDir,
    boundProjectState,
    projectAgentMode,
    modeManualOverride,
    setProjectAgentMode,
    setModeManualOverride,
    setModeIntentSuggestion,
  });

  const handleSubmit = useRealtimeSubmit({
    threadId,
    t,
    navigate,
    settings,
    threadIdentityQuery,
    messages: thread.messages,
    readyForMutations: thread.readyForMutations,
    canWriteConversation,
    sendMessage,
    markSidebarThreadRunning,
    activeAgentId,
    legacyOnDemandThreadOwnerId,
    isEchoAssistant,
    isGroupConversation,
    isCodingWorkspaceMode,
    projectAgentMode,
    modeManualOverride,
    setProjectAgentMode,
    setModeIntentSuggestion,
    setGroupTaskStrategy,
    setReplyTarget,
  });
  const turnSenderInput = {
    threadId,
    isLoading: thread.isLoading,
    readyForMutations: thread.readyForMutations,
    sendMessage,
    markSidebarThreadRunning,
  };
  usePendingNewSessionSend({ ...turnSenderInput, isNewThread });
  const { handleSendFollowUp, handleRetryTask } =
    useDirectTurnSenders(turnSenderInput);
  const {
    handleModeChange,
    handleModelChange,
    handleReasoningEffortChange,
    handlePermissionModeChange,
  } = useComposerSettingsHandlers({
    settings,
    setSettings,
    effectiveMode,
    isAgentRoute,
    isCodingWorkspaceMode,
    navigate,
    newThreadRouteForMode,
  });

  const handleDeepResearch = useDeepResearchLauncher({
    threadId,
    activeThreadIdRef,
    researchOperationRef,
    effectiveAgentId,
    researchLoading,
    readyForMutations: thread.readyForMutations,
    closeSpecialUtilityPanels,
    setResearchJob,
    setResearchLoading,
    setResearchError,
    setShowResearch,
    setShowAgentPlan,
    setShowResearchHistory,
  });

  const { stop: handleStop, isStopping } = useRealtimeStopController({
    threadId,
    t,
    tasks,
    stopThread: thread.stop,
    isLoading: thread.isLoading,
  });

  const {
    hasResearchPanel,
    activeRightPanel,
    openAgentPanel,
    openArtifactsPanel,
    openWorkbenchArtifact,
  } = useWorkbenchPanelOpeners({
    ...workbenchFocus,
    ...workbenchSurfaceSetters,
    threadId,
    isEchoAssistant,
    showResearch,
    researchJob,
    researchError,
    showTeachRepeatPanel,
    showAutomationPanel,
    showResearchHistory,
    artifactsOpen,
    showAgentPlan,
    showAgentWorkbench,
    agentWorkbenchTab,
    artifacts,
    setArtifacts,
    selectArtifact,
  });
  const openFinalArtifactPanel = useArtifactOpenRequests({
    openWorkbenchArtifact,
    finalArtifactEntries,
  });
  const {
    openAgentPlanPanel,
    openPreviewPanel,
    openResearchPanel,
    openResearchHistoryPanel,
    closeAgentWorkbenchPanel,
    closeUnifiedRightPanel,
    closeRightPanel,
    selectAgentWorkbenchTab,
  } = useRightPanelSwitches({
    ...workbenchSurfaceSetters,
    effectiveAgentId,
    isEchoAssistant,
    hasResearchPanel,
    showAgentPlan,
    showAutomationPanel,
    showResearchHistory,
    showTeachRepeatPanel,
    setShowAutomationPanel,
    setShowTeachRepeatPanel,
  });

  const currentAgent = useMemo(
    () => ({
      name: mainPerspectiveAgentId,
      display_name:
        perspectiveDisplayAgent?.display_name || mainPerspectiveAgentId,
      avatar_url:
        perspectiveDisplayAgent?.avatar_url ||
        `/api/agents/${encodeURIComponent(mainPerspectiveAgentId)}/avatar`,
      icon: perspectiveDisplayAgent?.icon || null,
      execution_engine: selectedExecutionEngine,
    }),
    [mainPerspectiveAgentId, perspectiveDisplayAgent, selectedExecutionEngine],
  );

  const handleOpenDiff = useCallback(() => {
    setAgentWorkbenchManuallyOpened(true);
    setAgentWorkbenchTab("diff");
    setAgentWorkbenchTabTouched(true);
  }, [
    setAgentWorkbenchManuallyOpened,
    setAgentWorkbenchTab,
    setAgentWorkbenchTabTouched,
  ]);

  const welcomeTeamId = searchParams.get("welcome_team");
  const headerMemberControl =
    !privateConversation && !isEchoAssistant && canManageHumanInvites ? (
      <RealtimeHeaderMemberControl
        threadId={threadId}
        isNewThread={isNewThread}
        embeddedDesignChat={embeddedDesignChat}
        allTaskCollaboratorAgents={allTaskCollaboratorAgents}
        selectedCollaborators={selectedCollaborators}
        selectedCollaboratorIds={selectedCollaboratorIds}
        currentTaskAgentName={currentTaskAgentName}
        teamModeIntent={teamModeIntent}
        collaboratorPickerOpen={collaboratorPickerOpen}
        setCollaboratorPickerOpen={setCollaboratorPickerOpen}
        handleSelectedCollaboratorIdsChange={handleSelectedCollaboratorIdsChange}
        handleTeamModeIntentChange={handleTeamModeIntentChange}
        visibleCollaborationRoster={visibleCollaborationRoster}
        lastTurnToolEvents={lastTurnToolEvents}
        coworkCollaborationProfiles={coworkCollaborationProfiles}
        collabSession={collabSessionQuery.data}
        resolvedHumanInviteRoomId={resolvedHumanInviteRoomId}
        ensureHumanInviteRoom={ensureHumanInviteRoom}
        setHumanInviteRoomId={setHumanInviteRoomId}
        humanInviteDialogOpen={humanInviteDialogOpen}
        setHumanInviteDialogOpen={setHumanInviteDialogOpen}
        isEnsuringRoom={ensureCollabRoomMutation.isPending}
        isSavingRoster={replaceCoworkRosterMutation.isPending}
      />
    ) : undefined;

  return (
    <SubtasksProvider>
      {resolvedHumanInviteRoomId && (
        <InviteDialog
          open={humanInviteDialogOpen}
          onOpenChange={setHumanInviteDialogOpen}
          roomId={resolvedHumanInviteRoomId}
          threadId={threadId}
        />
      )}
      <ThreadProviders thread={thread} isMock={false}>
        <FileReferenceScope.Provider value={{ threadId: isNewThread ? undefined : threadId, basePath: effectiveWorkDir || personalWorkspacePath }}>
        {!embeddedDesignChat && <AutomationPreviewHost threadId={threadId} />}
        <ToolEffectsProvider
          enabled={
            !isNewThread && canAccessGlobalControlPlane(authStatus, user)
          }
          active={thread.isLoading}
        >
          <CollaborationRealtimeBridge
            canWrite={canWriteConversation}
            roomId={collabSessionQuery.data?.room_id}
            threadId={isNewThread ? null : threadId}
            participantId={realtimeParticipantId}
            displayName={realtimeParticipantName}
            avatar={
              typeof realtimeRoomParticipant?.avatar_url === "string"
                ? realtimeRoomParticipant.avatar_url
                : null
            }
          >
            <ChatBox artifactPanelMode="external" threadId={threadId}>
              <ChatPageLayout
                composerNeedsAttention={
                  realtimeApprovals.pendingApprovals.length > 0
                }
                layoutKey={threadId}
                isNewThread={isNewThread}
                pageTitle={
                  headerThreadTitle ||
                  thread?.values?.title ||
                  boundProjectState?.project.name ||
                  initialPrompt ||
                  (isNewThread ? t.sidebar.actionNewTask : "Echo")
                }
                header={
                  <RealtimeChatHeader
                    threadId={threadId}
                    thread={thread}
                    isNewThread={isNewThread}
                    embeddedDesignChat={embeddedDesignChat}
                    isEchoAssistant={isEchoAssistant}
                    privateConversation={privateConversation}
                    isGroupConversation={isGroupConversation}
                    perspectiveDisplayAgent={perspectiveDisplayAgent}
                    mainPerspectiveAgentId={mainPerspectiveAgentId}
                    headerThreadTitle={headerThreadTitle}
                    initialPrompt={initialPrompt}
                    collaborationTeamName={collaborationTeamName}
                    headerMemberControl={headerMemberControl}
                    headerProjectStatus={
                      !embeddedDesignChat && boundProjectState ? (
                        <RealtimeProjectStatusBadge
                          boundProjectState={boundProjectState}
                          defaultProjectMilestoneId={defaultProjectMilestoneId}
                          canManageHumanInvites={canManageHumanInvites}
                          isDetaching={detachProjectFromGroupMutation.isPending}
                          openProjectWorkbenchForEntity={openProjectWorkbenchForEntity}
                          handleDetachProjectCapability={handleDetachProjectCapability}
                        />
                      ) : null
                    }
                    rightPanelMenu={
                      <RightPanelMenu
                        activePage={activeRightPanel}
                        artifactCount={artifactCount}
                        hasAgentWorkbench={canOpenAgentWorkbench}
                        hasPlan={hasRenderableAgentWorkbench}
                        hasPreview={!!previewBlocks}
                        hasResearch={!!researchJob || !!researchError}
                        hasResearchHistory={!!researchJob || !!researchError}
                        onClosePanel={closeRightPanel}
                        onOpenAgent={openAgentPanel}
                        onOpenArtifacts={openArtifactsPanel}
                        onOpenPlan={openAgentPlanPanel}
                        onOpenPreview={openPreviewPanel}
                        onOpenResearch={openResearchPanel}
                        onOpenResearchHistory={openResearchHistoryPanel}
                      />
                    }
                    activeRightPanel={activeRightPanel}
                    recorderPluginEnabled={recorderPluginEnabled}
                    recIsRecording={recIsRecording}
                    setRecOverlayOpen={setRecOverlayOpen}
                    setChatsDrawerOpen={setChatsDrawerOpen}
                    boundProjectState={boundProjectState}
                    boundProjectQuery={boundProjectQuery}
                    openProjectWorkbenchForEntity={openProjectWorkbenchForEntity}
                    canPromoteGroupToProject={canPromoteGroupToProject}
                    promoteGroupDialogOpen={promoteGroupDialogOpen}
                    setPromoteGroupDialogOpen={setPromoteGroupDialogOpen}
                    projectDetachDialog={projectDetachDialog}
                    replayBlocks={replayBlocks}
                    handleExportReplay={handleExportReplay}
                    isProjectCodeMode={isProjectCodeMode}
                    effectiveWorkDir={effectiveWorkDir}
                    agentDisplayEvents={agentDisplayEvents}
                    lastTurnUserInput={lastTurnUserInput}
                    onOpenDiff={handleOpenDiff}
                    openWorkbenchArtifact={openWorkbenchArtifact}
                    connectedChannels={connectedChannels}
                    showAutomationPanel={showAutomationPanel}
                    toggleAutomationPanel={toggleAutomationPanel}
                  />
                }
                headerClassName={
                  embeddedDesignChat
                    ? "px-3"
                    : !isEchoAssistant
                      ? "md:pl-3"
                      : undefined
                }
                messageList={
                  <MessageList
                    key={threadId}
                    className="size-full"
                    threadId={threadId}
                    thread={thread}
                    showResumeSkeleton={!isNewThread}
                    onStop={handleStop}
                    isStopping={isStopping}
                    onOpenArtifact={openWorkbenchArtifact}
                    project={projectWorkspacePath || null}
                    onSendFollowUp={handleSendFollowUp}
                    onRetryTask={handleRetryTask}
                    onAuthorizeNetwork={handleAuthorizeNetwork}
                    authorizingNetworkTier={
                      pendingNetworkRegen?.threadId === threadId
                        ? pendingNetworkRegen.tier
                        : null
                    }
                    header={
                      welcomeTeamId && !isNewThread ? <TeamWelcomeCard teamId={welcomeTeamId} onLoaded={handleWelcomeTeamLoaded} /> : realtimeApprovals.hasMoreTurns ? (
                        <LoadOlderTurnsBanner
                          onLoad={realtimeApprovals.loadOlderTurns}
                        />
                      ) : null
                    }
                    emptyState={
                      !realtimeApprovals.hasMoreTurns &&
                      !isNewThread &&
                      !thread.isThreadLoading &&
                      !thread.isLoading ? (
                        <ConversationEmptyState
                          isGroupConversation={isGroupConversation}
                          hasError={Boolean(thread.error)}
                          onRetry={() => {
                            void thread.refresh();
                          }}
                        />
                      ) : null
                    }
                    paddingBottom={MESSAGE_LIST_DEFAULT_PADDING_BOTTOM}
                    mode={effectiveMode}
                    liveToolEvents={
                      embeddedDesignChat ? [] : lastTurnToolEvents
                    }
                    lastTurnToolEvents={
                      embeddedDesignChat ? [] : lastTurnToolEvents
                    }
                    allToolEvents={embeddedDesignChat ? [] : allToolEvents}
                    completedAgentOutput={hasCompletedAgentOutput}
                    currentAgent={currentAgent}
                    agentRoster={
                      visibleCollaborationEnabled
                        ? messageAgentRoster
                        : undefined
                    }
                    showSenderName={
                      !embeddedDesignChat &&
                      (visibleCollaborationEnabled ||
                        Boolean(collabSessionQuery.data?.room_id) ||
                        isProjectHomeThread)
                    }
                    projectMessageActions={projectMessageActions}
                    allowThreadFork={allowThreadFork}
                    timelineEntries={conversationTimelineEntries}
                    footer={
                      <>
                        <TaskDeliveryReview events={lastTurnToolEvents} running={thread.isLoading} />
                        <ProjectProposalNotice threadId={threadId} busy={thread.isLoading || !thread.readyForMutations} onReview={handleSendFollowUp} />
                        {hasCompletedAgentOutput &&
                        hasFinalArtifact &&
                        !hasReportArtifact ? (
                          <FinalArtifactCompletionNotice
                            entries={finalArtifactEntries}
                            onOpen={openFinalArtifactPanel}
                          />
                        ) : null}
                      </>
                    }
                  />
                }
                inputArea={
                  <RealtimeComposerArea
                    threadId={threadId}
                    thread={thread}
                    isNewThread={isNewThread}
                    mounted={mounted}
                    membershipNotice={membershipNotice}
                    setMembershipNotice={setMembershipNotice}
                    selectedCollaborators={selectedCollaborators}
                    welcomeTeamId={welcomeTeamId}
                    handleWelcomeTeamLoaded={handleWelcomeTeamLoaded}
                    perspectiveDisplayAgent={perspectiveDisplayAgent}
                    mainPerspectiveAgentId={mainPerspectiveAgentId}
                    agentDisplayEvents={agentDisplayEvents}
                    hasCompletedAgentOutput={hasCompletedAgentOutput}
                    agentRunSettled={agentRunSettled}
                    agentRunFailed={agentRunFailed}
                    hasPausedOrPendingBackgroundTask={hasPausedOrPendingBackgroundTask}
                    realtimeApprovals={realtimeApprovals}
                    hasPersistedCollaboration={hasPersistedCollaboration}
                    collabRoster={collabSessionQuery.data?.roster}
                    allTaskCollaboratorAgents={allTaskCollaboratorAgents}
                    automationTarget={automationTarget}
                    latestAutomationEvent={latestAutomationEvent}
                    replyTarget={replyTarget}
                    setReplyTarget={setReplyTarget}
                    modelName={settings.context.model_name}
                    selectedExecutionEngine={selectedExecutionEngine}
                    isStopping={isStopping}
                    handleSubmit={handleSubmit}
                    chatInput={
                      <RealtimeChatInput
                        threadId={threadId}
                        thread={thread}
                        t={t}
                        composerSeed={composerSeed}
                        isNewThread={isNewThread}
                        welcomeTeamId={welcomeTeamId}
                        settings={settings}
                        embeddedDesignChat={embeddedDesignChat}
                        embeddedDesignContext={embeddedDesignContext}
                        executionSelection={executionSelection}
                        selectedExecutionEngine={selectedExecutionEngine}
                        hasCompletedAgentOutput={hasCompletedAgentOutput}
                        isEchoAssistant={isEchoAssistant}
                        isGroupConversation={isGroupConversation}
                        isProjectCodeMode={isProjectCodeMode}
                        canWriteConversation={canWriteConversation}
                        researchLoading={researchLoading}
                        hasBoundProject={Boolean(boundProjectState)}
                        projectCapabilityAction={projectCapabilityAction}
                        openProjectWorkbenchForEntity={openProjectWorkbenchForEntity}
                        setPromoteGroupDialogOpen={setPromoteGroupDialogOpen}
                        recorderPluginEnabled={recorderPluginEnabled}
                        openTeachRepeatPanel={openTeachRepeatPanel}
                        visibleCollaboratorCount={visibleCollaborationRoster.length}
                        teamModeIntent={teamModeIntent}
                        handleTeamModeIntentChange={handleTeamModeIntentChange}
                        isSavingRoster={replaceCoworkRosterMutation.isPending}
                        automationTarget={automationTarget}
                        handleAutomationTargetChange={handleAutomationTargetChange}
                        workLocation={workLocation}
                        setWorkLocation={setWorkLocation}
                        projectAgentMode={projectAgentMode}
                        isStopping={isStopping}
                        handleRetryTask={handleRetryTask}
                        mode={effectiveMode}
                        reasoningEffort={effectiveReasoningEffort}
                        mentionMembers={collaborationMentionMembers}
                        groupTaskStrategy={groupTaskStrategy}
                        onGroupTaskStrategyChange={setGroupTaskStrategy}
                        workDir={effectiveWorkDir}
                        displayAgent={perspectiveComposerAgent}
                        onWorkDirChange={handleWorkDirChange}
                        onOpenWorkDirInNewTask={openWorkDirInNewTask}
                        codeModeUnlocked={codeModeUnlocked}
                        projectDetection={projectDetection}
                        onProjectAgentModeChange={
                          handleProjectAgentModeStateChange
                        }
                        onProjectAgentModeUserChange={
                          handleProjectAgentModeUserChange
                        }
                        onProjectDetectionChange={setProjectDetection}
                        onManualOverrideChange={setModeManualOverride}
                        modeIntentSuggestion={modeIntentSuggestion}
                        onAcceptModeIntent={handleAcceptModeIntent}
                        onDismissModeIntent={handleDismissModeIntent}
                        contextTokens={contextTokens}
                        maxContextTokens={maxContextTokens}
                        isCompressingContext={isCompressingContext}
                        onCompressContext={handleCompressContext}
                        contextSegments={contextSegments}
                        onModelChange={handleModelChange}
                        onModelSwitchNotice={handleModelSwitchNotice}
                        onReasoningEffortChange={
                          handleReasoningEffortChange
                        }
                        onModeChange={handleModeChange}
                        onPermissionModeChange={handlePermissionModeChange}
                        onSubmit={handleSubmit}
                        onDeepResearch={handleDeepResearch}
                        onStop={handleStop}
                        isUploading={isUploading}
                      />
                    }
                  />
                }
                secondaryPanel={
                  recorderPluginEnabled && showTeachRepeatPanel ? (
                    <RealtimeTeachRepeatSurface
                      t={t}
                      threadId={threadId}
                      setShowTeachRepeatPanel={setShowTeachRepeatPanel}
                    />
                  ) : isEchoAssistant && showAutomationPanel ? (
                    <RealtimeAutomationSurface
                      setShowAutomationPanel={setShowAutomationPanel}
                    />
                  ) : showResearchHistory ? (
                    <RealtimeResearchHistorySurface
                      activeJobId={researchJob?.job_id}
                      setResearchJob={setResearchJob}
                      setResearchError={setResearchError}
                      setShowResearch={setShowResearch}
                      setShowResearchHistory={setShowResearchHistory}
                    />
                  ) : showResearch && researchJob ? (
                    <RealtimeResearchSurface
                      researchJob={researchJob}
                      researchLoading={researchLoading}
                      researchError={researchError}
                      setShowResearch={setShowResearch}
                    />
                  ) : showResearch && researchError ? (
                    <RealtimeResearchErrorSurface
                      t={t}
                      researchError={researchError}
                      setShowResearch={setShowResearch}
                    />
                  ) : showAgentPlan ? (
                    <PlanPanel
                      className="size-full rounded-none border-0 shadow-none"
                      messages={thread.messages}
                      open
                      onClose={() => setShowAgentPlan(false)}
                    />
                  ) : showAgentWorkbench ? (
                    <RealtimeWorkbenchSurface
                      threadId={threadId}
                      thread={thread}
                      agentWorkbenchTab={agentWorkbenchTab}
                      effectiveAgentId={effectiveAgentId}
                      workbenchDisplayEvents={workbenchDisplayEvents}
                      progressOutline={progressOutline}
                      lastTurnUserInput={lastTurnUserInput}
                      focusedWorkbenchTurnIndex={focusedWorkbenchTurnIndex}
                      focusedWorkbenchAgentId={focusedWorkbenchAgentId}
                      focusedWorkbenchAgentView={focusedWorkbenchAgentView}
                      focusedWorkbenchAgentSnapshot={focusedWorkbenchAgentSnapshot}
                      focusedWorkbenchAgentNonce={focusedWorkbenchAgentNonce}
                      focusedWorkbenchEventId={focusedWorkbenchEventId}
                      focusedWorkbenchEventKind={focusedWorkbenchEventKind}
                      focusedWorkbenchEventView={focusedWorkbenchEventView}
                      focusedWorkbenchEventNonce={focusedWorkbenchEventNonce}
                      focusedWorkbenchProcessEvent={focusedWorkbenchProcessEvent}
                      focusedWorkbenchEffectKey={focusedWorkbenchEffectKey}
                      hasCompletedAgentOutput={hasCompletedAgentOutput}
                      agentRunSettled={agentRunSettled}
                      agentRunFailed={agentRunFailed}
                      agentRunInterrupted={agentRunInterrupted}
                      agentRunBlocked={agentRunBlocked}
                      hasPausedOrPendingBackgroundTask={hasPausedOrPendingBackgroundTask}
                      workDir={workDir}
                      previewBlocks={previewBlocks}
                      resultPreviewUrl={resultPreviewUrl}
                      perspectiveDisplayAgent={perspectiveDisplayAgent}
                      mainPerspectiveAgentId={mainPerspectiveAgentId}
                      contextTokens={contextTokens}
                      maxContextTokens={maxContextTokens}
                      isCompressingContext={isCompressingContext}
                      handleCompressContext={handleCompressContext}
                      collaborationRosterSeats={collaborationRosterSeats}
                      isGroupConversation={isGroupConversation}
                      collaborationTeamName={collaborationTeamName}
                      headerThreadTitle={headerThreadTitle}
                      handleRetryTask={handleRetryTask}
                      canManageHumanInvites={canManageHumanInvites}
                      handleOpenHumanInvite={handleOpenHumanInvite}
                      closeAgentWorkbenchPanel={closeAgentWorkbenchPanel}
                      selectAgentWorkbenchTab={selectAgentWorkbenchTab}
                      openWorkbenchArtifact={openWorkbenchArtifact}
                    />
                  ) : undefined
                }
                onSecondaryClose={closeUnifiedRightPanel}
                secondaryPanelWidth="min(500px, 38vw)"
              />
            </ChatBox>
          </CollaborationRealtimeBridge>
          <ChatsDrawer
            open={chatsDrawerOpen}
            onOpenChange={setChatsDrawerOpen}
          />
          {recorderPluginEnabled ? (
            <RecRecorderOverlay
              open={recOverlayOpen}
              threadId={threadId}
              defaultName={
                thread?.values?.title ||
                initialPrompt ||
                t.realtime.recorder.defaultName
              }
              initiallyRecording={recIsRecording}
              onClose={() => setRecOverlayOpen(false)}
              onRecordingChange={setRecIsRecording}
              onOpenLibrary={() => {
                setRecOverlayOpen(false);
                openTeachRepeatPanel();
              }}
            />
          ) : null}
        </ToolEffectsProvider>

        {/* 流式调试面板 */}
        <StreamingDebugger events={allToolEvents} />

        {/* 上下文压缩进度指示器 */}
        <ContextCompressionIndicator
          isCompressing={isCompressingContext}
          contextTokens={contextTokens}
          maxContextTokens={maxContextTokens}
        />
        </FileReferenceScope.Provider>
      </ThreadProviders>
    </SubtasksProvider>
  );
}
