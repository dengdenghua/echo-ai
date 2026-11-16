/**
 * RightPanelMenu — extracted from `workspace/realtime/[thread_id]/page.tsx`
 * (P3 decomposition). Behavior-preserving move.
 */
import { PanelRightIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { readRightPanelPreference, rememberRightPanel, type RightPanelPreference } from "@/core/workspace/right-panel-preference";
import { cn } from "@/lib/utils";
import type { AgentWorkbenchTabId } from "../agent-workbench-utils";
import { HeaderActionTooltip, headerActionClass } from "../header-action";

export type RightPanelPage =
  | "agent"
  | "artifacts"
  | "plan"
  | "preview"
  | "research"
  | "history";

export function RightPanelMenu({
  threadId = "",
  workbenchTab = "agent",
  onRestoreWorkbench,
  activePage,
  onClosePanel,
  onOpenAgent,
  onOpenArtifacts,
  onOpenPlan,
  onOpenPreview,
  onOpenResearch,
  onOpenResearchHistory,
  hasAgentWorkbench,
  hasPlan,
  hasPreview,
  hasResearch,
  hasResearchHistory,
  artifactCount,
}: {
  threadId?: string;
  workbenchTab?: AgentWorkbenchTabId;
  onRestoreWorkbench?: (tab: AgentWorkbenchTabId) => void;
  activePage: RightPanelPage | null;
  artifactCount: number;
  hasAgentWorkbench: boolean;
  hasPlan: boolean;
  hasPreview: boolean;
  hasResearch: boolean;
  hasResearchHistory: boolean;
  onClosePanel: () => void;
  onOpenAgent: () => void;
  onOpenArtifacts: () => void;
  onOpenPlan: () => void;
  onOpenPreview: () => void;
  onOpenResearch: () => void;
  onOpenResearchHistory: () => void;
}) {
  const { t } = useI18n();
  const remembered = useRef<RightPanelPreference | null>(null);
  useEffect(() => {
    if (!activePage) return;
    const preference = { threadId, page: activePage, tab: workbenchTab };
    remembered.current = preference;
    rememberRightPanel(preference);
  }, [activePage, threadId, workbenchTab]);
  const hasAnyPanel =
    hasAgentWorkbench ||
    hasPlan ||
    artifactCount > 0 ||
    hasPreview ||
    hasResearch ||
    hasResearchHistory;

  if (!hasAnyPanel) return null;

  const openDefaultPanel = () => {
    if (hasAgentWorkbench) {
      onOpenAgent();
    } else if (artifactCount > 0) {
      onOpenArtifacts();
    } else if (hasPlan) {
      onOpenPlan();
    } else if (hasPreview) {
      onOpenPreview();
    } else if (hasResearch) {
      onOpenResearch();
    } else if (hasResearchHistory) {
      onOpenResearchHistory();
    }
  };
  const handleTogglePanel = () => {
    if (activePage) {
      onClosePanel();
      return;
    }
    const previous = remembered.current?.threadId === threadId
      ? remembered.current
      : readRightPanelPreference(threadId);
    if (previous) {
      const available = {
        agent: hasAgentWorkbench,
        artifacts: artifactCount > 0,
        plan: hasPlan,
        preview: hasPreview,
        research: hasResearch,
        history: hasResearchHistory,
      };
      if (available[previous.page]) {
        if (previous.page === "agent" && onRestoreWorkbench) {
          onRestoreWorkbench(previous.tab);
        } else {
          const openers = {
            agent: onOpenAgent,
            artifacts: onOpenArtifacts,
            plan: onOpenPlan,
            preview: onOpenPreview,
            research: onOpenResearch,
            history: onOpenResearchHistory,
          };
          openers[previous.page]();
        }
        return;
      }
    }
    openDefaultPanel();
  };

  const panelToggleLabel = activePage
    ? t.realtime.panelToggle.close
    : t.realtime.panelToggle.open;

  return (
    <HeaderActionTooltip label={panelToggleLabel}>
    <Button
      type="button"
      aria-label={panelToggleLabel}
      aria-pressed={Boolean(activePage)}
      data-state={activePage ? "open" : "closed"}
      onClick={handleTogglePanel}
      className={cn(
        headerActionClass,
        "w-[42px] px-0 sm:w-8",
        activePage && "bg-muted/60 text-foreground",
      )}
    >
      <PanelRightIcon className="size-4" />
    </Button>
    </HeaderActionTooltip>
  );
}
