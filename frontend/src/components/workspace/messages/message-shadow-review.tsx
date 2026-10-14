/**
 * The 双螺旋 shadow review on an assistant answer: a second engine reviews the
 * primary one's output (moved out of message-list-item.tsx).
 */
import {
  CheckCircle2Icon,
  DnaIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canAccessOperatorControlPlane } from "@/core/auth/control-plane-access";
import { useI18n } from "@/core/i18n/hooks";
import { messageActionsCopy } from "@/core/i18n/locales/message-actions";
import {
  getDualHelixShadowStatus,
  queueDualHelixShadowRun,
  type DualHelixShadowStatus,
} from "@/core/evolution/api";
import { cn } from "@/lib/utils";
import { useOptionalAuth } from "@/providers/AuthProvider";

export interface ShadowReviewContext {
  goal: string;
  primaryEngine: "echo" | "codex";
  primaryOutput: string;
  threadId: string;
  messageId: string;
  workspacePath?: string | null;
}

type ShadowRun = DualHelixShadowStatus["runs"][number];

function isShadowRunActive(run: ShadowRun | null): boolean {
  return Boolean(
    run && ["queued", "snapshotting", "running"].includes(run.status),
  );
}

/** Product names, not copy: the same in every UI language. */
function shadowEngineName(engine: string | undefined): string {
  return engine === "codex" ? "Codex" : "Echo";
}

export function ShadowReviewAction({
  context,
  showLabel = false,
}: {
  context: ShadowReviewContext;
  showLabel?: boolean;
}) {
  const { locale } = useI18n();
  const copy = messageActionsCopy(locale).shadowReview;
  const auth = useOptionalAuth();
  const canReview = canAccessOperatorControlPlane(
    auth?.authStatus ?? null,
    auth?.user ?? null,
  );
  const [run, setRun] = useState<ShadowRun | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const terminalNotified = useRef(false);

  useEffect(() => {
    if (!canReview) return undefined;
    let active = true;
    void getDualHelixShadowStatus()
      .then((status) => {
        if (!active) return;
        const previous = status.runs.find(
          (item) =>
            item.source_thread_id === context.threadId &&
            item.source_message_id === context.messageId,
        );
        if (previous) {
          terminalNotified.current = ["completed", "failed"].includes(
            previous.status,
          );
          setRun(previous);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [canReview, context.messageId, context.threadId]);

  useEffect(() => {
    if (!isShadowRunActive(run)) return;
    const timer = window.setInterval(() => {
      void getDualHelixShadowStatus()
        .then((status) => {
          const current = status.runs.find(
            (item) => item.run_id === run?.run_id,
          );
          if (!current) return;
          setRun(current);
          if (
            !terminalNotified.current &&
            ["completed", "failed"].includes(current.status)
          ) {
            terminalNotified.current = true;
            if (current.status === "completed") {
              toast.success(copy.completedToast);
            } else {
              toast.error(copy.failedToast);
            }
          }
        })
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [copy, run]);

  const queueReview = async () => {
    if (!canReview) return;
    if (run && ["completed", "failed"].includes(run.status)) {
      setDialogOpen(true);
      return;
    }
    if (queueing || isShadowRunActive(run)) return;
    setQueueing(true);
    try {
      const status = await getDualHelixShadowStatus();
      if (!status.enabled) {
        toast.error(copy.notEnabled);
        return;
      }
      terminalNotified.current = false;
      const queued = await queueDualHelixShadowRun({
        goal: context.goal.slice(0, 20_000),
        primary_engine: context.primaryEngine,
        primary_output: context.primaryOutput.slice(0, 50_000),
        workspace_path: context.workspacePath || undefined,
        source_thread_id: context.threadId,
        source_message_id: context.messageId,
      });
      setRun(queued);
      toast.success(copy.queued(shadowEngineName(queued.shadow_engine)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.submitFailed);
    } finally {
      setQueueing(false);
    }
  };

  const active = queueing || isShadowRunActive(run);
  const completed = run?.status === "completed";
  const failed = run?.status === "failed";
  const label = completed
    ? copy.completedView
    : failed
      ? copy.failedView
      : active
        ? copy.running
        : copy.request;

  if (!canReview) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void queueReview()}
        disabled={active}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg text-muted-foreground transition-all duration-base hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-wait disabled:opacity-60",
          showLabel ? "w-full px-2 py-1.5 text-sm" : "size-7 justify-center",
        )}
        title={label}
        aria-label={label}
      >
        {active ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : completed ? (
          <CheckCircle2Icon className="size-4 text-success" />
        ) : failed ? (
          <XCircleIcon className="size-4 text-destructive" />
        ) : (
          <DnaIcon className="size-4" />
        )}
        {showLabel && <span>{label}</span>}
      </button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{copy.dialogTitle}</DialogTitle>
            <DialogDescription>
              {copy.dialogDescription(shadowEngineName(run?.shadow_engine))}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm leading-6 whitespace-pre-wrap">
            {run?.result || run?.error || copy.empty}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
