import {
  ChevronRightIcon,
  FolderKanbanIcon,
  GlobeIcon,
  PackageIcon,
  PanelsTopLeftIcon,
  TerminalIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useI18n } from "@/core/i18n/hooks";
import { useQuery } from "@tanstack/react-query";
import { coordinationRequest, type CoordinationSnapshot } from "@/core/cowork/coordination";
import { mergeCoordinatedAgents } from "./agent-workbench-panel/coordinated-agents";
import type { OutlineRound } from "@/core/threads/progress-outline";
import type { GroundingSource } from "@/core/realtime/items";
import { TerminalPanel } from "@/components/workspace/terminal-panel";
import { ToolEffectDetailPanel } from "@/components/workspace/tool-effect-detail-panel";
import type {
  AgentWorkbenchEventView,
  AgentWorkbenchFocusAgentSnapshot,
  AgentWorkbenchProcessEventSnapshot,
  AgentWorkbenchProcessEventKind,
} from "./agent-workbench-events";
import type { LiveToolEvent } from "./live-tool-timeline";
import { cn } from "@/lib/utils";
import { CoworkSearchMenu } from "./cowork-collab-bar";
import { CollaborationDeliveryRecovery } from "./collaboration-delivery-recovery";
import type { ExtractedCodeBlocks } from "@/lib/extract-code-blocks";
import type { AgentWorkbenchTabId } from "./agent-workbench-utils";
import { useAgentWorkbenchI18n } from "./use-agent-workbench-i18n";
import { AgentDiffPage } from "./agent-workbench-pages";
import { useAgentWorkbenchSnapshot } from "./agent-workbench-snapshot";
import { deriveAgentPhases, type AgentPhase } from "./agent-phases";
import { type AgentRunState, workbenchRunState } from "./agent-run-status";
import { MachineScopeRail } from "./agent-workbench-panel/machine-scope-rail";
import { EmptyShellView } from "./agent-workbench-panel/empty-shell-view";
import {
  WorkbenchTabHeader,
  type WorkbenchTab,
} from "./agent-workbench-panel/workbench-tab-header";
import { BrowserTabPage } from "./agent-workbench-panel/browser-tab-page";
import { PersonaWorkbenchHome } from "./agent-workbench-panel/persona-workbench-home";
import { AgentKanbanView } from "./agent-workbench-panel/agent-kanban-view";
import {
  ProjectOsTab,
  ProjectOsTabError,
  ProjectOsTabLoading,
  useBoundProjectState,
} from "./agent-workbench-panel/project-os-tab";
import type { WorkbenchRosterSeat } from "./agent-workbench-panel/helpers";
import { useWorkbenchSelection } from "./agent-workbench-panel/use-workbench-selection";
import { ArtifactInlinePreviewEmbedded } from "./agent-workbench-panel/artifact-inline-preview";
import { WorkbenchSnapshotCache } from "@/core/cache/workbench-snapshot-cache";
import { workspacePresetForAgent } from "@/core/workspace/workspace-presets";

// Re-export items that were exported from the original file
export { hasAgentWorkbenchContent, __testing } from "./agent-workbench-utils";
export type { AgentWorkbenchTabId } from "./agent-workbench-utils";
export { workspaceFocusTabFromEvents } from "./agent-workbench-utils";
export { PreviewPane } from "./agent-workbench-panel/artifact-inline-preview";
export type { WorkbenchRosterSeat } from "./agent-workbench-panel/helpers";

