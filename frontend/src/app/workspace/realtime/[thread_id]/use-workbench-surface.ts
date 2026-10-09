import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentWorkbenchTabId } from "@/components/workspace/agent-workbench-panel";
import {
  AGENT_WORKBENCH_FOCUS_EVENT,
  AGENT_WORKBENCH_OPEN_EVENT,
  type AgentWorkbenchEventView,
  type AgentWorkbenchFocusAgentSnapshot,
  type AgentWorkbenchFocusDetail,
  type AgentWorkbenchFocusView,
  type AgentWorkbenchOpenDetail,
  type AgentWorkbenchProcessEventKind,
  type AgentWorkbenchProcessEventSnapshot,
} from "@/components/workspace/agent-workbench-events";
import { getRecordingStatus } from "@/core/teach-repeat/api";
import { useCapabilitySurface } from "@/core/plugins/use-capability-surface";
import { swallow } from "@/core/utils/log";

import type { StateSetter } from "./realtime-page-types";

/**
 * Teach & Repeat and the Assistant automation panel temporarily take over the
 * right-hand surface. Also owns the REC overlay and its recording status.
 */
export function useUtilityPanels({
  threadId,
  isNewThread,
}: {
  threadId: string;
  isNewThread: boolean;
}) {
  // 助理专属：右侧内嵌「自动化 / 订阅」管理面板开关。
  const [showAutomationPanel, setShowAutomationPanel] = useState(false);
  const recorderPluginEnabled = useCapabilitySurface("chat.recorder");
  const [showTeachRepeatPanel, setShowTeachRepeatPanel] = useState(false);
  const closeSpecialUtilityPanels = useCallback(() => {
    setShowTeachRepeatPanel(false);
    setShowAutomationPanel(false);
  }, []);
  const openTeachRepeatPanel = useCallback(() => {
    if (!recorderPluginEnabled) return;
    setShowAutomationPanel(false);
    setShowTeachRepeatPanel(true);
  }, [recorderPluginEnabled]);
  const toggleAutomationPanel = useCallback(() => {
    setShowTeachRepeatPanel(false);
    setShowAutomationPanel((open) => !open);
  }, []);
  // REC floating recorder overlay (replaces the old confirm() start/stop flow).
  const [recOverlayOpen, setRecOverlayOpen] = useState(false);
  const [recIsRecording, setRecIsRecording] = useState(false);
  useEffect(() => {
    if (!recorderPluginEnabled || isNewThread || !threadId) {
      setRecIsRecording(false);
      setRecOverlayOpen(false);
      setShowTeachRepeatPanel(false);
      return;
    }

    let cancelled = false;
    void getRecordingStatus(threadId)
      .then((status) => {
        if (!cancelled) setRecIsRecording(status.recording);
      })
      .catch((error) => swallow(error, "teach-repeat-header-status"));

    return () => {
      cancelled = true;
    };
  }, [isNewThread, recorderPluginEnabled, threadId]);

  return {
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
  };
}

/**
 * Which right-hand surface is open (plan, research history, the agent
 * workbench) and which workbench tab is selected.
 */
export function useWorkbenchSurfaceState({
  threadId,
  isNewThread,
  pathname,
}: {
  threadId: string;
  isNewThread: boolean;
  pathname: string;
}) {
  const [showResearchHistory, setShowResearchHistory] = useState(false);
  const [showAgentPlan, setShowAgentPlan] = useState(false);
  const [agentWorkbenchTab, setAgentWorkbenchTab] =
    useState<AgentWorkbenchTabId>("diff");
  const [agentWorkbenchTabTouched, setAgentWorkbenchTabTouched] =
    useState(false);
  const [agentWorkbenchManuallyOpened, setAgentWorkbenchManuallyOpened] =
    useState(false);

  useEffect(() => {
    setAgentWorkbenchManuallyOpened(false);
    setAgentWorkbenchTabTouched(false);
  }, [threadId]);

  useEffect(() => {
    if (!isNewThread) return;
    setAgentWorkbenchManuallyOpened(false);
    setAgentWorkbenchTabTouched(false);
  }, [isNewThread, threadId]);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem(`echo:browser-return:${pathname}`)) return;
      setAgentWorkbenchTab("browser");
      setAgentWorkbenchTabTouched(true);

      setAgentWorkbenchManuallyOpened(true);
    } catch { /* Returning to the conversation still works without storage. */ }
  }, [pathname]);

  return {
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
  };
}

/** Setters every surface switch uses to hand the right panel to the workbench. */
export interface WorkbenchSurfaceSetters {
  closeSpecialUtilityPanels: () => void;
  setArtifactsOpen: (open: boolean) => void;
  setShowResearch: (visible: boolean) => void;
  setShowAgentPlan: StateSetter<boolean>;
  setShowResearchHistory: StateSetter<boolean>;
  setAgentWorkbenchManuallyOpened: StateSetter<boolean>;
  setAgentWorkbenchTab: StateSetter<AgentWorkbenchTabId>;
  setAgentWorkbenchTabTouched: StateSetter<boolean>;
}

