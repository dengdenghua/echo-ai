import type { ReactNode } from "react";
import { Settings2Icon } from "lucide-react";

import type { ProjectFullState } from "@/components/workspace/agent-workbench-panel/project-os-tab";
import { AssistantChannels } from "@/components/workspace/assistant-channels";
import { AssistantSettingsMenu } from "@/components/workspace/assistant-settings-menu";
import { ChatHeaderMenuButton } from "@/components/workspace/chat-header-menu-button";
import {
  countOnlineRoomParticipants,
  GroupHumanInviteButton,
} from "@/components/workspace/collab";
import { ChatHeaderAgentBadge } from "@/components/workspace/realtime/chat-header-agent-badge";
import { ChatHeaderRecButton } from "@/components/workspace/realtime/chat-header-rec-button";
import { executionRoster } from "@/components/workspace/realtime/execution-roster";
import { ProjectGroupHeaderBadge } from "@/components/workspace/realtime/project-group-header-badge";
import { PromoteGroupToProjectDialog } from "@/components/workspace/realtime/promote-group-to-project-dialog";
import type { RightPanelPage } from "@/components/workspace/realtime/right-panel-menu";
import {
  RealtimeChatHeaderActions,
  RealtimeChatHeaderMemberSurface,
  type RealtimeChatHeaderShareOptions,
} from "@/components/workspace/realtime/realtime-chat-header-controls";
import { RealtimeGroupHeaderLayout } from "@/components/workspace/realtime/realtime-group-header-layout";
import { TaskCollaboratorControl } from "@/components/workspace/realtime/task-collaborator-control";
import { RunDurationBadge } from "@/components/workspace/run-duration-badge";
import { ShareMenu } from "@/components/workspace/share-menu";
import type { TeamMode } from "@/components/workspace/team-mode-picker";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { WorkspaceContextMenu } from "@/components/workspace/workspace-context-menu";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Agent } from "@/core/agents";
import type { ChannelName } from "@/core/channels/api";
import type { ThreadCollaborationRosterEntry } from "@/core/collaboration/thread-collaboration";
import type { CollaborationSession, CoworkRoomEntityRef } from "@/core/cowork";
import type { StreamVitals } from "@/core/realtime";
import { cn } from "@/lib/utils";

import type { CollaborationProfile } from "./collaboration-roster-utils";
import { resolveActiveProjectMilestone } from "./page-utils";
import type {
  BoundProjectQuery,
  RealtimeThread,
  RealtimeToolEvents,
  StateSetter,
} from "./realtime-page-types";
import type { ConversationUserInput } from "./realtime-turn-utils";

const CHANNEL_DISPLAY_NAMES: Record<string, string> = {
  wechat: "微信",
  dingtalk: "钉钉",
  feishu: "飞书",
  wecom: "企业微信",
  telegram: "Telegram",
  slack: "Slack",
  discord: "Discord",
};

export interface RealtimeChatHeaderProps {
  threadId: string;
  thread: RealtimeThread;
  isNewThread: boolean;
  embeddedDesignChat: boolean;
  isEchoAssistant: boolean;
  privateConversation: boolean;
  isGroupConversation: boolean;
  perspectiveDisplayAgent: Agent | null;
  mainPerspectiveAgentId: string;
  headerThreadTitle: string | undefined;
  initialPrompt: string;
  collaborationTeamName: string;
  /** AI member picker, already gated on who may manage this conversation. */
  headerMemberControl: ReactNode;
  headerProjectStatus: ReactNode;
  /** The right-panel menu; hidden while a right-hand surface is open. */
  rightPanelMenu: ReactNode;
  activeRightPanel: RightPanelPage | null;
  recorderPluginEnabled: boolean;
  recIsRecording: boolean;
  setRecOverlayOpen: StateSetter<boolean>;
  setChatsDrawerOpen: StateSetter<boolean>;
  boundProjectState: ProjectFullState | null | undefined;
  boundProjectQuery: BoundProjectQuery;
  openProjectWorkbenchForEntity: (entity?: CoworkRoomEntityRef) => void;
  canPromoteGroupToProject: boolean;
  promoteGroupDialogOpen: boolean;
  setPromoteGroupDialogOpen: StateSetter<boolean>;
  projectDetachDialog: ReactNode;
  replayBlocks: readonly unknown[];
  handleExportReplay: () => void;
  isProjectCodeMode: boolean;
  effectiveWorkDir: string;
  agentDisplayEvents: RealtimeToolEvents;
  lastTurnUserInput: ConversationUserInput | null;
  onOpenDiff: () => void;
  openWorkbenchArtifact: (path: string) => void;
  connectedChannels: ChannelName[];
  showAutomationPanel: boolean;
  toggleAutomationPanel: () => void;
}

