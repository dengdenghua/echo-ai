import { memo, useMemo, useRef, useState } from "react";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import type { OutlineRound } from "@/core/threads/progress-outline";
import type { GroundingSource, VisibilityStep } from "@/core/realtime/items";
import type { WorkBlock } from "../work-blocks";
import type {
  AgentTile,
  AgentWorkbenchTabId,
  DiffEntry,
} from "../agent-workbench-utils";
import type { AgentPhase } from "../agent-phases";
import type { AgentWorkbenchProcessEventSnapshot } from "../agent-workbench-events";
import { AgentSummaryPage } from "../agent-workbench-pages";
import type { LiveToolEvent } from "../live-tool-timeline";
import type { WorkbenchRosterSeat } from "./helpers";
import { SubagentProcessView } from "./subagent-process-view";
import type { MemberReadingPositions } from "./use-member-reading-position";

type AgentKanbanUserInput = {
  text: string;
  uploadedFiles: Array<{ filename: string; path: string }>;
  attachments: Array<{ filename: string }>;
} | null;

function visibilityStepNeedsAttention(step: VisibilityStep): boolean {
  const details = step.details ?? {};
  const requiresAction = details["requires_user_action"];
  if (requiresAction === true) return true;

  const status = String(details["status"] ?? "").toLowerCase();
  if (
    [
      "pending",
      "blocked",
      "error",
      "failed",
      "needs_input",
      "needs_approval",
      "permission_required",
      "conflict",
    ].includes(status)
  )
    return true;

  const severity = String(details["severity"] ?? "").toLowerCase();
  return severity === "error" || severity === "critical";
}