function AgentWorkbenchPanelImpl({
  activeTab,
  events,
  progressOutline,
  userInput,
  groundingSources,
  focusedAgentId,
  focusedAgentView,
  focusedAgentSnapshot,
  focusedAgentNonce,
  focusedEventId,
  focusedEventKind,
  focusedEventView,
  focusedEventNonce,
  focusedProcessEvent,
  focusedEffectKey,
  hasAnswer,
  isLoading,
  onSelectTab,
  onClose,
  onOpenArtifact,
  onInvitePeople,
  onProjectCommand,
  runSettled,
  runFailed,
  runInterrupted,
  runBlocked,
  paused,
  className,
  threadId,
  workDir,
  browserPreviewBlocks,
  resultPreviewUrl,
  mainAgentName,
  contextTokens,
  maxContextTokens,
  isCompressingContext,
  onCompressContext,
  rosterSeats = [],
  groupTitle,
  currentThreadTitle,
  personaId,
  showMachineScopeRail = true,
  showMachineRosterRail = true,
  showDeliveryRecovery = false,
  hideMainOverview = false,
}: {
  activeTab?: AgentWorkbenchTabId;
  /** Chat owns task progress; the header menu owns sources. */
  hideMainOverview?: boolean;
  events: LiveToolEvent[];
  /** 「进展」面板的叙事大纲（按 iteration 分组）；缺省时回退为 phase 平铺。 */
  progressOutline?: OutlineRound[];
  userInput?: {
    text: string;
    uploadedFiles: Array<{ filename: string; path: string }>;
    attachments: Array<{ filename: string }>;
  } | null;
  /** Sources the runtime actually injected into this turn before tool use. */
  groundingSources?: GroundingSource[];
  focusedAgentId?: string | null;
  /** Which activity view a focusedAgentId intent lands on; defaults to the
   * live computer screen when the caller doesn't say. Legacy "role" intents
   * are treated as the execution screen: role details now live in the avatar
   * profile card rather than the right workbench. */
  focusedAgentView?: "summary" | "screen" | "role" | null;
  /** Public fallback used when a historical chat card no longer belongs to
   * the latest-turn event snapshot shown by the workbench. */
  focusedAgentSnapshot?: AgentWorkbenchFocusAgentSnapshot | null;
  /** Bumped by the parent on every focus emission. Without it, a second
   * intent for the same agent (e.g. 查看过程 then 查看电脑 on one row) would be
   * swallowed by the consume-once guard below. */
  focusedAgentNonce?: number;
  /** One-shot transcript navigation intent for an exact process event. */
  focusedEventId?: string | null;
  focusedEventKind?: AgentWorkbenchProcessEventKind | null;
  focusedEventView?: AgentWorkbenchEventView | null;
  focusedEventNonce?: number;
  focusedProcessEvent?: AgentWorkbenchProcessEventSnapshot | null;
  /** Durable effect receipt selected from the transcript timeline. */
  focusedEffectKey?: string | null;
  hasAnswer?: boolean;
  /** A turn is in flight. The panel is otherwise driven purely by tool
   * events, so between "turn started" and "first tool ran" it has no
   * blocks and would claim nothing is running — which is false, and is
   * exactly the window a user stares at the panel waiting for signs of
   * life. Knowing the turn is live lets the empty shell say so. */
  isLoading?: boolean;
  onSelectTab?: (tab: AgentWorkbenchTabId) => void;
  onClose?: () => void;
  /** Opens a generated artifact in the artifacts side panel (path comes from
   * the summary page's artifact rows). */
  onOpenArtifact?: (path: string) => void;
  /** Opens the human-member invitation flow for the linked group room. */
  onInvitePeople?: () => void | Promise<void>;
  onProjectCommand?: (command: string) => void;
  runSettled?: boolean;
  runFailed?: boolean;
  runInterrupted?: boolean;
  runBlocked?: boolean;
  threadId?: string | null;
  workDir?: string;
  paused?: boolean;
  className?: string;
  browserPreviewBlocks?: ExtractedCodeBlocks | null;
  /** Deployed preview URL (vercel/netlify/localhost). When set, the browser
   * tab renders the live deployed site via BrowserPreviewPanel instead of
   * falling back to inline srcDoc. */
  resultPreviewUrl?: string | null;
  /** Public identity shown above the main-agent evidence surface. */
  mainAgentName?: string | null;
  /** Persona that owns this conversation and its workspace preset. */
  personaId?: string | null;
  /** Current conversation-window usage, shared with the composer. */
  contextTokens?: number;
  maxContextTokens?: number;
  isCompressingContext?: boolean;
  onCompressContext?: () => void | Promise<void>;
  rosterSeats?: WorkbenchRosterSeat[];
  /** Current group-room title, used to collapse a duplicated project heading. */
  groupTitle?: string | null;
  /** Current conversation title when no distinct group title is available. */
  currentThreadTitle?: string | null;
  /** Whether to render the legacy machine switcher at the bottom of the
   * workbench. Group conversations expose the same agents beside the composer,
   * so callers can remove the duplicate switcher entirely. */
  showMachineScopeRail?: boolean;
  /** Team-member avatars can be hosted below the composer. Runtime-spawned
   * machine seats remain in the workbench rail either way. */
  showMachineRosterRail?: boolean;
  /** Group-only reliable delivery monitor. Solo chats do not poll this API. */
  showDeliveryRecovery?: boolean;
}) {
  const { t } = useI18n();
  const { deriveAgentTiles, workbenchStatus } = useAgentWorkbenchI18n();

  // IndexedDB 缓存实例（跨刷新持久化）
  const snapshotCacheRef = useRef<WorkbenchSnapshotCache | null>(null);
  const [cachedSnapshot, setCachedSnapshot] = useState<ReturnType<
    typeof useAgentWorkbenchSnapshot
  > | null>(null);
  const enableCache =
    typeof window !== "undefined" &&
    localStorage.getItem("echo:cache-workbench") === "1";

  // 初始化缓存
  useEffect(() => {
    if (enableCache && !snapshotCacheRef.current) {
      snapshotCacheRef.current = new WorkbenchSnapshotCache();
    }
  }, [enableCache]);

  // 页面加载时尝试从缓存恢复
  useEffect(() => {
    if (!enableCache || !threadId || cachedSnapshot) return;

    const restoreFromCache = async () => {
      try {
        // 使用最后一个事件的时间戳作为 turnId
        const lastEvent = events[events.length - 1];
        if (!lastEvent) return;

        const turnId = `turn_${lastEvent.startedAt}`;
        const cached = await snapshotCacheRef.current?.load(threadId, turnId);
        if (cached) {
          setCachedSnapshot(cached.snapshot);
        }
      } catch (error) {
        console.warn("[WorkbenchCache] Failed to restore from cache:", error);
      }
    };

    void restoreFromCache();
  }, [enableCache, threadId, events, cachedSnapshot]);

  const workbenchSnapshot = useAgentWorkbenchSnapshot(events, {
    deriveAgentTiles,
    hasAnswer,
    isLoading,
    runSettled,
    runFailed,
    paused,
    workDir,
  });

  // 如果缓存快照可用且事件匹配，优先使用缓存
  const activeSnapshot = useMemo(() => {
    if (
      cachedSnapshot &&
      cachedSnapshot.fingerprint === workbenchSnapshot.fingerprint
    ) {
      return cachedSnapshot;
    }
    return workbenchSnapshot;
  }, [cachedSnapshot, workbenchSnapshot]);

  // 快照更新时保存到缓存
  useEffect(() => {
    if (!enableCache || !threadId || !workbenchSnapshot) return;

    const saveToCache = async () => {
      try {
        // 使用最后一个事件的时间戳作为 turnId
        const lastEvent = events[events.length - 1];
        if (!lastEvent) return;

        const turnId = `turn_${lastEvent.startedAt}`;
        await snapshotCacheRef.current?.save(
          threadId,
          turnId,
          workbenchSnapshot,
          events,
        );
      } catch (error) {
        console.warn("[WorkbenchCache] Failed to save to cache:", error);
      }
    };

    // 防抖保存，避免频繁写入
    const timer = setTimeout(() => void saveToCache(), 500);
    return () => clearTimeout(timer);
  }, [enableCache, threadId, workbenchSnapshot, events]);

  const {
    agentTiles: eventAgentTiles,
    blocks,
    currentPhase: snapshotCurrentPhase,
    focusedTab,
    inferredWorkDir,
    phases: snapshotPhases,
    visibleDiffEntries,
    evidence,
  } = activeSnapshot;
  const coordination = useQuery({
    queryKey: ["coordination", threadId],
    queryFn: () => coordinationRequest<CoordinationSnapshot>(threadId!),
    enabled: Boolean(showDeliveryRecovery && threadId && threadId !== "new"),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const agentTiles = useMemo(() => mergeCoordinatedAgents(eventAgentTiles, coordination.data?.tasks ?? []), [eventAgentTiles, coordination.data?.tasks]);
  const typedGroundingSources = useMemo<GroundingSource[]>(
    () =>
      evidence
        .filter((item) => item.kind === "file" && Boolean(item.uri?.trim()))
        .map((item) => ({
          kind: "source",
          title: item.title,
          path: item.uri!.trim(),
        })),
    [evidence],
  );
  const effectiveGroundingSources = useMemo(() => {
    const seen = new Set<string>();
    return [...typedGroundingSources, ...(groundingSources ?? [])].filter(
      (source) => {
        const key = `${source.kind}:${source.path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      },
    );
  }, [groundingSources, typedGroundingSources]);
  // Keep visibility traces available for the workbench, while the kanban view
  // surfaces only decisions that explicitly require user attention.
  const visibilityEvents = useMemo(
    () => events.filter((event) => event.name === "visibility"),
    [events],
  );

  // Directly derive phases from raw events (same logic as composer-step-progress)
  // to ensure workbench always shows task plan when expanded, regardless of
  // whether server snapshot has been populated or survived a refresh/interrupt.
  const directDerived = useMemo(
    () =>
      deriveAgentPhases(events, { hasAnswer, runSettled, runFailed, paused }),
    [events, hasAnswer, runSettled, runFailed, paused],
  );
  const hasTerminalAgentFailure = agentTiles.some(
    (agent) => agent.status === "error",
  );
  const phases = useMemo<AgentPhase[]>(() => {
    const source =
      snapshotPhases.length > 0 ? snapshotPhases : directDerived.phases;
    if (!runSettled || runFailed || paused) return source;
    // A replayed snapshot can preserve its last in-flight phase even though
    // the owning turn has a terminal answer. The terminal run signal is more
    // authoritative than that stale progress frame.
    return source.map((phase) =>
      phase.status === "running" ||
      phase.status === "waiting_approval" ||
      (phase.status === "error" && !hasTerminalAgentFailure)
        ? { ...phase, status: "done" as const }
        : phase,
    );
  }, [
    snapshotPhases,
    directDerived.phases,
    paused,
    runFailed,
    runSettled,
    hasTerminalAgentFailure,
  ]);
  const currentPhase =
    phases.find((phase) => phase.status === "waiting_approval") ??
    phases.find((phase) => phase.status === "running") ??
    snapshotCurrentPhase ??
    directDerived.currentPhase;

  const {
    selectedEffectKey,
    setSelectedEffectKey,
    setActivityView,
    selectedAgent,
    screenBlocks,
    mainBlocks,
    mainPhases,
    screenFrame,
    visibleRosterSeats,
    leaderRosterSeat,
    selectedRosterSeat,
    openMainProcess,
    openSubagentProcess,
    openRosterProcess,
    setSelectedBlockId,
    setManualBlockSelection,
    activityView,
  } = useWorkbenchSelection({
    blocks,
    currentPhase,
    phases,
    agentTiles,
    focusedAgentId,
    focusedAgentView,
    focusedAgentSnapshot,
    focusedAgentNonce,
    focusedEventId,
    focusedEventKind,
    focusedEventView,
    focusedEventNonce,
    focusedEffectKey,
    rosterSeats,
    onSelectTab,
  });

  // Optional surfaces start unchecked; opening or focusing one reveals its tab.
  const [closedTabs, setClosedTabs] = useState<Set<AgentWorkbenchTabId>>(
    () =>
      new Set<AgentWorkbenchTabId>([
        "workspace",
        "browser",
        "artifacts",
        "project",
        "diff",
        "terminal",
      ]),
  );
  // Browser tab source: while the run streams, the inline srcDoc blocks are
  // the freshest view; once the run settles a deployed URL wins. The override
  // lets the user flip between the two when both exist.
  const [browserSourceOverride, setBrowserSourceOverride] = useState<
    "deployed" | "inline" | null
  >(null);

  useEffect(() => {
    if (!onClose) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase();
        if (
          target.isContentEditable ||
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select"
        ) {
          return;
        }
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Project OS binding: fetch the project bound to this thread so the
  // workbench can surface a "项目" tab with live milestones / PM console.
  const projectOsQuery = useBoundProjectState(threadId);
  const boundProject = projectOsQuery.data;
  const hasBoundProject = !!boundProject;

  const emptyShell =
    blocks.length === 0 &&
    agentTiles.length === 0 &&
    !selectedAgent &&
    visibleRosterSeats.length === 0 &&
    (progressOutline?.length ?? 0) === 0;
  const coworkResponseOnly =
    agentTiles.length > 0 &&
    agentTiles.every((agent) => agent.role === "cowork");
  const mainRunStatus = workbenchStatus(mainBlocks, mainPhases, {
    settled: runSettled && !(emptyShell && !hasAnswer),
    failed: runFailed,
    interrupted: runInterrupted,
    blocked: runBlocked,
    responded: coworkResponseOnly,
  });
  const mainRunState: AgentRunState = runFailed
    ? "error"
    : runInterrupted || runBlocked
      ? "waiting"
      : isLoading
        ? "running"
        : runSettled && !(emptyShell && !hasAnswer)
          ? "done"
          : workbenchRunState({
              blocks: mainBlocks,
              phases: mainPhases,
              paused,
            });
  const machineRail = showMachineScopeRail ? (
    <MachineScopeRail
      agents={agentTiles}
      leaderSeat={showMachineRosterRail ? leaderRosterSeat : null}
      mainRunState={mainRunState}
      rosterSeats={showMachineRosterRail ? visibleRosterSeats : []}
      selectedAgentId={selectedAgent?.id ?? selectedRosterSeat?.id ?? null}
      onSelectMain={openMainProcess}
      onSelectAgent={openSubagentProcess}
      onSelectRoster={openRosterProcess}
    />
  ) : null;
  const requestedActiveTab: AgentWorkbenchTabId =
    activeTab ?? (focusedAgentId ? "agent" : focusedTab) ?? "agent";
  // Keep an explicitly requested project surface mounted while its binding is
  // loading (or temporarily failed) so users see a truthful state instead of
  // being silently bounced to the agent tab. Background lookups still avoid a
  // transient project-tab flash for ordinary, unbound conversations.
  const projectTabVisible =
    hasBoundProject ||
    (requestedActiveTab === "project" &&
      (projectOsQuery.isLoading || projectOsQuery.isError));
  const mergeProjectHome = projectTabVisible && workspacePresetForAgent(personaId).workbench === "office";
  const isDevelopmentWorkbench = workspacePresetForAgent(personaId).workbench === "development";
  const normalizedActiveTab:
    | "agent"
    | "diff"
    | "terminal"
    | "browser"
    | "artifacts"
    | "workspace"
    | "project" =
    requestedActiveTab === "workspace" && mergeProjectHome
      ? "project"
      : requestedActiveTab === "subagents" ||
    requestedActiveTab === "plan" ||
    requestedActiveTab === "design"
      ? "agent"
      : requestedActiveTab === "project" && !projectTabVisible
        ? "agent"
        : requestedActiveTab;
  const effectiveActiveTab =
    isDevelopmentWorkbench && normalizedActiveTab === "workspace"
      ? "diff"
      : hideMainOverview &&
    normalizedActiveTab === "agent" &&
    !selectedAgent &&
    !selectedRosterSeat &&
    !selectedEffectKey
      ? (mergeProjectHome ? "project" : isDevelopmentWorkbench ? "diff" : "workspace")
      : normalizedActiveTab;
  const workbenchTabs: WorkbenchTab[] = useMemo(
    () => [
      ...(mergeProjectHome ? [{
        id: "project" as const,
        label: t.agentWorkbenchPages.projectTab,
        Icon: FolderKanbanIcon,
      }] : isDevelopmentWorkbench ? [] : [{
        id: "workspace" as const,
        label: workspacePresetForAgent(personaId).workbenchLabel,
        Icon: PanelsTopLeftIcon,
      }]),
      {
        id: "diff",
        label: t.agentWorkbenchPages.diffTab,
        Icon: ChevronRightIcon,
      },
      {
        id: "terminal",
        label: t.agentWorkbenchPages.terminalTab,
        Icon: TerminalIcon,
      },
      {
        id: "browser",
        label: t.agentWorkbenchPages.browserTab,
        Icon: GlobeIcon,
      },
      {
        id: "artifacts",
        label: t.conversation.artifactsTitle,
        Icon: PackageIcon,
      },
      ...(projectTabVisible && !mergeProjectHome
        ? [
            {
              id: "project" as const,
              label: t.agentWorkbenchPages.projectTab,
              Icon: FolderKanbanIcon,
            },
          ]
        : []),
    ],
    [t.agentWorkbenchPages, t.conversation, projectTabVisible, personaId, mergeProjectHome, isDevelopmentWorkbench],
  );

  // Auto-open a tab if it becomes the effective active tab
  useEffect(() => {
    if (closedTabs.has(effectiveActiveTab)) {
      setClosedTabs((prev) => {
        const next = new Set(prev);
        next.delete(effectiveActiveTab);
        return next;
      });
    }
  }, [effectiveActiveTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCloseTab = useCallback(
    (tabId: AgentWorkbenchTabId) => {
      setClosedTabs((prev) => {
        const next = new Set(prev);
        next.add(tabId);
        return next;
      });
      if (effectiveActiveTab === tabId) {
        onSelectTab?.("agent");
      }
    },
    [effectiveActiveTab, onSelectTab],
  );

  const handleOpenTab = useCallback(
    (tabId: AgentWorkbenchTabId) => {
      setClosedTabs((prev) => {
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
      onSelectTab?.(tabId);
    },
    [onSelectTab],
  );

  const visibleTabs = useMemo(
    () => workbenchTabs.filter((tab) => !closedTabs.has(tab.id)),
    [workbenchTabs, closedTabs],
  );
  const inferredWorkspaceLabel = inferredWorkDir
    ?.split(/[\\/]/)
    .filter(Boolean)
    .pop();
  const workspaceLabel =
    !inferredWorkspaceLabel || inferredWorkspaceLabel === threadId
      ? t.agentWorkbenchPanel.mainComputer
      : inferredWorkspaceLabel;

  // Browser tab content, shared by the empty shell and the main render path.
  const canShowDeployedPreview = Boolean(resultPreviewUrl);
  const canShowInlinePreview = Boolean(browserPreviewBlocks);
  const autoBrowserSource: "deployed" | "inline" | "session" =
    canShowDeployedPreview && (runSettled || !canShowInlinePreview)
      ? "deployed"
      : canShowInlinePreview
        ? "inline"
        : canShowDeployedPreview
          ? "deployed"
          : "session";
  const browserPreviewSource =
    (browserSourceOverride === "deployed" && canShowDeployedPreview) ||
    (browserSourceOverride === "inline" && canShowInlinePreview)
      ? browserSourceOverride
      : autoBrowserSource;
  const browserTabPage = (
    <BrowserTabPage
      canShowDeployedPreview={canShowDeployedPreview}
      canShowInlinePreview={canShowInlinePreview}
      browserPreviewSource={browserPreviewSource}
      setBrowserSourceOverride={setBrowserSourceOverride}
      resultPreviewUrl={resultPreviewUrl}
      threadId={threadId}
      inferredWorkDir={inferredWorkDir}
      browserPreviewBlocks={browserPreviewBlocks}
    />
  );
  const personaWorkbenchPage = <PersonaWorkbenchHome personaId={personaId} />;
  // The main conversation owns the global execution narrative. A selected
  // sub-agent may still open its own computer: a complete, isolated streaming
  // conversation rather than a duplicate mixed activity trace.
  const effectiveActivityView: "summary" | "screen" =
    selectedAgent && activityView === "screen" ? "screen" : "summary";

  // Workbench view: summary / computer view.
  if (
    emptyShell &&
    effectiveActiveTab !== "project" &&
    !selectedEffectKey &&
    !focusedProcessEvent
  ) {
    return (
      <EmptyShellView
        mainButton={{
          active: effectiveActiveTab === "agent",
          label: isLoading
            ? t.agentWorkbenchPanel.agentStatusRunning
            : mainRunStatus.label,
          onClick: openMainProcess,
          runState: mainRunState,
          title: isLoading
            ? t.agentWorkbenchPanel.startingRobotProcess
            : mainRunStatus.label,
        }}
        visibleTabs={visibleTabs}
        workbenchTabs={workbenchTabs}
        closedTabs={closedTabs}
        effectiveActiveTab={effectiveActiveTab}
        onTabClick={handleOpenTab}
        onTabClose={handleCloseTab}
        onClose={onClose}
        visibleDiffEntries={visibleDiffEntries}
        threadId={threadId}
        inferredWorkDir={inferredWorkDir}
        browserTabPage={browserTabPage}
        personaWorkbenchPage={personaWorkbenchPage}
        isLoading={isLoading}
        className={className}
        machineRail={machineRail}
      />
    );
  }

  const agentKanbanPage = (
    <AgentKanbanView
      effectiveActivityView={effectiveActivityView}
      selectedRosterSeat={selectedRosterSeat}
      selectedAgent={selectedAgent}
      screenBlocks={screenBlocks}
      currentScreenBlockId={screenFrame.block?.id ?? null}
      phases={phases}
      blocks={blocks}
      agentTiles={agentTiles}
      visibleDiffEntries={visibleDiffEntries}
      focusedProcessEvent={focusedProcessEvent ?? null}
      focusedEventId={focusedEventId}
      progressOutline={progressOutline}
      userInput={userInput ?? null}
      groundingSources={effectiveGroundingSources}
      preferStructuredReferences={evidence.length > 0}
      mainAgentName={mainAgentName}
      resultPreviewUrl={resultPreviewUrl}
      terminalState={
        runInterrupted
          ? "interrupted"
          : runFailed
            ? "failed"
            : runBlocked
              ? "blocked"
              : null
      }
      contextTokens={contextTokens}
      maxContextTokens={maxContextTokens}
      isCompressingContext={isCompressingContext}
      onCompressContext={onCompressContext}
      setActivityView={setActivityView}
      onSelectTab={onSelectTab}
      onOpenArtifact={onOpenArtifact}
      openMainProcess={openMainProcess}
      setSelectedBlockId={setSelectedBlockId}
      setManualBlockSelection={setManualBlockSelection}
      visibilityEvents={visibilityEvents}
      collaborationEvents={events}
      threadId={threadId ?? undefined}
    />
  );

  const effectiveEmbeddedPage =
    selectedEffectKey && effectiveActiveTab === "agent" ? (
      <ToolEffectDetailPanel
        effectKey={selectedEffectKey}
        onBack={() => setSelectedEffectKey(null)}
      />
    ) : effectiveActiveTab === "diff" ? (
      <AgentDiffPage entries={visibleDiffEntries} />
    ) : effectiveActiveTab === "terminal" ? (
      <TerminalPanel
        sessionId={`agent-workbench-${threadId ?? "local"}`}
        cwd={inferredWorkDir}
        className="min-h-0 flex-1"
      />
    ) : effectiveActiveTab === "browser" ? (
      browserTabPage
    ) : effectiveActiveTab === "workspace" ? (
      personaWorkbenchPage
    ) : effectiveActiveTab === "artifacts" && threadId ? (
      // Reuses the outer ArtifactsProvider (page-level) so the artifact list
      // synced from the backend stays visible. Wrapping in a fresh provider
      // here reset artifacts to [] and showed "暂无预览内容" for generated
      // outputs even though the files existed on disk.
      <ArtifactInlinePreviewEmbedded
        threadId={threadId}
        currentTurnEntries={visibleDiffEntries}
        runBlocked={runBlocked}
        runSettled={runSettled}
        isLoading={isLoading}
      />
    ) : effectiveActiveTab === "project" ? (
      boundProject ? (
        <ProjectOsTab
          state={boundProject}
          rosterSeats={rosterSeats}
          groupTitle={groupTitle}
          currentThreadTitle={currentThreadTitle}
          onOpenArtifact={onOpenArtifact}
          onInvitePeople={onInvitePeople}
          onProjectCommand={onProjectCommand}
          commandBusy={isLoading}
          onRefetch={() => {
            void projectOsQuery.refetch();
          }}
        />
      ) : projectOsQuery.isError ? (
        <ProjectOsTabError
          onRetry={() => {
            void projectOsQuery.refetch();
          }}
        />
      ) : (
        <ProjectOsTabLoading />
      )
    ) : (
      agentKanbanPage
    );

  return (
    <div
      className={cn(
        "flex size-full min-h-0 flex-col bg-[color:color-mix(in_oklab,var(--muted)_46%,var(--background))]",
        className,
      )}
    >
      <WorkbenchTabHeader
        actions={threadId && effectiveActiveTab !== "project" && effectiveActiveTab !== "workspace" ? <CoworkSearchMenu threadId={threadId} /> : null}
        mainButton={{
          active:
            effectiveActiveTab === "agent" &&
            !selectedEffectKey &&
            !selectedAgent &&
            !selectedRosterSeat,
          label: mainRunStatus.label,
          onClick: openMainProcess,
          runState: mainRunState,
          title: t.agentWorkbenchPanel.viewMainAgentSlot,
        }}
        visibleTabs={visibleTabs}
        workbenchTabs={workbenchTabs}
        closedTabs={closedTabs}
        effectiveActiveTab={effectiveActiveTab}
        onTabClick={handleOpenTab}
        onTabClose={handleCloseTab}
        onClose={onClose}
        workspaceLabel={selectedAgent ? (selectedAgent.codename ?? selectedAgent.name) : workspaceLabel}
        showWorkspaceLabel
        mainRunStatusLabel={selectedAgent ? (selectedAgent.status === "running" ? t.agentWorkbenchPanel.agentStatusRunning : selectedAgent.status === "error" ? t.agentWorkbenchPanel.agentStatusError : selectedAgent.status) : mainRunStatus.label}
      />

      {threadId &&
      effectiveActiveTab !== "project" &&
      effectiveActiveTab !== "workspace" ? (
        <>
          {showDeliveryRecovery ? (
            <CollaborationDeliveryRecovery threadId={threadId} />
          ) : null}
        </>
      ) : null}

      <section
        aria-label={t.sidebar.ariaAgentWorkbench}
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background/70"
      >
        {effectiveEmbeddedPage}
      </section>
      {effectiveActiveTab === "project" || effectiveActiveTab === "workspace"
        ? null
        : machineRail}
    </div>
  );
}

export const AgentWorkbenchPanel = memo(AgentWorkbenchPanelImpl);