/**
 * The workbench focus target (agent seat, process event, effect) requested by
 * timeline cards through the focus/open window events.
 */
export function useWorkbenchFocusState({
  threadId,
  closeSpecialUtilityPanels,
  setArtifactsOpen,
  setShowResearch,
  setShowAgentPlan,
  setShowResearchHistory,
  setAgentWorkbenchManuallyOpened,
  setAgentWorkbenchTab,
  setAgentWorkbenchTabTouched,
}: WorkbenchSurfaceSetters & { threadId: string }) {
  const [focusedWorkbenchAgentId, setFocusedWorkbenchAgentId] = useState<
    string | null
  >(null);
  // Which sub-view the focus event asked for; lives and dies with
  // focusedWorkbenchAgentId (set together, cleared together).
  const [focusedWorkbenchAgentView, setFocusedWorkbenchAgentView] =
    useState<AgentWorkbenchFocusView | null>(null);
  const [focusedWorkbenchAgentSnapshot, setFocusedWorkbenchAgentSnapshot] =
    useState<AgentWorkbenchFocusAgentSnapshot | null>(null);
  const [focusedWorkbenchTurnIndex, setFocusedWorkbenchTurnIndex] = useState<
    number | null
  >(null);
  // Bumped on every focus emission so the panel treats a repeat focus of the
  // same agent (e.g. a view switch) as a fresh intent.
  const [focusedWorkbenchAgentNonce, setFocusedWorkbenchAgentNonce] =
    useState(0);
  const [focusedWorkbenchEventId, setFocusedWorkbenchEventId] = useState<
    string | null
  >(null);
  const [focusedWorkbenchEventKind, setFocusedWorkbenchEventKind] =
    useState<AgentWorkbenchProcessEventKind | null>(null);
  const [focusedWorkbenchEventView, setFocusedWorkbenchEventView] =
    useState<AgentWorkbenchEventView | null>(null);
  const [focusedWorkbenchEventNonce, setFocusedWorkbenchEventNonce] =
    useState(0);
  const [focusedWorkbenchProcessEvent, setFocusedWorkbenchProcessEvent] =
    useState<AgentWorkbenchProcessEventSnapshot | null>(null);
  const [focusedWorkbenchEffectKey, setFocusedWorkbenchEffectKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    setFocusedWorkbenchAgentId(null);
    setFocusedWorkbenchAgentView(null);
    setFocusedWorkbenchAgentSnapshot(null);
    setFocusedWorkbenchTurnIndex(null);
    setFocusedWorkbenchEventId(null);
    setFocusedWorkbenchEventKind(null);
    setFocusedWorkbenchEventView(null);
    setFocusedWorkbenchEffectKey(null);
  }, [threadId]);

  useEffect(() => {
    const handleAgentFocus = (event: Event) => {
      const detail = (event as CustomEvent<AgentWorkbenchFocusDetail>).detail;
      const agentId =
        typeof detail?.agentId === "string" ? detail.agentId.trim() : "";
      if (!agentId) return;
      closeSpecialUtilityPanels();
      setFocusedWorkbenchAgentId(agentId);
      setFocusedWorkbenchAgentView(detail?.view ?? null);
      setFocusedWorkbenchAgentSnapshot(detail?.agent ?? null);
      setFocusedWorkbenchTurnIndex(
        typeof detail?.turnIndex === "number" ? detail.turnIndex : null,
      );
      setFocusedWorkbenchAgentNonce((n) => n + 1);
      setFocusedWorkbenchEventId(null);
      setFocusedWorkbenchEventKind(null);
      setFocusedWorkbenchEventView(null);
      setFocusedWorkbenchProcessEvent(null);
      setFocusedWorkbenchEffectKey(null);
      setArtifactsOpen(false);
      setShowAgentPlan(false);

      setAgentWorkbenchManuallyOpened(true);
      setShowResearchHistory(false);
      setShowResearch(false);
      setAgentWorkbenchTab(detail?.tab ?? "agent");
      setAgentWorkbenchTabTouched(true);
    };
    window.addEventListener(AGENT_WORKBENCH_FOCUS_EVENT, handleAgentFocus);
    return () =>
      window.removeEventListener(AGENT_WORKBENCH_FOCUS_EVENT, handleAgentFocus);
  }, [
    closeSpecialUtilityPanels,
    setAgentWorkbenchManuallyOpened,
    setAgentWorkbenchTab,
    setAgentWorkbenchTabTouched,
    setArtifactsOpen,
    setShowAgentPlan,
    setShowResearch,
    setShowResearchHistory,
  ]);

  useEffect(() => {
    const handleOpenWorkbench = (event: Event) => {
      const detail = (event as CustomEvent<AgentWorkbenchOpenDetail>).detail;
      closeSpecialUtilityPanels();
      setFocusedWorkbenchAgentId(null);
      setFocusedWorkbenchAgentView(null);
      setFocusedWorkbenchAgentSnapshot(null);
      setFocusedWorkbenchTurnIndex(null);
      setFocusedWorkbenchEventId(detail?.eventId?.trim() || null);
      setFocusedWorkbenchEventKind(detail?.eventKind ?? null);
      setFocusedWorkbenchEventView(detail?.view ?? null);
      setFocusedWorkbenchProcessEvent(detail?.processEvent ?? null);
      setFocusedWorkbenchEffectKey(detail?.effectKey?.trim() || null);
      setFocusedWorkbenchEventNonce((n) => n + 1);
      setArtifactsOpen(false);
      setShowAgentPlan(false);

      setAgentWorkbenchManuallyOpened(true);
      setShowResearchHistory(false);
      setShowResearch(false);
      if (detail?.tab) {
        setAgentWorkbenchTab(detail.tab);
      }
      setAgentWorkbenchTabTouched(true);
    };
    window.addEventListener(AGENT_WORKBENCH_OPEN_EVENT, handleOpenWorkbench);
    return () =>
      window.removeEventListener(
        AGENT_WORKBENCH_OPEN_EVENT,
        handleOpenWorkbench,
      );
  }, [
    closeSpecialUtilityPanels,
    setAgentWorkbenchManuallyOpened,
    setAgentWorkbenchTab,
    setAgentWorkbenchTabTouched,
    setArtifactsOpen,
    setShowAgentPlan,
    setShowResearch,
    setShowResearchHistory,
  ]);

  return {
    focusedWorkbenchAgentId,
    setFocusedWorkbenchAgentId,
    focusedWorkbenchAgentView,
    setFocusedWorkbenchAgentView,
    focusedWorkbenchAgentSnapshot,
    setFocusedWorkbenchAgentSnapshot,
    focusedWorkbenchTurnIndex,
    setFocusedWorkbenchTurnIndex,
    focusedWorkbenchAgentNonce,
    setFocusedWorkbenchAgentNonce,
    focusedWorkbenchEventId,
    setFocusedWorkbenchEventId,
    focusedWorkbenchEventKind,
    setFocusedWorkbenchEventKind,
    focusedWorkbenchEventView,
    setFocusedWorkbenchEventView,
    focusedWorkbenchEventNonce,
    focusedWorkbenchProcessEvent,
    setFocusedWorkbenchProcessEvent,
    focusedWorkbenchEffectKey,
    setFocusedWorkbenchEffectKey,
  };
}

