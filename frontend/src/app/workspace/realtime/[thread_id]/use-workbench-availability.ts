import { useEffect, useMemo, useRef } from "react";

import {
  hasAgentWorkbenchContent,
  type AgentWorkbenchTabId,
  type workspaceFocusTabFromEvents,
} from "@/components/workspace/agent-workbench-panel";
import { isAIMessage, type Message } from "@/core/api/types";

import type { RealtimeToolEvents, StateSetter } from "./realtime-page-types";
import type { latestTurnPreviewBlocks } from "./realtime-turn-utils";

type PreviewBlocks = ReturnType<typeof latestTurnPreviewBlocks>;

interface WorkbenchAvailabilityInput {
  threadId: string;
  isNewThread: boolean;
  embeddedDesignChat: boolean;
  isAgentWorkflowMode: boolean;
  isCodingWorkspaceMode: boolean;
  isRealtimeRoute: boolean;
  collaborationEnabled: boolean;
  boundProjectData: unknown;
  agentDisplayEvents: RealtimeToolEvents;
  hasCompletedAgentOutput: boolean;
  agentRunSettled: boolean;
  agentRunFailed: boolean;
  hasPausedOrPendingBackgroundTask: boolean;
  previewBlocks: PreviewBlocks;
  agentWorkbenchManuallyOpened: boolean;
  showResearchHistory: boolean;
  showResearch: boolean;
  researchJob: unknown;
  researchError: string | null;
  artifacts: string[] | undefined;
  messages: Message[];
  lastTurnMessages: Message[];
}

/** Whether the agent workbench has content, may be opened, and is shown. */
export function useWorkbenchAvailability({
  threadId,
  isNewThread,
  embeddedDesignChat,
  isAgentWorkflowMode,
  isCodingWorkspaceMode,
  isRealtimeRoute,
  collaborationEnabled,
  boundProjectData,
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
  messages,
  lastTurnMessages,
}: WorkbenchAvailabilityInput) {
  const hasRenderableAgentWorkbench = useMemo(
    () =>
      isAgentWorkflowMode &&
      hasAgentWorkbenchContent(agentDisplayEvents, {
        hasAnswer: hasCompletedAgentOutput,
        runSettled: agentRunSettled,
        runFailed: agentRunFailed,
        paused: hasPausedOrPendingBackgroundTask,
      }),
    [
      agentDisplayEvents,
      agentRunFailed,
      agentRunSettled,
      hasCompletedAgentOutput,
      hasPausedOrPendingBackgroundTask,
      isAgentWorkflowMode,
    ],
  );
  const canOpenAgentWorkbench =
    !embeddedDesignChat &&
    (!isNewThread ||
      collaborationEnabled ||
      hasRenderableAgentWorkbench ||
      !!previewBlocks ||
      // Realtime keeps the right workbench available from the first turn. The
      // actual file tree still lives in the left project pane; this panel is the
      // live agent workstation and replay surface.
      isCodingWorkspaceMode ||
      isRealtimeRoute);
  const durableCollaborationEnabled =
    !embeddedDesignChat &&
    (collaborationEnabled || Boolean(boundProjectData));
  const showAgentWorkbench =
    canOpenAgentWorkbench &&
    agentWorkbenchManuallyOpened &&
    !showResearchHistory &&
    !(showResearch && (!!researchJob || !!researchError));
  const artifactCount = artifacts?.length ?? 0;
  const settledWorkbenchTurnKey = useMemo(() => {
    const latestMessage = messages[messages.length - 1];
    return `${threadId}:${latestMessage?.id ?? messages.length}`;
  }, [messages, threadId]);
  const hasCurrentTurnAgentResponse = useMemo(
    () => lastTurnMessages.some((message) => isAIMessage(message)),
    [lastTurnMessages],
  );
  return {
    hasRenderableAgentWorkbench,
    canOpenAgentWorkbench,
    durableCollaborationEnabled,
    showAgentWorkbench,
    artifactCount,
    settledWorkbenchTurnKey,
    hasCurrentTurnAgentResponse,
  };
}

interface WorkbenchAutoBehaviourInput {
  isNewThread: boolean;
  isLoading: boolean;
  canOpenAgentWorkbench: boolean;
  hasRenderableAgentWorkbench: boolean;
  durableCollaborationEnabled: boolean;
  showAgentWorkbench: boolean;
  agentWorkbenchManuallyOpened: boolean;
  agentWorkbenchTabTouched: boolean;
  agentWorkbenchTab: AgentWorkbenchTabId;
  agentRunSettled: boolean;
  hasCurrentTurnAgentResponse: boolean;
  settledWorkbenchTurnKey: string;
  artifacts: string[];
  artifactCount: number;
  artifactsOpen: boolean;
  showAgentPlan: boolean;
  previewBlocks: PreviewBlocks;
  resultPreviewUrl: string | null;
  latestWorkspaceFocusTab: ReturnType<typeof workspaceFocusTabFromEvents>;
  latestArtifactFocusPath: string | null;
  selectArtifact: (artifact: string, autoSelect?: boolean) => void;
  setArtifactsOpen: (open: boolean) => void;
  setShowResearch: (visible: boolean) => void;
  setShowAgentPlan: StateSetter<boolean>;
  setShowResearchHistory: StateSetter<boolean>;
  setAgentWorkbenchManuallyOpened: StateSetter<boolean>;
  setAgentWorkbenchTab: StateSetter<AgentWorkbenchTabId>;
  setAgentWorkbenchTabTouched: StateSetter<boolean>;
}