function AgentKanbanViewImpl({
  selectedRosterSeat,
  selectedAgent,
  screenBlocks,
  currentScreenBlockId,
  phases,
  blocks,
  agentTiles,
  visibleDiffEntries,
  focusedProcessEvent,
  focusedEventId,
  progressOutline,
  userInput,
  groundingSources,
  preferStructuredReferences,
  resultPreviewUrl,
  terminalState,
  contextTokens,
  maxContextTokens,
  isCompressingContext,
  onCompressContext,
  visibilityEvents,
  collaborationEvents,
  threadId,
  onSelectTab,
  onOpenArtifact,
  openMainProcess,
  setSelectedBlockId,
}: {
  effectiveActivityView: "summary" | "screen";
  selectedRosterSeat: WorkbenchRosterSeat | null;
  selectedAgent: AgentTile | null;
  screenBlocks: WorkBlock[];
  currentScreenBlockId: string | null;
  phases: AgentPhase[];
  blocks: WorkBlock[];
  agentTiles: AgentTile[];
  visibleDiffEntries: DiffEntry[];
  focusedProcessEvent: AgentWorkbenchProcessEventSnapshot | null;
  focusedEventId: string | null | undefined;
  progressOutline: OutlineRound[] | undefined;
  userInput: AgentKanbanUserInput;
  groundingSources: GroundingSource[];
  preferStructuredReferences: boolean;
  mainAgentName: string | null | undefined;
  resultPreviewUrl?: string | null;
  terminalState: "interrupted" | "failed" | "blocked" | null;
  contextTokens?: number;
  maxContextTokens?: number;
  isCompressingContext?: boolean;
  onCompressContext?: () => void | Promise<void>;
  visibilityEvents: LiveToolEvent[];
  collaborationEvents: LiveToolEvent[];
  threadId?: string;
  setActivityView: (view: "summary" | "trace" | "screen") => void;
  onSelectTab: ((tab: AgentWorkbenchTabId) => void) | undefined;
  onOpenArtifact: ((path: string) => void) | undefined;
  openMainProcess: () => void;
  setSelectedBlockId: (id: string | null) => void;
  setManualBlockSelection: (selected: boolean) => void;
}) {
  const { t } = useI18n();
  // Visibility (capability routing / delegation / skill-catalog) decisions.
  // Deliberately de-emphasised: collapsed by default, small text,
  // transparent background. Latest visibility item wins.
  const lastVisibilityEvent =
    visibilityEvents[visibilityEvents.length - 1] ?? null;
  const visibilitySteps = useMemo<VisibilityStep[]>(() => {
    const raw = lastVisibilityEvent?.input?.steps;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (step): step is VisibilityStep =>
        !!step &&
        typeof step === "object" &&
        typeof (step as VisibilityStep).decision_point === "string" &&
        typeof (step as VisibilityStep).conclusion === "string" &&
        typeof (step as VisibilityStep).basis === "string",
    );
  }, [lastVisibilityEvent]);
  const actionableVisibilitySteps = useMemo(
    () => visibilitySteps.filter(visibilityStepNeedsAttention),
    [visibilitySteps],
  );
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const readingPositions = useRef<MemberReadingPositions>(new Map());
  const focusedMember: AgentTile | null = selectedAgent ?? (selectedRosterSeat ? {
    id: selectedRosterSeat.id, name: selectedRosterSeat.name, label: selectedRosterSeat.name,
    status: "pending", task: "", blackboardWrites: [], filesTouched: [], eventCount: 0, startedAt: 0,
  } : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {focusedMember ? (
        <SubagentProcessView
          agent={focusedMember}
          blocks={selectedAgent ? screenBlocks : []}
          currentBlockId={currentScreenBlockId}
          onOpenMain={openMainProcess}
          onSelectBlock={setSelectedBlockId}
          threadId={threadId}
          readingPositions={readingPositions.current}
        />
      ) : (
        <AgentSummaryPage
          phases={phases}
          diffEntries={visibleDiffEntries}
          agentTiles={agentTiles}
          blocks={blocks}
          focusedProcessEvent={focusedProcessEvent}
          focusedEventId={focusedEventId}
          progressOutline={progressOutline}
          userInput={userInput}
          groundingSources={groundingSources}
          preferStructuredReferences={preferStructuredReferences}
          terminalState={terminalState}
          contextTokens={contextTokens}
          maxContextTokens={maxContextTokens}
          isCompressingContext={isCompressingContext}
          onCompressContext={onCompressContext}
          onSelectTab={onSelectTab}
          onOpenArtifact={onOpenArtifact}
          resultPreviewUrl={resultPreviewUrl}
          threadId={threadId}
          collaborationEvents={collaborationEvents}
        />
      )}

      {/* Explanatory capability traces stay in the event history. This surface
          appears only when the latest trace explicitly needs user attention. */}
      {lastVisibilityEvent && actionableVisibilitySteps.length > 0 ? (
        <div className="relative shrink-0 border-t border-warning/30 bg-warning/10 py-1">
          <button
            type="button"
            onClick={() => setVisibilityOpen((open) => !open)}
            className="relative z-10 flex w-full items-center gap-1.5 px-5 py-1.5 text-left transition-colors hover:bg-warning/10"
            aria-expanded={visibilityOpen}
          >
            {visibilityOpen ? (
              <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
            )}
            <span className="text-xs font-medium text-warning">
              {t.agentWorkbenchPanel.visibilityPanelTitle} ·{" "}
              {t.agentWorkbenchPanel.visibilityPanelAttention}
            </span>
            <span className="rounded-full bg-warning/10 px-1.5 text-xs tabular-nums text-warning">
              {actionableVisibilitySteps.length}
            </span>
          </button>
          {visibilityOpen && (
            <div className="relative z-10 space-y-1.5 px-5 pb-2.5">
              {actionableVisibilitySteps.map((step, index) => (
                <div
                  key={`${step.decision_point}:${index}`}
                  className="rounded-md border border-border-subtle bg-background/40 px-2 py-1.5"
                >
                  <span className="text-xs font-medium text-muted-foreground">
                    {t.agentWorkbenchPanel.visibilityStep} {index + 1}
                  </span>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground/75">
                    {step.conclusion}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {step.basis}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export const AgentKanbanView = memo(AgentKanbanViewImpl);
