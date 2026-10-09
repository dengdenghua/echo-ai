import { memo, type ComponentProps } from "react";
import { XIcon } from "lucide-react";

import {
  AgentWorkbenchPanel,
  type AgentWorkbenchTabId,
  type WorkbenchRosterSeat,
} from "@/components/workspace/agent-workbench-panel";
import type {
  AgentWorkbenchEventView,
  AgentWorkbenchFocusAgentSnapshot,
  AgentWorkbenchFocusView,
  AgentWorkbenchProcessEventKind,
  AgentWorkbenchProcessEventSnapshot,
} from "@/components/workspace/agent-workbench-events";
import { AutomationSubscriptionPanel } from "@/components/workspace/automation/automation-subscription-panel";
import { DeepResearchHistoryPanel } from "@/components/workspace/deep-research-history-panel";
import { DeepResearchPanel } from "@/components/workspace/deep-research-panel";
import { TeachRepeatPanel } from "@/components/workspace/teach-repeat-panel";
import type { Agent } from "@/core/agents";
import type { ResearchJob } from "@/core/research/api";

import type {
  RealtimeThread,
  RealtimeToolEvents,
  RealtimeTranslations,
  StateSetter,
} from "./realtime-page-types";
import type { ConversationUserInput } from "./realtime-turn-utils";

/*
 * Surfaces of the single right-hand panel. The page picks one of them in
 * priority order (Teach & Repeat → automation → research history → research
 * → plan → workbench); the utility surfaces are memoized because none of
 * their inputs change while a turn streams.
 */

export const RealtimeTeachRepeatSurface = memo(function RealtimeTeachRepeatSurface({
  t,
  threadId,
  setShowTeachRepeatPanel,
}: {
  t: RealtimeTranslations;
  threadId: string;
  setShowTeachRepeatPanel: StateSetter<boolean>;
}) {
  return (
    <div className="flex size-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-default px-3">
        <span className="text-sm font-semibold">
          {t.teachRepeat.title}
        </span>
        <button
          type="button"
          onClick={() => setShowTeachRepeatPanel(false)}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t.common.close}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <TeachRepeatPanel
        threadId={threadId}
        className="min-h-0 flex-1 overflow-auto"
      />
    </div>
  );
});

export const RealtimeAutomationSurface = memo(function RealtimeAutomationSurface({
  setShowAutomationPanel,
}: {
  setShowAutomationPanel: StateSetter<boolean>;
}) {
  return (
    <AutomationSubscriptionPanel
      className="size-full"
      onClose={() => setShowAutomationPanel(false)}
    />
  );
});

export const RealtimeResearchHistorySurface = memo(function RealtimeResearchHistorySurface({
  activeJobId,
  setResearchJob,
  setResearchError,
  setShowResearch,
  setShowResearchHistory,
}: {
  activeJobId: string | undefined;
  setResearchJob: (job: ResearchJob | null) => void;
  setResearchError: (error: string | null) => void;
  setShowResearch: (visible: boolean) => void;
  setShowResearchHistory: StateSetter<boolean>;
}) {
  return (
    <DeepResearchHistoryPanel
      activeJobId={activeJobId}
      onSelect={(job) => {
        setResearchJob(job);
        setResearchError(null);
        setShowResearch(true);
        setShowResearchHistory(false);
      }}
      onClose={() => setShowResearchHistory(false)}
    />
  );
});

export const RealtimeResearchSurface = memo(function RealtimeResearchSurface({
  researchJob,
  researchLoading,
  researchError,
  setShowResearch,
}: {
  researchJob: ResearchJob;
  researchLoading: boolean;
  researchError: string | null;
  setShowResearch: (visible: boolean) => void;
}) {
  return (
    <DeepResearchPanel
      job={researchJob}
      loading={researchLoading}
      error={researchError}
      onClose={() => setShowResearch(false)}
    />
  );
});

export const RealtimeResearchErrorSurface = memo(function RealtimeResearchErrorSurface({
  t,
  researchError,
  setShowResearch,
}: {
  t: RealtimeTranslations;
  researchError: string;
  setShowResearch: (visible: boolean) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
        <span className="text-sm font-medium">Agent</span>
        <button
          type="button"
          onClick={() => setShowResearch(false)}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label={t.common.close}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="p-3 text-xs text-destructive">
        {researchError}
      </div>
    </div>
  );
});

type WorkbenchPanelProps = ComponentProps<typeof AgentWorkbenchPanel>;

export interface RealtimeWorkbenchSurfaceProps {
  threadId: string;
  thread: RealtimeThread;
  agentWorkbenchTab: AgentWorkbenchTabId;
  effectiveAgentId: string;
  workbenchDisplayEvents: RealtimeToolEvents;
  progressOutline: WorkbenchPanelProps["progressOutline"];
  lastTurnUserInput: ConversationUserInput | null;
  focusedWorkbenchTurnIndex: number | null;
  focusedWorkbenchAgentId: string | null;
  focusedWorkbenchAgentView: AgentWorkbenchFocusView | null;
  focusedWorkbenchAgentSnapshot: AgentWorkbenchFocusAgentSnapshot | null;
  focusedWorkbenchAgentNonce: number;
  focusedWorkbenchEventId: string | null;
  focusedWorkbenchEventKind: AgentWorkbenchProcessEventKind | null;
  focusedWorkbenchEventView: AgentWorkbenchEventView | null;
  focusedWorkbenchEventNonce: number;
  focusedWorkbenchProcessEvent: AgentWorkbenchProcessEventSnapshot | null;
  focusedWorkbenchEffectKey: string | null;
  hasCompletedAgentOutput: boolean;
  agentRunSettled: boolean;
  agentRunFailed: boolean;
  agentRunInterrupted: boolean;
  agentRunBlocked: boolean;
  hasPausedOrPendingBackgroundTask: boolean;
  workDir: string;
  previewBlocks: WorkbenchPanelProps["browserPreviewBlocks"];
  resultPreviewUrl: string | null;
  perspectiveDisplayAgent: Agent | null;
  mainPerspectiveAgentId: string;
  contextTokens: number;
  maxContextTokens: number;
  isCompressingContext: boolean;
  handleCompressContext: () => Promise<void>;
  collaborationRosterSeats: WorkbenchRosterSeat[];
  isGroupConversation: boolean;
  collaborationTeamName: string;
  headerThreadTitle: string | undefined;
  handleRetryTask: (prompt: string) => void;
  canManageHumanInvites: boolean;
  handleOpenHumanInvite: () => Promise<void>;
  closeAgentWorkbenchPanel: () => void;
  selectAgentWorkbenchTab: (tab: AgentWorkbenchTabId) => void;
  openWorkbenchArtifact: (path: string) => void;
}