/**
 * System-driven workbench behaviour: close it when it cannot open, dismiss an
 * untouched empty workbench once the turn settles, and follow the tab the
 * running agent focuses.
 */
export function useWorkbenchAutoBehaviour({
  isNewThread,
  isLoading,
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
  setArtifactsOpen,
  setShowResearch,
  setShowAgentPlan,
  setShowResearchHistory,
  setAgentWorkbenchManuallyOpened,
  setAgentWorkbenchTab,
  setAgentWorkbenchTabTouched,
}: WorkbenchAutoBehaviourInput) {
  const emptyWorkbenchAutoDismissedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!canOpenAgentWorkbench) {
      setAgentWorkbenchManuallyOpened(false);
    }
    if (!hasRenderableAgentWorkbench) {
      setAgentWorkbenchTabTouched(false);
    }
  }, [
    canOpenAgentWorkbench,
    hasRenderableAgentWorkbench,
    isNewThread,
    setAgentWorkbenchManuallyOpened,
    setAgentWorkbenchTabTouched,
  ]);

  useEffect(() => {
    if (
      durableCollaborationEnabled ||
      !agentWorkbenchManuallyOpened ||
      // Never undo an explicit user action. This flag is set by the header
      // menu and artifact-link handoff; auto-dismiss is only for untouched,
      // system-opened empty workbenches.
      agentWorkbenchTabTouched ||
      isLoading ||
      !agentRunSettled ||
      !hasCurrentTurnAgentResponse ||
      hasRenderableAgentWorkbench ||
      // A user-opened artifact is valid workbench content even when this
      // historical turn has no replayable agent events. Without this guard,
      // the empty-workbench cleanup closes the panel in the same render batch
      // that a markdown Office/PDF link opens it.
      (agentWorkbenchTab === "artifacts" && artifacts.length > 0) ||
      artifactsOpen ||
      showAgentPlan ||
      previewBlocks ||
      resultPreviewUrl
    ) {
      return;
    }
    if (emptyWorkbenchAutoDismissedRef.current === settledWorkbenchTurnKey) {
      return;
    }
    emptyWorkbenchAutoDismissedRef.current = settledWorkbenchTurnKey;
    setAgentWorkbenchManuallyOpened(false);

    setAgentWorkbenchTabTouched(false);
  }, [
    agentRunSettled,
    agentWorkbenchManuallyOpened,
    agentWorkbenchTabTouched,
    artifactsOpen,
    durableCollaborationEnabled,
    hasCurrentTurnAgentResponse,
    hasRenderableAgentWorkbench,
    agentWorkbenchTab,
    artifacts.length,
    previewBlocks,
    resultPreviewUrl,
    setAgentWorkbenchManuallyOpened,
    setAgentWorkbenchTabTouched,
    settledWorkbenchTurnKey,
    showAgentPlan,
    isLoading,
  ]);

  useEffect(() => {
    if (isLoading) {
      setAgentWorkbenchTabTouched(false);

    }
  }, [isLoading, setAgentWorkbenchTabTouched]);

  useEffect(() => {
    if (
      !showAgentWorkbench ||
      !isLoading ||
      agentWorkbenchTabTouched ||
      !latestWorkspaceFocusTab
    ) {
      return;
    }
    if (latestWorkspaceFocusTab === "artifacts") {
      if (artifactCount <= 0) return;
      if (
        latestArtifactFocusPath &&
        artifacts.includes(latestArtifactFocusPath)
      ) {
        selectArtifact(latestArtifactFocusPath, true);
      }
      // Artifacts now live inside the unified workbench surface. Keeping the
      // legacy standalone flag open would reserve a second (empty) sidebar.
      setArtifactsOpen(false);
      setShowAgentPlan(false);
      setShowResearchHistory(false);
      setShowResearch(false);
    }
    setAgentWorkbenchTab(latestWorkspaceFocusTab);
  }, [
    agentWorkbenchTabTouched,
    artifactCount,
    artifacts,
    latestArtifactFocusPath,
    latestWorkspaceFocusTab,
    selectArtifact,
    setAgentWorkbenchTab,
    setArtifactsOpen,
    setShowAgentPlan,
    setShowResearch,
    setShowResearchHistory,
    showAgentWorkbench,
    isLoading,
  ]);
}