/**
 * Navigation from a project entry asks for the contextual project tab once
 * per thread (the route state flag stays in history).
 */
export function useProjectWorkbenchRouteOpen({
  threadId,
  isNewThread,
  openProjectWorkbench,
  isProjectHomeThread,
  boundProjectData,
  closeSpecialUtilityPanels,
  setArtifactsOpen,
  setShowResearch,
  setShowAgentPlan,
  setShowResearchHistory,
  setAgentWorkbenchManuallyOpened,
  setAgentWorkbenchTab,
  setAgentWorkbenchTabTouched,
}: WorkbenchSurfaceSetters & {
  threadId: string;
  isNewThread: boolean;
  openProjectWorkbench: boolean | undefined;
  isProjectHomeThread: boolean;
  boundProjectData: unknown;
}) {
  const projectWorkbenchRouteOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    const shouldOpen = openProjectWorkbench;
    if (
      isNewThread ||
      !shouldOpen ||
      projectWorkbenchRouteOpenedRef.current === threadId
    ) {
      return;
    }
    projectWorkbenchRouteOpenedRef.current = threadId;
    closeSpecialUtilityPanels();
    setArtifactsOpen(false);
    setShowAgentPlan(false);
    setShowResearchHistory(false);
    setShowResearch(false);

    setAgentWorkbenchManuallyOpened(true);
    setAgentWorkbenchTab("project");
    setAgentWorkbenchTabTouched(true);
  }, [
    isNewThread,
    isProjectHomeThread,
    boundProjectData,
    closeSpecialUtilityPanels,
    openProjectWorkbench,
    setAgentWorkbenchManuallyOpened,
    setAgentWorkbenchTab,
    setAgentWorkbenchTabTouched,
    setArtifactsOpen,
    setShowAgentPlan,
    setShowResearch,
    setShowResearchHistory,
    threadId,
  ]);
}
