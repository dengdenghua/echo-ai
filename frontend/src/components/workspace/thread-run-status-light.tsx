/**
 * ThreadRunStatusLight — extracted from `workspace-sidebar.tsx`
 * (P3 decomposition). Behavior-preserving move.
 */
import {
  agentRunStatusLightClass,
  agentRunStatusLightPulseClass,
} from "@/components/workspace/agent-run-status";
import { useI18n } from "@/core/i18n/hooks";
import { attentionTitle } from "@/core/notification/attention";
import { useThreadAttention } from "@/core/notification/attention-store";
import type { ThreadRunStatus } from "@/core/threads/sidebar";
import { cn } from "@/lib/utils";

export function ThreadRunStatusLight({
  active,
  className,
  idle = "hidden",
  status,
  threadId,
}: {
  active?: boolean;
  className?: string;
  idle?: "hidden" | "queue";
  status?: ThreadRunStatus;
  /** Names the cause (approval, pause reason…) when the thread waits. */
  threadId?: string;
}) {
  const { t } = useI18n();
  const attention = useThreadAttention(threadId);
  if (!status) {
    if (idle === "hidden") return null;
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex size-2 shrink-0 items-center justify-center rounded-full",
          active
            ? "border border-muted-foreground/40 bg-muted-foreground/60"
            : "border border-muted-foreground/60 bg-muted-foreground/20",
          className,
        )}
        data-thread-queue-indicator="idle"
      />
    );
  }
  // The attention marker names why a waiting thread waits; it only applies
  // while the light agrees with it (a failure is red, any wait amber).
  const attentionKind =
    attention &&
    ((status === "error" && attention.kind === "failed") ||
      (status === "waiting" && attention.kind !== "failed"))
      ? attention.kind
      : undefined;
  const label =
    attention && attentionKind && attentionKind !== "failed"
      ? attentionTitle(
          t.attentionNotifications,
          attentionKind,
          attention.reason,
        )
      : status === "running"
        ? t.sidebar.taskStatusRunning
        : status === "error"
          ? t.sidebar.taskStatusFailed
          : status === "waiting"
            ? t.agentWorkbench.waitingToContinue
            : t.sidebar.taskStatusPending;
  const colorClass = agentRunStatusLightClass(status);
  const pulseClass = agentRunStatusLightPulseClass(status);

  return (
    <span
      aria-label={label}
      role="img"
      title={label}
      data-thread-attention={attentionKind}
      data-thread-attention-unseen={
        attentionKind && attention?.unseen ? "true" : undefined
      }
      className={cn(
        "relative inline-flex size-2 shrink-0 items-center justify-center rounded-full",
        className,
      )}
    >
      {pulseClass && (
        <span
          className={cn(
            "absolute inline-flex size-3 rounded-full opacity-25",
            colorClass,
            pulseClass,
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full shadow-[var(--shadow-xs)]",
          colorClass,
        )}
      />
    </span>
  );
}

/** One image cell · falls back to a colored initial circle if the
 *  backend has no avatar for the agent (404 on
 *  ``/api/agents/<id>/avatar``). The initial fallback uses a hash-based
 *  color so different agents don't all blend into the same grey. */
