import { memo, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import { AutomationControlDock } from "@/components/workspace/automation-control-dock";
import { CollaborationCoordination } from "@/components/workspace/collaboration-coordination";
import { ComposerStepProgress } from "@/components/workspace/composer-step-progress";
import { RealtimeApprovalPrompt } from "@/components/workspace/realtime-approval-toasts";
import { TaskFollowups } from "@/components/workspace/task-followups";
import { TaskSideQuestion } from "@/components/workspace/task-side-question";
import { TeamWelcomeCard } from "@/components/workspace/team-welcome-card";
import { Welcome } from "@/components/workspace/welcome";
import type { Agent } from "@/core/agents";
import type { AutomationTarget } from "@/core/computer/api";
import type { CollaborationSession, CoworkRoomMessage } from "@/core/cowork";
import type { Team } from "@/core/teams/api";
import { cn } from "@/lib/utils";

import type {
  RealtimeApprovalControls,
  RealtimeThread,
  RealtimeToolEvents,
  StateSetter,
} from "./realtime-page-types";

export interface RealtimeComposerAreaProps {
  threadId: string;
  thread: RealtimeThread;
  isNewThread: boolean;
  mounted: boolean;
  membershipNotice: string;
  setMembershipNotice: StateSetter<string>;
  selectedCollaborators: Agent[];
  welcomeTeamId: string | null;
  handleWelcomeTeamLoaded: (team: Team) => void;
  perspectiveDisplayAgent: Agent | null;
  mainPerspectiveAgentId: string;
  agentDisplayEvents: RealtimeToolEvents;
  hasCompletedAgentOutput: boolean;
  agentRunSettled: boolean;
  agentRunFailed: boolean;
  hasPausedOrPendingBackgroundTask: boolean;
  realtimeApprovals: RealtimeApprovalControls;
  hasPersistedCollaboration: boolean;
  collabRoster: CollaborationSession["roster"] | undefined;
  allTaskCollaboratorAgents: Agent[];
  automationTarget: AutomationTarget | null;
  latestAutomationEvent: RealtimeToolEvents[number] | undefined;
  replyTarget: CoworkRoomMessage | null;
  setReplyTarget: StateSetter<CoworkRoomMessage | null>;
  modelName: string | undefined;
  selectedExecutionEngine: "echo" | "codex" | "opencode";
  isStopping: boolean;
  handleSubmit: (message: { text: string }) => void | boolean;
  /** The composer itself (see RealtimeChatInput). */
  chatInput: ReactNode;
}

/**
 * Everything stacked above and around the composer: welcome / team notices,
 * step progress, approvals, coordination, automation dock, reply target,
 * side question and follow-ups.
 */
export function RealtimeComposerArea({
  threadId,
  thread,
  isNewThread,
  mounted,
  membershipNotice,
  setMembershipNotice,
  selectedCollaborators,
  welcomeTeamId,
  handleWelcomeTeamLoaded,
  perspectiveDisplayAgent,
  mainPerspectiveAgentId,
  agentDisplayEvents,
  hasCompletedAgentOutput,
  agentRunSettled,
  agentRunFailed,
  hasPausedOrPendingBackgroundTask,
  realtimeApprovals,
  hasPersistedCollaboration,
  collabRoster,
  allTaskCollaboratorAgents,
  automationTarget,
  latestAutomationEvent,
  replyTarget,
  setReplyTarget,
  modelName,
  selectedExecutionEngine,
  isStopping,
  handleSubmit,
  chatInput,
}: RealtimeComposerAreaProps) {
  return (
    <div
      data-composer-start={isNewThread || undefined}
      data-composer-root="true"
      className={cn(
        "relative mx-auto w-full transition-[max-width,transform] duration-slow",
        isNewThread && "workspace-start-composer",
        isNewThread
          ? "max-w-3xl"
          : "max-w-(--conversation-column)",
      )}
    >
      {mounted ? (
        <div className={cn("flex flex-col", isNewThread ? "gap-0" : "gap-2")}>
          <RealtimeComposerPreamble
            isNewThread={isNewThread}
            membershipNotice={membershipNotice}
            setMembershipNotice={setMembershipNotice}
            selectedCollaboratorCount={selectedCollaborators.length}
            selectedCollaboratorNames={selectedCollaborators.map(agent => agent.display_name || agent.name).join("、")}
            welcomeTeamId={welcomeTeamId}
            handleWelcomeTeamLoaded={handleWelcomeTeamLoaded}
            perspectiveDisplayAgent={perspectiveDisplayAgent}
            mainPerspectiveAgentId={mainPerspectiveAgentId}
          />
          {!isNewThread ? (
            <ComposerStepProgress
              events={agentDisplayEvents}
              hasAnswer={hasCompletedAgentOutput}
              isLoading={thread.isLoading}
              runSettled={agentRunSettled}
              runFailed={agentRunFailed}
              paused={hasPausedOrPendingBackgroundTask}
              className="mt-2"
            />
          ) : null}
          <RealtimeApprovalPrompt
            approvals={realtimeApprovals.pendingApprovals}
            resolveApproval={realtimeApprovals.resolveApproval}
            className="-mb-1"
          />
          {!isNewThread && hasPersistedCollaboration && (
            <CollaborationCoordination
              threadId={threadId}
              members={(collabRoster ?? [])
                .filter((member) => member.kind !== "human" && member.driver !== "human" && !member.muted && member.role !== "observer")
                .map((member) => ({ id: member.id, name: allTaskCollaboratorAgents.find((agent) => agent.name === member.id)?.display_name ?? member.id, owner: member.accountable_owner }))}
            />
          )}
          <div className={isNewThread ? "pt-0" : "pt-3"}>
            {automationTarget ? (
              <AutomationControlDock
                threadId={threadId}
                target={automationTarget}
                executing={thread.isLoading && Boolean(latestAutomationEvent)}
              />
            ) : null}
            {replyTarget ? (
              <RealtimeReplyTargetBar
                replyTarget={replyTarget}
                setReplyTarget={setReplyTarget}
              />
            ) : null}
            <TaskSideQuestion threadId={threadId} model={modelName} engine={selectedExecutionEngine} />
            <TaskFollowups threadId={threadId} running={thread.isLoading} ready={thread.readyForMutations} failed={Boolean(thread.error) || isStopping || thread.lastTurnStatus === "interrupted" || thread.lastTurnStatus === "failed"} onSend={handleSubmit} />
            {chatInput}
          </div>
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="workspace-panel h-32 w-full rounded-lg"
        />
      )}
    </div>
  );
}

/**
 * Membership notice, the "team ready" hint and the new-task welcome.
 * Memoized on primitive/stable props, so streamed turns skip it.
 */
const RealtimeComposerPreamble = memo(function RealtimeComposerPreamble({
  isNewThread,
  membershipNotice,
  setMembershipNotice,
  selectedCollaboratorCount,
  selectedCollaboratorNames,
  welcomeTeamId,
  handleWelcomeTeamLoaded,
  perspectiveDisplayAgent,
  mainPerspectiveAgentId,
}: {
  isNewThread: boolean;
  membershipNotice: string;
  setMembershipNotice: StateSetter<string>;
  selectedCollaboratorCount: number;
  /** Display names of the selected collaborators, joined with 「、」. */
  selectedCollaboratorNames: string;
  welcomeTeamId: string | null;
  handleWelcomeTeamLoaded: (team: Team) => void;
  perspectiveDisplayAgent: Agent | null;
  mainPerspectiveAgentId: string;
}) {
  return (
    <>
      {membershipNotice ? <div role="status" className="mb-2 flex items-center gap-2 rounded-lg border p-3 text-xs text-muted-foreground"><span className="flex-1">{membershipNotice}</span><button aria-label="关闭入群提示" onClick={() => setMembershipNotice("")}>×</button></div> : null}
      {isNewThread && selectedCollaboratorCount > 0 && !welcomeTeamId ? <div className="mb-3 rounded-lg border p-3 text-sm"><p>团队已就绪 · {selectedCollaboratorNames}</p><p className="mt-1 text-xs text-muted-foreground">发送第一条消息后保存群聊。你想和团队一起做什么？</p></div> : null}
      {isNewThread ? (
        <div data-composer-welcome="true">
          {welcomeTeamId ? <TeamWelcomeCard teamId={welcomeTeamId} onLoaded={handleWelcomeTeamLoaded} /> : <Welcome
            className="workspace-start-heading"
            agent={perspectiveDisplayAgent}
            agentName={mainPerspectiveAgentId}
          />}
        </div>
      ) : null}
    </>
  );
});

/** The "replying to" strip above the composer. */
const RealtimeReplyTargetBar = memo(function RealtimeReplyTargetBar({
  replyTarget,
  setReplyTarget,
}: {
  replyTarget: CoworkRoomMessage;
  setReplyTarget: StateSetter<CoworkRoomMessage | null>;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        回复 {replyTarget.display_name || "协作成员"}：
        {replyTarget.text}
      </span>
      <button
        type="button"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="取消回复"
        onClick={() => setReplyTarget(null)}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
});
