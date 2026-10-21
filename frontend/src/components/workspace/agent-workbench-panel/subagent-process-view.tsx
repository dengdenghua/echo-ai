import { useContext, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownIcon,
  ChevronRightIcon,
  SquareArrowOutUpRightIcon,
  MessageCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { eventBus } from "@/core/events/event-bus";
import { useI18n } from "@/core/i18n/hooks";
import { subagentViewCopy } from "@/core/i18n/locales/subagent-view";
import type { AgentTile } from "../agent-workbench-utils";
import type { WorkBlock } from "../work-blocks";
import { ThreadMetaContext } from "../messages/context";
import { MessageGroup } from "../messages/message-group";
import { MessageListItem } from "../messages/message-list-item";
import { MemberProcessHeader } from "./member-process-header";
import { subagentMessages } from "./subagent-process-messages";
import {
  useMemberReadingPosition,
  type MemberReadingPositions,
} from "./use-member-reading-position";

type ProcessViewProps = {
  agent: AgentTile;
  blocks: WorkBlock[];
  currentBlockId?: string | null;
  onOpenMain: () => void;
  onSelectBlock?: (blockId: string) => void;
  summaryOnly?: boolean;
  threadId?: string;
  readingPositions?: MemberReadingPositions;
};

export function SubagentProcessView(props: ProcessViewProps) {
  const meta = useContext(ThreadMetaContext);
  const localPositions = useRef<MemberReadingPositions>(new Map());
  const scope = JSON.stringify([
    props.threadId ?? meta?.threadId,
    props.agent.id,
    props.agent.startedAt,
  ]);
  return (
    <MemberProcessContent
      key={scope}
      {...props}
      scope={scope}
      positions={props.readingPositions ?? localPositions.current}
    />
  );
}

function MemberProcessContent({
  agent,
  blocks,
  onOpenMain,
  summaryOnly = false,
  scope,
  positions,
}: ProcessViewProps & { scope: string; positions: MemberReadingPositions }) {
  const { t, locale } = useI18n();
  const copy = subagentViewCopy(locale);
  const navigate = useNavigate();
  const [followupText, setFollowupText] = useState("");
  const [taskOpen, setTaskOpen] = useState(positions.get(scope)?.taskOpen ?? false);
  const memberName = agent.codename ?? agent.name;
  const isRunning = agent.status === "running";
  const messages = useMemo(
    () => subagentMessages(agent, blocks),
    [agent, blocks],
  );
  const { containerRef, showLatest, scrollToLatest } = useMemberReadingPosition(
    scope,
    positions,
    messages,
    isRunning,
  );
  const shareableReply =
    typeof messages.answer?.content === "string" && agent.status !== "error"
      ? messages.answer.content.trim()
      : "";

  const handleShareToGroup = () => {
    if (!shareableReply) return;
    eventBus.emit("composer:insert-mention", {
      text: copy.sharedReply(memberName, shareableReply),
      submit: false,
    });
    toast.success(copy.sharedToComposer);
  };
  const handlePrivateChat = (event: React.FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams({ agent: agent.name, private: "1" });
    if (followupText.trim()) params.set("prompt", followupText.trim());
    void navigate("/workspace/realtime/new?" + params.toString());
    setFollowupText("");
  };
  const hasConversation =
    !!messages.answer ||
    (!summaryOnly && !!(messages.task || messages.process.length));

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      data-testid="member-process-view"
    >
      <MemberProcessHeader
        agent={agent}
        onOpenMain={onOpenMain}
        actions={
          <button
            type="button"
            onClick={handleShareToGroup}
            disabled={!shareableReply}
            title={
              shareableReply ? copy.shareToGroupHint : copy.shareUnavailable
            }
            className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <SquareArrowOutUpRightIcon
              className="size-3.5"
              aria-hidden="true"
            />
            {copy.shareToGroup}
          </button>
        }
      />
      <div
        ref={containerRef}
        data-testid="member-process-scroll"
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <div
          className="mx-auto w-full min-w-0 max-w-2xl space-y-5 px-4 py-4"
          data-testid="subagent-main-conversation"
        >
          {!summaryOnly && messages.task && (
            <details open={taskOpen} onToggle={(event) => {
              const open = event.currentTarget.open;
              setTaskOpen(open);
              const position = positions.get(scope);
              positions.set(scope, { top: position?.top ?? 0, following: position?.following ?? isRunning, taskOpen: open });
            }} className="group/brief rounded-lg border border-border-subtle bg-muted/15">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon
                  className="size-3.5 transition-transform group-open/brief:rotate-90"
                  aria-hidden="true"
                />
                {copy.task}
              </summary>
              {taskOpen && <div className="min-w-0 border-t border-border-subtle px-3 py-3">
                <MessageListItem
                  message={messages.task}
                  isLastMessage={false}
                />
              </div>}
            </details>
          )}
          {!summaryOnly && messages.process.length > 0 && (
            <section aria-label={copy.execution} className="min-w-0">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                {copy.execution}
              </h3>
              <MessageGroup
                messages={messages.process}
                isLoading={isRunning}
                keepOpen={isRunning}
                collapseCompletedProcess
                codeMode
              />
            </section>
          )}
          {isRunning && messages.process.length === 0 && !messages.answer && (
            <p role="status" className="text-xs text-muted-foreground">
              {copy.processing}
            </p>
          )}
          {messages.answer && (
            <section
              aria-label={copy.result}
              className="min-w-0 border-t border-border-subtle pt-4"
            >
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                {copy.result}
              </h3>
              <MessageListItem
                message={messages.answer}
                isLoading={false}
                isLastMessage
              />
            </section>
          )}
          {!hasConversation && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t.agentWorkbenchPanel.waitingForSubagentOutput}
            </p>
          )}
        </div>
      </div>
      {showLatest && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center">
          <button
            type="button"
            onClick={scrollToLatest}
            aria-label={t.agentWorkbenchPanel.scrollToBottom}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-xs shadow-sm hover:bg-muted"
          >
            <ArrowDownIcon className="size-3.5" aria-hidden="true" />
            {t.agentWorkbenchPanel.viewLatestProgress}
          </button>
        </div>
      )}
      <div
        data-testid="subagent-followup-bar"
        className="min-w-0 shrink-0 border-t border-border-subtle bg-background px-3 py-2.5"
      >
        <form
          onSubmit={handlePrivateChat}
          className="mx-auto flex max-w-2xl flex-wrap items-center gap-2"
        >
          <input
            type="text"
            aria-label={copy.privateChatLabel(memberName)}
            value={followupText}
            onChange={(event) => setFollowupText(event.target.value)}
            placeholder={copy.privateChatPlaceholder(memberName)}
            className="min-w-0 flex-[1_1_180px] rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            title={copy.privateChatTitle(memberName)}
            className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageCircleIcon className="size-3.5" aria-hidden="true" />
            {copy.privateChat}
          </button>
          <p className="w-full text-xs text-muted-foreground">
            {copy.privateChatHint}
          </p>
        </form>
      </div>
    </div>
  );
}