/**
 * The conversation header: one responsive group-style shell for every
 * non-Echo conversation, and the minimal single-chat header of the Assistant.
 */
export function RealtimeChatHeader({
  threadId,
  thread,
  isNewThread,
  embeddedDesignChat,
  isEchoAssistant,
  privateConversation,
  isGroupConversation,
  perspectiveDisplayAgent,
  mainPerspectiveAgentId,
  headerThreadTitle,
  initialPrompt,
  collaborationTeamName,
  headerMemberControl,
  headerProjectStatus,
  rightPanelMenu,
  activeRightPanel,
  recorderPluginEnabled,
  recIsRecording,
  setRecOverlayOpen,
  setChatsDrawerOpen,
  boundProjectState,
  boundProjectQuery,
  openProjectWorkbenchForEntity,
  canPromoteGroupToProject,
  promoteGroupDialogOpen,
  setPromoteGroupDialogOpen,
  projectDetachDialog,
  replayBlocks,
  handleExportReplay,
  isProjectCodeMode,
  effectiveWorkDir,
  agentDisplayEvents,
  lastTurnUserInput,
  onOpenDiff,
  openWorkbenchArtifact,
  connectedChannels,
  showAutomationPanel,
  toggleAutomationPanel,
}: RealtimeChatHeaderProps) {
  const headerTitle = !isEchoAssistant ? (
    <div className="flex min-w-0 items-center gap-2">
    {privateConversation && <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">与 {perspectiveDisplayAgent?.display_name || mainPerspectiveAgentId} 私聊</span>}
    <ThreadTitle
      threadId={threadId}
      thread={thread}
      title={headerThreadTitle}
      className={cn(
        "border-0 bg-transparent px-0 py-0 text-sm",
        isGroupConversation && "w-full max-w-full",
      )}
    />
    </div>
  ) : null;
  const headerRunStatus = (
    <RunDurationBadge
      isLoading={thread.isLoading}
      vitals={(thread as typeof thread & { vitals?: StreamVitals }).vitals}
    />
  );
  const headerRecorder =
    !isEchoAssistant && recorderPluginEnabled ? (
      <ChatHeaderRecButton
        threadId={threadId}
        onOpen={() => setRecOverlayOpen(true)}
        isRecording={recIsRecording}
      />
    ) : null;
  const headerShareTitle =
    boundProjectState?.project.name ||
    headerThreadTitle ||
    thread?.values?.title ||
    initialPrompt;
  const headerShareOptions: RealtimeChatHeaderShareOptions | undefined =
    headerShareTitle
      ? {
          title: headerShareTitle,
          prompt: initialPrompt || undefined,
          onExportReplay:
            replayBlocks.length > 0 ? handleExportReplay : undefined,
        }
      : undefined;
  // Open surfaces own their close control; the chat header only offers reopening.
  const headerWorkbench = activeRightPanel ? null : rightPanelMenu;
  const headerMemberSurface = !isEchoAssistant ? (
    <RealtimeChatHeaderMemberSurface aiMembers={headerMemberControl} />
  ) : null;
  const headerEnvironment = !isNewThread && !embeddedDesignChat ? (
    <WorkspaceContextMenu
      key={threadId}
      workDir={isProjectCodeMode ? effectiveWorkDir : null}
      events={agentDisplayEvents}
      userInput={lastTurnUserInput}
      groundingSources={thread.values.latest_grounding ?? []}
      onOpenDiff={onOpenDiff}
      onOpenFile={openWorkbenchArtifact}

    />
  ) : null;
  const headerActions = !isEchoAssistant ? (
    <RealtimeChatHeaderActions
      environment={headerEnvironment}
      recording={recorderPluginEnabled ? headerRecorder : null}
      workbench={headerWorkbench}
      share={
        headerShareOptions ? (
          <ShareMenu
            iconOnly
            threadId={threadId}
            title={headerShareOptions.title}
            prompt={headerShareOptions.prompt}
            summary={headerShareOptions.summary}
            footer={headerShareOptions.footer}
            onExportReplay={headerShareOptions.onExportReplay}
          />
        ) : null
      }
    />
  ) : null;

  return (
    <>
      {!embeddedDesignChat && !isEchoAssistant && (
        <ChatHeaderMenuButton
          onClick={() => setChatsDrawerOpen(true)}
          className="absolute left-3 top-1/2 -translate-y-1/2 md:hidden"
        />
      )}
      {!isEchoAssistant ? (
        <RealtimeGroupHeaderLayout
          title={headerTitle}
          projectStatus={headerProjectStatus}
          runStatus={headerRunStatus}
          members={
            embeddedDesignChat ? null : headerMemberSurface
          }
          workbench={embeddedDesignChat ? null : headerActions}
        />
      ) : (
        <RealtimeEchoAssistantHeader
          threadId={threadId}
          perspectiveDisplayAgent={perspectiveDisplayAgent}
          mainPerspectiveAgentId={mainPerspectiveAgentId}
          connectedChannels={connectedChannels}
          headerRunStatus={headerRunStatus}
          headerShareOptions={headerShareOptions}
          headerEnvironment={headerEnvironment}
          headerWorkbench={headerWorkbench}
          showAutomationPanel={showAutomationPanel}
          toggleAutomationPanel={toggleAutomationPanel}
        />
      )}
      {canPromoteGroupToProject ? (
        <PromoteGroupToProjectDialog
          open={promoteGroupDialogOpen}
          onOpenChange={setPromoteGroupDialogOpen}
          threadId={threadId}
          defaultName={headerThreadTitle || collaborationTeamName}
          onPromoted={async () => {
            await boundProjectQuery.refetch();
            openProjectWorkbenchForEntity();
          }}
        />
      ) : null}
      {projectDetachDialog}
    </>
  );
}

/** 助理是单聊：不提供加人/协作，也不录制，头部保持极简 */
function RealtimeEchoAssistantHeader({
  threadId,
  perspectiveDisplayAgent,
  mainPerspectiveAgentId,
  connectedChannels,
  headerRunStatus,
  headerShareOptions,
  headerEnvironment,
  headerWorkbench,
  showAutomationPanel,
  toggleAutomationPanel,
}: {
  threadId: string;
  perspectiveDisplayAgent: Agent | null;
  mainPerspectiveAgentId: string;
  connectedChannels: ChannelName[];
  headerRunStatus: ReactNode;
  headerShareOptions: RealtimeChatHeaderShareOptions | undefined;
  headerEnvironment: ReactNode;
  headerWorkbench: ReactNode;
  showAutomationPanel: boolean;
  toggleAutomationPanel: () => void;
}) {
  const headerAgentIdentity = (
    <ChatHeaderAgentBadge
      agent={perspectiveDisplayAgent}
      agentId={mainPerspectiveAgentId}
    />
  );
  const headerEchoShare = headerShareOptions ? (
    <ShareMenu
      iconOnly
      threadId={threadId}
      title={headerShareOptions.title}
      prompt={headerShareOptions.prompt}
      summary={headerShareOptions.summary}
      footer={headerShareOptions.footer}
      onExportReplay={headerShareOptions.onExportReplay}
    />
  ) : null;
  return (
    <>
      <SidebarTrigger className="size-9 shrink-0 md:hidden" />
      {headerAgentIdentity}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {connectedChannels.length > 0 && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span className="text-mini text-muted-foreground">
              已连接:{" "}
              {connectedChannels
                .map((c) => CHANNEL_DISPLAY_NAMES[c] || c)
                .join("、")}
            </span>
          </div>
        )}
        {headerRunStatus}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/* 助理是单聊：不提供加人/协作，也不录制，头部保持极简 */}
        {headerEchoShare}
        {headerEnvironment}
        <AssistantChannels />
        <Button
          type="button"
          aria-label="自动化与订阅"
          title="自动化与订阅"
          onClick={toggleAutomationPanel}
          className={cn(
            "flex size-[42px] items-center justify-center rounded-lg border shadow-none transition-all duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:size-8",
            showAutomationPanel
              ? "border-transparent bg-transparent text-foreground/82 hover:border-border-default hover:bg-muted/55 hover:text-foreground"
              : "border-transparent bg-transparent text-muted-foreground hover:border-border-default hover:bg-muted/55 hover:text-foreground",
          )}
        >
          <Settings2Icon className="size-4" />
        </Button>
        <AssistantSettingsMenu />
        {headerWorkbench}
      </div>
    </>
  );
}

