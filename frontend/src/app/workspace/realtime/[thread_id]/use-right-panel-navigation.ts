import { useCallback, useEffect } from "react";

import type {
  AgentWorkbenchTabId,
  WorkbenchRosterSeat,
} from "@/components/workspace/agent-workbench-panel";
import type {
  AgentWorkbenchEventView,
  AgentWorkbenchFocusAgentSnapshot,
  AgentWorkbenchFocusView,
  AgentWorkbenchProcessEventKind,
  AgentWorkbenchProcessEventSnapshot,
} from "@/components/workspace/agent-workbench-events";
import type { finalOutputArtifactEntries } from "@/components/workspace/agent-workbench-utils";
import type { RightPanelPage } from "@/components/workspace/realtime/right-panel-menu";
import {
  OPEN_ARTIFACT_EVENT,
  type OpenArtifactDetail,
} from "@/core/artifacts/open-artifact";
import { normalizeWorkspaceArtifactRef } from "@/core/artifacts/utils";
import { rememberWorkbenchTab } from "@/core/workspace/workbench-preferences";

import type { StateSetter } from "./realtime-page-types";
import type { WorkbenchSurfaceSetters } from "./use-workbench-surface";

interface WorkbenchPanelOpenersInput extends WorkbenchSurfaceSetters {
  threadId: string;
  isEchoAssistant: boolean;
  showResearch: boolean;
  researchJob: unknown;
  researchError: string | null;
  showTeachRepeatPanel: boolean;
  showAutomationPanel: boolean;
  showResearchHistory: boolean;
  artifactsOpen: boolean;
  showAgentPlan: boolean;
  showAgentWorkbench: boolean;
  agentWorkbenchTab: AgentWorkbenchTabId;
  artifacts: string[];
  setArtifacts: StateSetter<string[]>;
  selectArtifact: (artifact: string, autoSelect?: boolean) => void;
  setFocusedWorkbenchEffectKey: StateSetter<string | null>;
  setFocusedWorkbenchAgentId: StateSetter<string | null>;
  setFocusedWorkbenchAgentView: StateSetter<AgentWorkbenchFocusView | null>;
  setFocusedWorkbenchAgentSnapshot: StateSetter<AgentWorkbenchFocusAgentSnapshot | null>;
  setFocusedWorkbenchTurnIndex: StateSetter<number | null>;
  setFocusedWorkbenchAgentNonce: StateSetter<number>;
  setFocusedWorkbenchEventId: StateSetter<string | null>;
  setFocusedWorkbenchEventKind: StateSetter<AgentWorkbenchProcessEventKind | null>;
  setFocusedWorkbenchEventView: StateSetter<AgentWorkbenchEventView | null>;
  setFocusedWorkbenchProcessEvent: StateSetter<AgentWorkbenchProcessEventSnapshot | null>;
}

/**
 * The single right-hand surface: which page is active, and the openers that
 * hand it to the agent workbench (agent seat, artifacts tab, a file).
 */