/** The agent workbench (diff, terminal, browser, artifacts, project …). */
export function RealtimeWorkbenchSurface({
  threadId,
  thread,
  agentWorkbenchTab,
  effectiveAgentId,
  workbenchDisplayEvents,
  progressOutline,
  lastTurnUserInput,
  focusedWorkbenchTurnIndex,
  focusedWorkbenchAgentId,
  focusedWorkbenchAgentView,
  focusedWorkbenchAgentSnapshot,
  focusedWorkbenchAgentNonce,
  focusedWorkbenchEventId,
  focusedWorkbenchEventKind,
  focusedWorkbenchEventView,
  focusedWorkbenchEventNonce,
  focusedWorkbenchProcessEvent,
  focusedWorkbenchEffectKey,
  hasCompletedAgentOutput,
  agentRunSettled,
  agentRunFailed,
  agentRunInterrupted,
  agentRunBlocked,
  hasPausedOrPendingBackgroundTask,
  workDir,
  previewBlocks,
  resultPreviewUrl,
  perspectiveDisplayAgent,
  mainPerspectiveAgentId,
  contextTokens,
  maxContextTokens,
  isCompressingContext,
  handleCompressContext,
  collaborationRosterSeats,
  isGroupConversation,
  collaborationTeamName,
  headerThreadTitle,
  handleRetryTask,
  canManageHumanInvites,
  handleOpenHumanInvite,
  closeAgentWorkbenchPanel,
  selectAgentWorkbenchTab,
  openWorkbenchArtifact,
}: RealtimeWorkbenchSurfaceProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <AgentWorkbenchPanel
          hideMainOverview
          activeTab={agentWorkbenchTab}
          personaId={effectiveAgentId}
          events={workbenchDisplayEvents}
          progressOutline={progressOutline}
          userInput={
            focusedWorkbenchTurnIndex === null
              ? lastTurnUserInput
              : {
                  text:
                    focusedWorkbenchAgentSnapshot?.task ?? "",
                  uploadedFiles: [],
                  attachments: [],
                }
          }
          groundingSources={
            thread.values.latest_grounding ?? []
          }
          focusedAgentId={focusedWorkbenchAgentId}
          focusedAgentView={focusedWorkbenchAgentView}
          focusedAgentSnapshot={focusedWorkbenchAgentSnapshot}
          focusedAgentNonce={focusedWorkbenchAgentNonce}
          focusedEventId={focusedWorkbenchEventId}
          focusedEventKind={focusedWorkbenchEventKind}
          focusedEventView={focusedWorkbenchEventView}
          focusedEventNonce={focusedWorkbenchEventNonce}
          focusedProcessEvent={focusedWorkbenchProcessEvent}
          focusedEffectKey={focusedWorkbenchEffectKey}
          hasAnswer={
            focusedWorkbenchTurnIndex === null
              ? hasCompletedAgentOutput
              : true
          }
          isLoading={
            focusedWorkbenchTurnIndex === null
              ? thread.isLoading
              : false
          }
          runSettled={
            focusedWorkbenchTurnIndex === null
              ? agentRunSettled
              : true
          }
          runFailed={
            focusedWorkbenchTurnIndex === null
              ? agentRunFailed
              : focusedWorkbenchAgentSnapshot?.status ===
                "error"
          }
          runInterrupted={agentRunInterrupted}
          runBlocked={agentRunBlocked}
          paused={hasPausedOrPendingBackgroundTask}
          threadId={threadId}
          workDir={workDir}
          browserPreviewBlocks={previewBlocks}
          resultPreviewUrl={resultPreviewUrl}
          mainAgentName={
            perspectiveDisplayAgent?.display_name ||
            mainPerspectiveAgentId
          }
          contextTokens={contextTokens}
          maxContextTokens={maxContextTokens}
          isCompressingContext={isCompressingContext}
          onCompressContext={handleCompressContext}
          rosterSeats={collaborationRosterSeats}
          showMachineScopeRail={false}
          showMachineRosterRail={false}
          showDeliveryRecovery={isGroupConversation}
          groupTitle={
            isGroupConversation ? collaborationTeamName : null
          }
          currentThreadTitle={headerThreadTitle || null}
          onProjectCommand={handleRetryTask}
          onInvitePeople={
            canManageHumanInvites
              ? handleOpenHumanInvite
              : undefined
          }
          onClose={closeAgentWorkbenchPanel}
          onSelectTab={selectAgentWorkbenchTab}
          onOpenArtifact={openWorkbenchArtifact}
        />
      </div>
    </div>
  );
}