interface RealtimeHeaderMemberControlProps {
  threadId: string;
  isNewThread: boolean;
  embeddedDesignChat: boolean;
  allTaskCollaboratorAgents: Agent[];
  selectedCollaborators: Agent[];
  selectedCollaboratorIds: string[];
  currentTaskAgentName: string;
  teamModeIntent: TeamMode;
  collaboratorPickerOpen: boolean;
  setCollaboratorPickerOpen: StateSetter<boolean>;
  handleSelectedCollaboratorIdsChange: (ids: string[]) => void;
  handleTeamModeIntentChange: (mode: TeamMode) => void;
  visibleCollaborationRoster: ThreadCollaborationRosterEntry[];
  lastTurnToolEvents: RealtimeToolEvents;
  coworkCollaborationProfiles: CollaborationProfile[];
  collabSession: CollaborationSession | undefined;
  resolvedHumanInviteRoomId: string;
  ensureHumanInviteRoom: () => Promise<string>;
  setHumanInviteRoomId: StateSetter<string>;
  humanInviteDialogOpen: boolean;
  setHumanInviteDialogOpen: StateSetter<boolean>;
  isEnsuringRoom: boolean;
  isSavingRoster: boolean;
}

/**
 * The AI member picker with its human-invite action. Built by the page only
 * for people who may manage this conversation's members.
 */
