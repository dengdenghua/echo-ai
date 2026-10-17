import { type ComponentProps } from "react";

import { cn } from "@/lib/utils";

import { emitOpenAgentWorkbench } from "../agent-workbench-events";

import type { MarkdownContent } from "./markdown-content";

type MarkdownRenderProps = Pick<
  ComponentProps<typeof MarkdownContent>,
  "components" | "rehypePlugins" | "chatFontSize"
>;

export function SegmentedReasoningPanel({
  publicThinkingSummary,
  isLoading,
  messageId,
}: MarkdownRenderProps & {
  publicThinkingSummary?: string | null;
  isLoading: boolean;
  messageId?: string;
}) {
  const replyThinking = publicThinkingSummary?.trim() || null;
  if (!replyThinking) return null;
  const summary = replyThinking.replace(/\s+/g, " ").trim();

  return (
    <button
      type="button"
      onClick={() =>
        emitOpenAgentWorkbench({
          tab: "agent",
          eventId: messageId,
          eventKind: "thinking",
          view: "summary",
          processEvent: {
            kind: "thinking",
            summary,
            detail: replyThinking,
            status: isLoading ? "running" : "done",
            count: 1,
          },
        })
      }
      className="group/thinking-row mb-1 flex w-full min-w-0 items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-left text-xs leading-4 text-muted-foreground transition-colors hover:text-muted-foreground hover:border-border"
      data-process-event-id={messageId}
      data-process-event-kind="thinking"
      data-testid="assistant-thinking-event"
      aria-label={summary}
    >
      <span
        className={cn(
          "inline-flex size-1.5 shrink-0 rounded-full bg-muted-foreground/35",
          isLoading && "animate-pulse bg-primary/55",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{summary}</span>
    </button>
  );
}