export function useWorkbenchPanelOpeners({
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
  closeSpecialUtilityPanels,
  setArtifactsOpen,
  setShowResearch,
  setShowAgentPlan,
  setShowResearchHistory,
  setAgentWorkbenchManuallyOpened,
  setAgentWorkbenchTab,
  setAgentWorkbenchTabTouched,
  setFocusedWorkbenchEffectKey,
  setFocusedWorkbenchAgentId,
  setFocusedWorkbenchAgentView,
  setFocusedWorkbenchAgentSnapshot,
  setFocusedWorkbenchTurnIndex,
  setFocusedWorkbenchAgentNonce,
  setFocusedWorkbenchEventId,
  setFocusedWorkbenchEventKind,
  setFocusedWorkbenchEventView,
  setFocusedWorkbenchProcessEvent,
}: WorkbenchPanelOpenersInput) {
  const hasResearchPanel = showResearch && (!!researchJob || !!researchError);
  const hasSpecialUtilityPanel =
    showTeachRepeatPanel || (isEchoAssistant && showAutomationPanel);
  const activeRightPanel: RightPanelPage | null = hasSpecialUtilityPanel
    ? // RightPanelMenu only needs a non-null value to make its shared button
      // close the currently visible surface. Special utilities have no menu
      // page of their own, so use the generic workbench marker.
      "agent"
    : showResearchHistory
      ? "history"
      : hasResearchPanel
        ? "research"
        : artifactsOpen
          ? "artifacts"
          : showAgentPlan
            ? "plan"
            : showAgentWorkbench
              ? agentWorkbenchTab === "artifacts"
                ? "artifacts"
                : "agent"
              : null;

  const openAgentPanel = useCallback(
    (seat?: WorkbenchRosterSeat) => {
      closeSpecialUtilityPanels();
      setFocusedWorkbenchEffectKey(null);
      // In a group the main column is the selected role's conversation view.
      // Clicking any *other* AI seat (including a 数字员工) must therefore open
      // that member's own workstation on the right, rather than silently
      // throwing away the identity that the roster strip already supplied.
      if (seat?.kind && seat.kind !== "human" && seat.id.trim()) {
        setFocusedWorkbenchAgentId(seat.id.trim());
        setFocusedWorkbenchAgentView("screen");
        setFocusedWorkbenchAgentSnapshot(null);
        setFocusedWorkbenchTurnIndex(null);
        setFocusedWorkbenchAgentNonce((value) => value + 1);
        setFocusedWorkbenchEventId(null);
        setFocusedWorkbenchEventKind(null);
        setFocusedWorkbenchEventView(null);
        setFocusedWorkbenchProcessEvent(null);
      } else {
        setFocusedWorkbenchAgentId(null);
        setFocusedWorkbenchAgentView(null);
        setFocusedWorkbenchAgentSnapshot(null);
        setFocusedWorkbenchTurnIndex(null);
      }
      setArtifactsOpen(false);
      setShowAgentPlan(false);

      setAgentWorkbenchManuallyOpened(true);
      setShowResearchHistory(false);
      setShowResearch(false);
      setAgentWorkbenchTab("agent");
      setAgentWorkbenchTabTouched(true);
    },
    [
      closeSpecialUtilityPanels,
      setAgentWorkbenchManuallyOpened,
      setAgentWorkbenchTab,
      setAgentWorkbenchTabTouched,
      setArtifactsOpen,
      setFocusedWorkbenchAgentId,
      setFocusedWorkbenchAgentNonce,
      setFocusedWorkbenchAgentSnapshot,
      setFocusedWorkbenchAgentView,
      setFocusedWorkbenchEffectKey,
      setFocusedWorkbenchEventId,
      setFocusedWorkbenchEventKind,
      setFocusedWorkbenchEventView,
      setFocusedWorkbenchProcessEvent,
      setFocusedWorkbenchTurnIndex,
      setShowAgentPlan,
      setShowResearch,
      setShowResearchHistory,
    ],
  );

  const openArtifactsPanel = useCallback(() => {
    closeSpecialUtilityPanels();
    // Artifacts render inside the workbench's "产物" tab (same surface as
    // terminal / browser). Open the workbench and switch to that tab.
    setArtifactsOpen(false);
    setShowAgentPlan(false);

    setAgentWorkbenchManuallyOpened(true);
    setShowResearchHistory(false);
    setShowResearch(false);
    setAgentWorkbenchTab("artifacts");
    setAgentWorkbenchTabTouched(true);
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

  const openWorkbenchArtifact = useCallback(
    (path: string) => {
      closeSpecialUtilityPanels();
      const normalizedPath = normalizeWorkspaceArtifactRef(path, threadId);
      if (path) {
        if (!artifacts.includes(normalizedPath)) {
          setArtifacts((prev) => [...prev, normalizedPath]);
        }
        selectArtifact(normalizedPath, true);
      }
      // Route to the embedded artifacts tab inside the workbench
      // (same surface as terminal / browser). Auto-open the workbench
      // if it's not visible.
      setArtifactsOpen(false);
      setShowAgentPlan(false);

      setAgentWorkbenchManuallyOpened(true);
      setShowResearchHistory(false);
      setShowResearch(false);
      setAgentWorkbenchTab("artifacts");
      setAgentWorkbenchTabTouched(true);
    },
    [
      artifacts,
      closeSpecialUtilityPanels,
      selectArtifact,
      setAgentWorkbenchManuallyOpened,
      setAgentWorkbenchTab,
      setAgentWorkbenchTabTouched,
      setArtifactsOpen,
      setArtifacts,
      setShowAgentPlan,
      setShowResearch,
      setShowResearchHistory,
      threadId,
    ],
  );

  return {
    hasResearchPanel,
    activeRightPanel,
    openAgentPanel,
    openArtifactsPanel,
    openWorkbenchArtifact,
  };
}

/**
 * Artifact links anywhere in the page (OPEN_ARTIFACT_EVENT) and the final
 * deliverable notice open the file in the workbench's artifacts tab.
 */
export function useArtifactOpenRequests({
  openWorkbenchArtifact,
  finalArtifactEntries,
}: {
  openWorkbenchArtifact: (path: string) => void;
  finalArtifactEntries: ReturnType<typeof finalOutputArtifactEntries>;
}) {
  useEffect(() => {
    const handleOpenArtifact = (event: Event) => {
      const detail = (event as CustomEvent<OpenArtifactDetail>).detail;
      const path = typeof detail?.path === "string" ? detail.path.trim() : "";
      if (!path) return;
      event.preventDefault();
      openWorkbenchArtifact(path);
    };
    window.addEventListener(OPEN_ARTIFACT_EVENT, handleOpenArtifact);
    return () =>
      window.removeEventListener(OPEN_ARTIFACT_EVENT, handleOpenArtifact);
  }, [openWorkbenchArtifact]);

  const openFinalArtifactPanel = useCallback(() => {
    const firstEntry = finalArtifactEntries[0];
    if (firstEntry?.path) openWorkbenchArtifact(firstEntry.path);
  }, [finalArtifactEntries, openWorkbenchArtifact]);

  return openFinalArtifactPanel;
}

interface RightPanelSwitchesInput extends WorkbenchSurfaceSetters {
  effectiveAgentId: string;
  isEchoAssistant: boolean;
  hasResearchPanel: boolean;
  showAgentPlan: boolean;
  showAutomationPanel: boolean;
  showResearchHistory: boolean;
  showTeachRepeatPanel: boolean;
  setShowAutomationPanel: StateSetter<boolean>;
  setShowTeachRepeatPanel: StateSetter<boolean>;
}

/**
 * Header-menu switches between the plan, preview, research and history
 * views, and the layered close behaviour of the shared right panel.
 */
export function useRightPanelSwitches({
  effectiveAgentId,
  isEchoAssistant,
  hasResearchPanel,
  showAgentPlan,
  showAutomationPanel,
  showResearchHistory,
  showTeachRepeatPanel,
  setShowAutomationPanel,
  setShowTeachRepeatPanel,
  closeSpecialUtilityPanels,
  setArtifactsOpen,
  setShowResearch,
  setShowAgentPlan,
  setShowResearchHistory,
  setAgentWorkbenchManuallyOpened,
  setAgentWorkbenchTab,
  setAgentWorkbenchTabTouched,
}: RightPanelSwitchesInput) {
  const openAgentPlanPanel = useCallback(() => {
    closeSpecialUtilityPanels();
    setArtifactsOpen(false);
    setShowAgentPlan(true);
    setShowResearchHistory(false);
    setShowResearch(false);
  }, [
    closeSpecialUtilityPanels,
    setArtifactsOpen,
    setShowAgentPlan,
    setShowResearch,
    setShowResearchHistory,
  ]);

  const openPreviewPanel = useCallback(() => {
    closeSpecialUtilityPanels();
    setArtifactsOpen(false);
    setShowAgentPlan(false);

    setAgentWorkbenchManuallyOpened(true);
    setShowResearchHistory(false);
    setShowResearch(false);
    setAgentWorkbenchTab("browser");
    setAgentWorkbenchTabTouched(true);
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

  const openResearchPanel = useCallback(() => {
    closeSpecialUtilityPanels();
    setArtifactsOpen(false);
    setShowAgentPlan(false);
    setShowResearchHistory(false);
    setShowResearch(true);
  }, [
    closeSpecialUtilityPanels,
    setArtifactsOpen,
    setShowAgentPlan,
    setShowResearch,
    setShowResearchHistory,
  ]);

  const openResearchHistoryPanel = useCallback(() => {
    closeSpecialUtilityPanels();
    setArtifactsOpen(false);
    setShowAgentPlan(false);
    setShowResearchHistory(true);
    setShowResearch(false);
  }, [
    closeSpecialUtilityPanels,
    setArtifactsOpen,
    setShowAgentPlan,
    setShowResearch,
    setShowResearchHistory,
  ]);

  const closeAgentWorkbenchPanel = useCallback(() => {
    setArtifactsOpen(false);
    setAgentWorkbenchManuallyOpened(false);

  }, [setAgentWorkbenchManuallyOpened, setArtifactsOpen]);

  const closeUnifiedRightPanel = useCallback(() => {
    // Utility views temporarily take over the one right-side surface. Closing
    // the top view only dismisses that view, allowing the previously open
    // workbench (and its selected tab) to reappear underneath.
    if (showTeachRepeatPanel) {
      setShowTeachRepeatPanel(false);
      return;
    }
    if (isEchoAssistant && showAutomationPanel) {
      setShowAutomationPanel(false);
      return;
    }
    if (showResearchHistory) {
      setShowResearchHistory(false);
      return;
    }
    if (hasResearchPanel) {
      setShowResearch(false);
      return;
    }
    if (showAgentPlan) {
      setShowAgentPlan(false);
      return;
    }
    closeAgentWorkbenchPanel();
  }, [
    closeAgentWorkbenchPanel,
    hasResearchPanel,
    isEchoAssistant,
    setShowAgentPlan,
    setShowAutomationPanel,
    setShowResearch,
    setShowResearchHistory,
    setShowTeachRepeatPanel,
    showAgentPlan,
    showAutomationPanel,
    showResearchHistory,
    showTeachRepeatPanel,
  ]);

  const closeRightPanel = closeUnifiedRightPanel;
  const selectAgentWorkbenchTab = useCallback(
    (tab: AgentWorkbenchTabId) => {
      if (tab === "plan") {
        openAgentPlanPanel();
        return;
      }
      closeSpecialUtilityPanels();
      // "artifacts" now renders inline inside the workbench (same surface as
      // terminal / browser) — no need to open the legacy standalone sidebar.
      setArtifactsOpen(false);
      setShowAgentPlan(false);

      setAgentWorkbenchManuallyOpened(true);
      setShowResearchHistory(false);
      setShowResearch(false);
      setAgentWorkbenchTab(tab);
      setAgentWorkbenchTabTouched(true);
      rememberWorkbenchTab(effectiveAgentId, tab);
    },
    [
      closeSpecialUtilityPanels,
      effectiveAgentId,
      openAgentPlanPanel,
      setAgentWorkbenchManuallyOpened,
      setAgentWorkbenchTab,
      setAgentWorkbenchTabTouched,
      setArtifactsOpen,
      setShowAgentPlan,
      setShowResearch,
      setShowResearchHistory,
    ],
  );

  return {
    openAgentPlanPanel,
    openPreviewPanel,
    openResearchPanel,
    openResearchHistoryPanel,
    closeAgentWorkbenchPanel,
    closeUnifiedRightPanel,
    closeRightPanel,
    selectAgentWorkbenchTab,
  };
}