export function RealtimeHeaderMemberControl({
  threadId,
  isNewThread,
  embeddedDesignChat,
  allTaskCollaboratorAgents,
  selectedCollaborators,
  selectedCollaboratorIds,
  currentTaskAgentName,
  teamModeIntent,
  collaboratorPickerOpen,
  setCollaboratorPickerOpen,
  handleSelectedCollaboratorIdsChange,
  handleTeamModeIntentChange,
  visibleCollaborationRoster,
  lastTurnToolEvents,
  coworkCollaborationProfiles,
  collabSession,
  resolvedHumanInviteRoomId,
  ensureHumanInviteRoom,
  setHumanInviteRoomId,
  humanInviteDialogOpen,
  setHumanInviteDialogOpen,
  isEnsuringRoom,
  isSavingRoster,
}: RealtimeHeaderMemberControlProps) {
  const headerHumanInvite = (
    <GroupHumanInviteButton
      renderDialog={false}
      roomId={resolvedHumanInviteRoomId}
      threadId={threadId}
      onEnsureRoom={ensureHumanInviteRoom}
      onRoomResolved={setHumanInviteRoomId}
      open={humanInviteDialogOpen}
      onOpenChange={(open) => {
        setHumanInviteDialogOpen(open);
        if (open) setCollaboratorPickerOpen(false);
      }}
      size="sm"
      variant="ghost"
      className="w-full justify-start gap-2 px-2"
      disabled={isNewThread || isEnsuringRoom}
    />
  );
  const onlineCollaboratorCount = collabSession?.room_id
    ? countOnlineRoomParticipants(
        collabSession.room_participants ?? [],
      )
    : (collabSession?.presence.reduce(
        (count, member) => count + (member.online ? 1 : 0),
        0,
      ) ?? 0);
  const displayedExecutionRoster = executionRoster(
    visibleCollaborationRoster,
    embeddedDesignChat ? [] : lastTurnToolEvents,
    coworkCollaborationProfiles,
  );
  return (
    <TaskCollaboratorControl
      agents={allTaskCollaboratorAgents}
      selectedAgents={selectedCollaborators}
      selectedAgentIds={selectedCollaboratorIds}
      currentAgentName={currentTaskAgentName}
      teamMode={teamModeIntent}
      open={collaboratorPickerOpen}
      onOpenChange={setCollaboratorPickerOpen}
      onSelectedAgentIdsChange={handleSelectedCollaboratorIdsChange}
      onTeamModeChange={handleTeamModeIntentChange}
      roster={displayedExecutionRoster.members}
      onlineCount={onlineCollaboratorCount}
      humanInviteAction={headerHumanInvite}
      onOpenCoordination={!isNewThread ? () => window.dispatchEvent(new CustomEvent("echo:open-coordination", { detail: { threadId } })) : undefined}
      labelPrefix="AI"
      disabled={isSavingRoster}
    />
  );
}

/** The bound project's status chip in the group header. */
export function RealtimeProjectStatusBadge({
  boundProjectState,
  defaultProjectMilestoneId,
  canManageHumanInvites,
  isDetaching,
  openProjectWorkbenchForEntity,
  handleDetachProjectCapability,
}: {
  boundProjectState: ProjectFullState;
  defaultProjectMilestoneId: string | undefined;
  canManageHumanInvites: boolean;
  isDetaching: boolean;
  openProjectWorkbenchForEntity: (entity?: CoworkRoomEntityRef) => void;
  handleDetachProjectCapability: () => Promise<void>;
}) {
  return (
    <ProjectGroupHeaderBadge
      name={boundProjectState.project.name} status={boundProjectState.project.status}
      activeMilestone={resolveActiveProjectMilestone(boundProjectState, defaultProjectMilestoneId)}
      decisionsCount={boundProjectState.decisions?.length} decisions={boundProjectState.decisions}
      onOpenWorkbench={() =>
        openProjectWorkbenchForEntity()
      }
      canDetach={canManageHumanInvites}
      onDetach={() =>
        void handleDetachProjectCapability()
      }
      isDetaching={
        isDetaching
      }
    />
  );
}
