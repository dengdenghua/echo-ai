import {
  BotIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  InfoIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { RoutedWebLink } from "@/components/ui/routed-web-link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import type { GroundingSource } from "@/core/realtime/items";
import type { OutlineRound } from "@/core/threads/progress-outline";
import { cn } from "@/lib/utils";

import {
  agentPhaseDisplayTitle,
  phaseStatusText,
  type AgentPhase,
} from "./agent-phases";
import {
  ReferenceIcon,
  SummaryAgentRow,
  SummaryDiffEntryList,
} from "./agent-summary-rows";
import type { AgentWorkbenchProcessEventSnapshot } from "./agent-workbench-events";
import { StatusGlyph } from "./agent-workbench-primitives";
import {
  basename,
  buildObservedReferenceTabs,
  compactReference,
  dedupeReferenceItems,
  fileKindLabel,
  OBSERVED_REFERENCE_META,
  type ObservedReferenceItem,
  type ObservedReferenceTab,
  type ObservedReferenceTabId,
} from "./agent-workbench-references";
import type {
  AgentTile,
  AgentWorkbenchTabId,
  DiffEntry,
} from "./agent-workbench-utils";
import { CollaborationCollectorPanel } from "./collaboration-collector-panel";
import type { LiveToolEvent } from "./live-tool-timeline";
import type { WorkBlock } from "./work-blocks";

// ============================================================================
// 看板概要页 (Agent Summary Dashboard)
// ============================================================================
function interruptedPhaseIndex(phases: AgentPhase[]): number {
  const activeIndex = phases.findIndex(
    (phase) =>
      phase.status === "running" || phase.status === "waiting_approval",
  );
  if (activeIndex >= 0) return activeIndex;

  const pendingIndex = phases.findIndex((phase) => phase.status === "pending");
  if (pendingIndex >= 0) return pendingIndex;

  // A provider can mark every todo complete just before the response stream
  // is interrupted. Keep earlier completed work, but do not present the final
  // handoff step as successfully settled when the turn never finished.
  for (let index = phases.length - 1; index >= 0; index -= 1) {
    if (phases[index]?.status === "done") return index;
  }
  return -1;
}

export function AgentSummaryPage({
  phases,
  diffEntries,
  agentTiles,
  blocks,
  focusedProcessEvent,
  progressOutline,
  userInput,
  groundingSources = [],
  preferStructuredReferences = false,
  terminalState,
  onSelectTab,
  onOpenArtifact,
  resultPreviewUrl: _resultPreviewUrl,
  threadId,
  collaborationEvents = [],
}: {
  phases: AgentPhase[];
  diffEntries: DiffEntry[];
  agentTiles: AgentTile[];
  blocks: WorkBlock[];
  focusedProcessEvent?: AgentWorkbenchProcessEventSnapshot | null;
  focusedEventId?: string | null;
  /** 「进展」面板的叙事大纲（按 iteration 分组）；缺省或为空时回退为 phase 平铺。 */
  progressOutline?: OutlineRound[];
  /** 本轮用户输入（原始请求 + 上传文件/附件）；用于概要页 Inputs 区。 */
  userInput?: {
    text: string;
    uploadedFiles: Array<{ filename: string; path: string }>;
    attachments: Array<{ filename: string }>;
  } | null;
  groundingSources?: GroundingSource[];
  /** Ignore legacy tool-text inference once the server supplies evidence. */
  preferStructuredReferences?: boolean;
  terminalState?: "interrupted" | "failed" | "blocked" | null;
  contextTokens?: number;
  maxContextTokens?: number;
  isCompressingContext?: boolean;
  onCompressContext?: () => void | Promise<void>;
  onSelectTab?: (tabId: AgentWorkbenchTabId) => void;
  onOpenArtifact?: (path: string) => void;
  /** A deployed or local result preview for the current completed case. */
  resultPreviewUrl?: string | null;
  /** Durable group-run coordinates and member lifecycle events. */
  threadId?: string;
  collaborationEvents?: LiveToolEvent[];
}) {
  const { t } = useI18n();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["progress", "artifacts", "references"]),
  );
  const [refTab, setRefTab] = useState<ObservedReferenceTabId>("files");
  const artifactDiffEntries = useMemo(
    () => diffEntries.filter((entry) => entry.created),
    [diffEntries],
  );
  const changedFileEntries = useMemo(
    () => diffEntries.filter((entry) => !entry.created),
    [diffEntries],
  );
  const openDiffEntry = (entry: DiffEntry, kind: "artifact" | "change") => {
    if (kind === "artifact") {
      // Generated artifacts open in the artifacts side panel (with the entry
      // selected when the host wires onOpenArtifact); the summary page itself
      // has no artifact viewer.
      if (onOpenArtifact) {
        onOpenArtifact(entry.path);
      } else {
        onSelectTab?.("artifacts");
      }
      return;
    }
    onSelectTab?.("diff");
  };
  const donePhaseCount = phases.filter(
    (phase) => phase.status === "done",
  ).length;
  const errorPhaseCount = phases.filter(
    (phase) => phase.status === "error",
  ).length;
  const runningPhase = phases.find(
    (phase) =>
      phase.status === "running" || phase.status === "waiting_approval",
  );
  const liveAgentCount = agentTiles.filter(
    (agent) => agent.status === "running" || agent.status === "pending",
  ).length;
  const hasLiveAgents = liveAgentCount > 0;
  const runActive = Boolean(runningPhase || hasLiveAgents);
  const hasTodoPlan =
    phases.length > 0 && blocks.some((block) => block.kind === "todo");
  const interruptedTaskIndex =
    terminalState === "interrupted" ? interruptedPhaseIndex(phases) : -1;
  const displayedDonePhaseCount =
    donePhaseCount -
    (interruptedTaskIndex >= 0 &&
    phases[interruptedTaskIndex]?.status === "done"
      ? 1
      : 0);
  const progressSectionLabel = hasTodoPlan
    ? t.todoList.title
    : t.agentWorkbenchPages.progress;
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };
  const showOutline =
    progressOutline !== undefined && progressOutline.length > 0;
  const outlineExecutionCount = showOutline
    ? progressOutline.reduce((sum, round) => sum + round.executionCount, 0)
    : 0;
  const outlineFactCount = showOutline
    ? progressOutline.reduce((sum, round) => sum + round.facts.length, 0)
    : 0;
  // 对话开始时喂入的上下文文件（上传文件/附件）——它们进入对话上下文但只出现在
  // 用户消息里，不属于 process 事件块，因此不会被 buildObservedReferenceTabs 收录。
  // 这里单独提取，归入 files 分类并计入上下文容量统计，避免"上下文统计只算网络搜索"。
  const inputReferenceItems = useMemo<ObservedReferenceItem[]>(() => {
    if (!userInput) return [];
    const items: ObservedReferenceItem[] = [];
    for (const f of userInput.uploadedFiles ?? []) {
      items.push({
        id: `input:upload:${f.path || f.filename}`,
        title: compactReference(f.filename || f.path, 120),
        subtitle:
          f.path && f.path !== f.filename
            ? compactReference(f.path, 140)
            : undefined,
        tag: fileKindLabel(f.filename || f.path),
      });
    }
    for (const a of userInput.attachments ?? []) {
      if (!a.filename) continue;
      items.push({
        id: `input:attach:${a.filename}`,
        title: compactReference(a.filename, 120),
        tag: fileKindLabel(a.filename),
      });
    }
    return dedupeReferenceItems(items);
  }, [userInput]);
  const injectedGroundingItems = useMemo(
    () =>
      dedupeReferenceItems(
        groundingSources.map((source, index) => {
          const path = source.path.trim();
          const title = source.title.trim() || basename(path);
          return {
            id: `grounding:${index}:${path}`,
            title: compactReference(title || path, 120),
            subtitle:
              path && path !== title ? compactReference(path, 140) : undefined,
            tag: source.kind === "doc" ? "DOC" : fileKindLabel(path),
          };
        }),
      ),
    [groundingSources],
  );

  const observedReferenceTabs = useMemo<ObservedReferenceTab[]>(() => {
    const tabs = buildObservedReferenceTabs(
      preferStructuredReferences ? [] : blocks,
      t,
    );
    const directFiles = dedupeReferenceItems([
      ...injectedGroundingItems,
      ...inputReferenceItems,
    ]);
    if (directFiles.length === 0) return tabs;
    const filesTab = tabs.find((tab) => tab.id === "files");
    if (filesTab) {
      return tabs.map((tab) =>
        tab.id === "files"
          ? {
              ...tab,
              items: dedupeReferenceItems([...directFiles, ...tab.items]),
            }
          : tab,
      );
    }
    return [
      {
        id: "files",
        label: t.agentWorkbenchPages.reference.files,
        items: directFiles,
      },
      ...tabs,
    ];
  }, [
    blocks,
    t,
    injectedGroundingItems,
    inputReferenceItems,
    preferStructuredReferences,
  ]);
  const activeRefTab = observedReferenceTabs.some((tab) => tab.id === refTab)
    ? refTab
    : (observedReferenceTabs[0]?.id ?? "files");
  const activeRefItems =
    observedReferenceTabs.find((tab) => tab.id === activeRefTab)?.items ?? [];
  const activeRefMeta = OBSERVED_REFERENCE_META[activeRefTab];
  const ActiveRefIcon = activeRefMeta.Icon;
  const totalReferenceItems = observedReferenceTabs.reduce(
    (sum, tab) => sum + tab.items.length,
    0,
  );
  useEffect(() => {
    setExpandedSections((previous) => {
      const next = new Set(previous);
      if (runActive && hasTodoPlan) {
        // During a planned run, the current task is the primary surface.
        // Outputs and context remain one click away without competing for the
        // same vertical space.
        next.delete("artifacts");
        next.delete("references");
      } else if (runActive) {
        return previous;
      }
      // Progress section stays always expanded when workbench is open
      next.add("progress");
      if (diffEntries.length > 0) {
        next.add("artifacts");
      }
      if (
        next.size === previous.size &&
        [...next].every((section) => previous.has(section))
      ) {
        return previous;
      }
      return next;
    });
  }, [diffEntries.length, hasTodoPlan, runActive]);
  const agentHealth = useMemo(() => {
    const total = agentTiles.length;
    const done = agentTiles.filter((agent) => agent.status === "done").length;
    const running = agentTiles.filter(
      (agent) => agent.status === "running",
    ).length;
    const failed = agentTiles.filter(
      (agent) => agent.status === "error",
    ).length;
    const pending = agentTiles.filter(
      (agent) => agent.status === "pending",
    ).length;
    const failedLabels = agentTiles
      .filter((agent) => agent.status === "error")
      .map((agent) => agent.taskLabel ?? agent.name ?? agent.role ?? agent.id);
    return { done, failed, failedLabels, pending, running, total };
  }, [agentTiles]);
  const isCoworkResponseGroup =
    agentTiles.length > 0 &&
    agentTiles.every((agent) => agent.role === "cowork");
  const settledAgentSummary = isCoworkResponseGroup
    ? `${agentHealth.done}/${agentHealth.total} ${t.message.statusResponded}`
    : t.agentWorkbenchPages.subagentsCompleted(
        agentHealth.done,
        agentHealth.total,
      );

  const recoveredCount = blocks.filter(
    (block) => block.status === "warning",
  ).length;
  const latestRecovery = [...blocks]
    .reverse()
    .find((block) => block.status === "warning");
  const latestAttention = [...blocks]
    .reverse()
    .find(
      (block) =>
        block.status === "error" || block.status === "waiting_approval",
    );
  const unresolvedCount =
    errorPhaseCount +
    phases.filter((phase) => phase.status === "waiting_approval").length;
  // The plan and artifact sections already describe normal progress. Keep the
  // receipt for the exceptional information users may need to act on or audit.
  const showResultReceipt =
    !runActive && (recoveredCount > 0 || unresolvedCount > 0);

  const isCompletelyEmpty =
    !focusedProcessEvent &&
    !showOutline &&
    phases.length === 0 &&
    diffEntries.length === 0 &&
    agentTiles.length === 0 &&
    totalReferenceItems === 0;

  return (
    <div
      data-testid="agent-summary-scroll-viewport"
      className="stable-scroll-viewport flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-background/35"
    >
      <div className="mx-auto w-full min-w-0 max-w-2xl px-5 py-4 pb-8">
        {/* 思考/执行详情均在对话框内完整展示，右侧不再重复渲染。
            The task plan stays visible even when a transcript process event is
            focused: selecting evidence must not erase the user's todo list. */}
        {(phases.length > 0 || showOutline) && (
          <section
            className="border-b border-border-subtle py-4"
            data-testid="workbench-task-plan"
          >
            <button
              type="button"
              aria-expanded={expandedSections.has("progress")}
              onClick={() => toggleSection("progress")}
              className="flex w-full items-center gap-2 text-left transition-colors hover:text-foreground"
              data-testid="workbench-task-plan-toggle"
            >
              <h3 className="text-xs font-medium text-foreground">
                {progressSectionLabel}
              </h3>
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {terminalState === "blocked"
                  ? t.streaming.blockedOnUser
                  : terminalState === "interrupted"
                    ? phases.length > 0
                      ? `${displayedDonePhaseCount}/${phases.length} ${t.agentWorkbenchPages.statusDone} · ${t.backgroundTasks.interrupted}`
                      : t.backgroundTasks.interrupted
                    : terminalState === "failed"
                      ? t.agentWorkbench.statusError
                      : phases.length > 0
                        ? `${donePhaseCount}/${phases.length} ${phaseStatusText(
                            runningPhase ? "running" : "done",
                          )}${
                            hasLiveAgents
                              ? ` · ${t.agentWorkbenchPages.subagentsRunning(liveAgentCount)}`
                              : ""
                          }`
                        : t.agentWorkbenchPages.roundActivitySummary(
                            outlineExecutionCount,
                            outlineFactCount,
                          )}
                {phases.length > 0 && errorPhaseCount > 0
                  ? ` · ${errorPhaseCount} ${phaseStatusText("error")}`
                  : ""}
              </span>
              {expandedSections.has("progress") ? (
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="size-3.5 text-muted-foreground" />
              )}
            </button>
            {expandedSections.has("progress") &&
              (phases.length > 0 ? (
                <ul
                  className={cn(
                    "stable-scroll-viewport mt-3 overflow-x-hidden overflow-y-auto pr-0.5",
                    hasTodoPlan ? "max-h-72 space-y-0.5" : "space-y-1",
                  )}
                  data-testid={
                    hasTodoPlan
                      ? "workbench-todo-list"
                      : "workbench-progress-list"
                  }
                >
                  {phases.map((phase, index) => {
                    const displayStatus =
                      index === interruptedTaskIndex
                        ? ("warning" as const)
                        : phase.status;
                    const displayStatusText =
                      displayStatus === "warning"
                        ? t.backgroundTasks.interrupted
                        : phaseStatusText(displayStatus);
                    return (
                      <li
                        key={phase.id}
                        className={cn(
                          "flex gap-2",
                          hasTodoPlan
                            ? "-mx-2 min-h-8 items-start rounded-md px-2 py-1.5"
                            : "min-h-7 items-center",
                          hasTodoPlan &&
                            (displayStatus === "running" ||
                              displayStatus === "waiting_approval") &&
                            "bg-info/5",
                          displayStatus === "warning" && "bg-warning/5",
                        )}
                        data-task-status={displayStatus}
                      >
                        <StatusGlyph
                          status={displayStatus}
                          className={cn("size-3.5", hasTodoPlan && "mt-0.5")}
                        />
                        {!hasTodoPlan && (
                          <span className="shrink-0 rounded bg-muted/65 px-1.5 py-0.5 font-mono text-micro font-medium leading-4 text-muted-foreground">
                            P{index + 1}
                          </span>
                        )}
                        <span
                          className={cn(
                            "min-w-0 flex-1 text-xs",
                            hasTodoPlan
                              ? "line-clamp-2 leading-5"
                              : "truncate text-foreground",
                            hasTodoPlan &&
                              (displayStatus === "running" ||
                                displayStatus === "waiting_approval")
                              ? "font-medium text-foreground"
                              : hasTodoPlan
                                ? "text-muted-foreground"
                                : null,
                          )}
                          title={phase.title}
                        >
                          {agentPhaseDisplayTitle(phase, t.agentPhases)}
                        </span>
                        {hasTodoPlan ? (
                          <span className="sr-only">{displayStatusText}</span>
                        ) : (
                          <span className="shrink-0 text-mini text-muted-foreground">
                            {displayStatusText}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <ul className="mt-3 space-y-1">
                  {(progressOutline ?? []).map((round) => (
                    <li
                      key={round.iteration}
                      className="flex min-h-7 items-center gap-2"
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/45" />
                      <span className="shrink-0 rounded bg-muted/65 px-1.5 py-0.5 font-mono text-micro font-medium leading-4 text-muted-foreground">
                        T{round.iteration}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {t.agentWorkbenchPages.roundActivitySummary(
                          round.executionCount,
                          round.facts.length,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        )}

        {showResultReceipt && (
          <section
            className="border-b border-border-subtle py-4"
            data-testid="workbench-result-receipt"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  unresolvedCount > 0 ? "text-warning" : "text-success",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-medium text-foreground">
                    {t.agentWorkbenchPages.resultReceipt}
                  </h3>
                  <span className="ml-auto text-micro text-muted-foreground">
                    {runActive
                      ? t.agentWorkbenchPages.statusRunning
                      : unresolvedCount > 0
                        ? t.agentWorkbenchPages.statusError
                        : t.agentWorkbenchPages.statusDone}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {!terminalState && recoveredCount > 0 && unresolvedCount === 0
                    ? `任务已交付，运行中有 ${recoveredCount} 项步骤警告。正文与成果仍可阅读；下方保留来源和运行记录供核对。`
                    : t.agentWorkbenchPages.resultReceiptDescription}
                </p>
                {latestAttention?.subtitle && (
                  <p className="mt-2 rounded-md border border-warning/20 bg-warning/5 px-2.5 py-2 text-xs leading-5 text-warning-foreground">
                    <span className="font-medium">
                      {t.agentWorkbenchPages.errorLabel}
                    </span>{" "}
                    {latestAttention.subtitle}
                  </p>
                )}
                {!latestAttention && latestRecovery?.subtitle && (
                  <p className="mt-2 rounded-md border border-success/15 bg-success/5 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
                    <span className="font-medium text-success">
                      {t.agentWorkbenchPages.recoveredOperations(1)}
                    </span>{" "}
                    {latestRecovery.subtitle}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        <CollaborationCollectorPanel
          events={collaborationEvents}
          threadId={threadId}
        />

        {/* 产物 */}
        {diffEntries.length > 0 && (
          <section className="border-b border-border-subtle py-4">
            <button
              type="button"
              aria-expanded={expandedSections.has("artifacts")}
              onClick={() => toggleSection("artifacts")}
              className="flex w-full items-center gap-2 text-left transition-colors hover:text-foreground"
            >
              <h3 className="text-xs font-medium text-foreground">
                {t.agentWorkbenchPages.artifacts}
              </h3>
              <span className="ml-auto text-xs text-muted-foreground">
                {artifactDiffEntries.length > 0
                  ? `${t.agentWorkbenchPages.generatedArtifacts} ${artifactDiffEntries.length}`
                  : ""}
                {artifactDiffEntries.length > 0 && changedFileEntries.length > 0
                  ? " · "
                  : ""}
                {changedFileEntries.length > 0
                  ? `${t.agentWorkbenchPages.changedFiles} ${changedFileEntries.length}`
                  : ""}
              </span>
              {expandedSections.has("artifacts") ? (
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="size-3.5 text-muted-foreground" />
              )}
            </button>
            {expandedSections.has("artifacts") && (
              <div className="mt-3">
                {artifactDiffEntries.length > 0 && (
                  <>
                    <div className="sr-only">
                      {t.agentWorkbenchPages.generatedArtifacts}
                    </div>
                    <SummaryDiffEntryList
                      entries={artifactDiffEntries}
                      kind="artifact"
                      onOpenEntry={openDiffEntry}
                    />
                  </>
                )}
                {changedFileEntries.length > 0 && (
                  <>
                    <div
                      className={cn(
                        "mb-1 mt-3 flex items-center gap-1.5",
                        artifactDiffEntries.length > 0 &&
                          "border-t border-border-subtle pt-3",
                      )}
                    >
                      <span className="text-xs font-medium text-foreground">
                        {t.agentWorkbenchPages.changedFiles}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {changedFileEntries.length}
                      </span>
                    </div>
                    <SummaryDiffEntryList
                      entries={changedFileEntries}
                      kind="change"
                      onOpenEntry={openDiffEntry}
                    />
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {/* 子智能体 */}
        {agentTiles.length > 0 && (
          <section className="border-b border-border-subtle py-4">
            <button
              type="button"
              aria-expanded={expandedSections.has("subagents")}
              onClick={() => toggleSection("subagents")}
              className="flex w-full items-center gap-2 text-left transition-colors hover:text-foreground"
            >
              <h3 className="text-xs font-medium text-foreground">
                {t.agentWorkbenchPages.subagents}
              </h3>
              <span className="ml-auto text-xs text-muted-foreground">
                {settledAgentSummary}
              </span>
              {expandedSections.has("subagents") ? (
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="size-3.5 text-muted-foreground" />
              )}
            </button>
            {expandedSections.has("subagents") ? (
              <div className="mt-3">
                <div
                  className={cn(
                    "pb-2 text-xs",
                    agentHealth.failed > 0 && "text-destructive",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <BrainCircuitIcon
                      className={cn(
                        "size-3.5 shrink-0",
                        agentHealth.failed > 0
                          ? "text-destructive"
                          : "text-success",
                      )}
                    />
                    <span className="font-medium text-foreground">
                      {settledAgentSummary}
                    </span>
                    {agentHealth.failed > 0 && (
                      <span className="font-medium text-destructive">
                        {t.agentWorkbenchPages.subagentsFailed(
                          agentHealth.failed,
                        )}
                      </span>
                    )}
                    {agentHealth.running > 0 && (
                      <span className="text-muted-foreground">
                        {t.agentWorkbenchPages.subagentsRunning(
                          agentHealth.running,
                        )}
                      </span>
                    )}
                    {agentHealth.pending > 0 && (
                      <span className="text-muted-foreground">
                        {t.agentWorkbenchPages.subagentsPending(
                          agentHealth.pending,
                        )}
                      </span>
                    )}
                  </div>
                  {agentHealth.failedLabels.length > 0 && (
                    <div className="mt-1 line-clamp-2 text-destructive/90">
                      {t.agentWorkbenchPages.failedLanes(
                        agentHealth.failedLabels.join(" / "),
                      )}
                    </div>
                  )}
                </div>
                <ul className="space-y-3">
                  {agentTiles.map((tile) => (
                    <SummaryAgentRow key={tile.id} tile={tile} />
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">
                {agentHealth.running > 0
                  ? t.agentWorkbenchPages.subagentsRunning(agentHealth.running)
                  : agentHealth.failed > 0
                    ? t.agentWorkbenchPages.subagentsFailed(agentHealth.failed)
                    : settledAgentSummary}
              </div>
            )}
          </section>
        )}

        {/* 参考资料（只展示本轮事件流里可确认的内容） */}
        {totalReferenceItems > 0 && (
          <section className="py-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-expanded={expandedSections.has("references")}
                onClick={() => toggleSection("references")}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-foreground"
              >
                <h3 className="text-xs font-medium text-foreground">
                  {t.agentWorkbenchPages.context}
                </h3>
                {expandedSections.has("references") ? (
                  <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <span
                    role="img"
                    tabIndex={0}
                    aria-label={t.agentWorkbenchPages.contextDescription}
                    className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <InfoIcon className="size-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="start">
                  {t.agentWorkbenchPages.contextDescription}
                </TooltipContent>
              </Tooltip>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {t.agentWorkbenchPages.sourceCount(totalReferenceItems)}
              </span>
            </div>
            {expandedSections.has("references") && (
              <div className="mt-3">
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {observedReferenceTabs.length === 0 ? (
                      <span className="text-muted-foreground">
                        {t.agentWorkbenchPages.noSources}
                      </span>
                    ) : (
                      observedReferenceTabs.map((tab) => {
                        const meta = OBSERVED_REFERENCE_META[tab.id];
                        const isActive = activeRefTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            aria-label={t.agentWorkbenchPages.sourceCountWithLabel(
                              tab.label,
                              tab.items.length,
                            )}
                            onClick={() => setRefTab(tab.id)}
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1.5 border-b pb-1 transition-colors",
                              isActive
                                ? "border-foreground/70 font-medium text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block size-2 rounded-sm transition-all",
                                meta.dotClassName,
                              )}
                            />
                            <span>{tab.label}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
                {/* 参考资料列表 */}
                <ul
                  data-testid="workbench-reference-list"
                  className="mt-2 space-y-1 overflow-x-hidden pr-0.5"
                >
                  {observedReferenceTabs.length === 0 ? (
                    <li className="py-4 text-center text-xs text-muted-foreground">
                      {t.agentWorkbenchPages.noObservableReferences}
                    </li>
                  ) : (
                    activeRefItems.map((ref) => {
                      const row = (
                        <>
                          <ReferenceIcon
                            fallbackClassName={activeRefMeta.iconClassName}
                            Icon={ActiveRefIcon}
                            item={ref}
                            tabId={activeRefTab}
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-foreground">
                              {ref.title}
                            </span>
                          </div>
                          {ref.tag && (
                            <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">
                              {ref.tag}
                            </span>
                          )}
                          {ref.url && (
                            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-muted-foreground" />
                          )}
                        </>
                      );

                      return (
                        <li key={ref.id}>
                          {ref.url ? (
                            <RoutedWebLink
                              href={ref.url}
                              openTargetSource="agent-reference"
                              title={ref.subtitle || ref.url}
                              className="group -mx-1 flex min-h-9 items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              {row}
                            </RoutedWebLink>
                          ) : (
                            <div className="-mx-1 flex min-h-9 items-center gap-3 px-1 py-1.5">
                              {row}
                            </div>
                          )}
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* 空状态 */}
        {isCompletelyEmpty && (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <BotIcon className="mb-2 size-8 text-muted-foreground" />
            <p className="text-xs font-medium text-foreground">
              {t.agentWorkbenchPages.dashboardOverview}
            </p>
            <p className="mt-1 max-w-[var(--text-truncate-xl)] text-xs text-muted-foreground">
              {t.agentWorkbenchPages.dashboardOverviewDescription}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
