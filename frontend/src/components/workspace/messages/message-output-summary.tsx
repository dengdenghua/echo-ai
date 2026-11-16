import type { Message } from "@/core/api/types";
import type { FileHunk } from "@/core/realtime";
import { singleHunkDiff } from "@/components/realtime/item-views/file-change-view";
import {
  artifactDisplayPath,
  normalizeWorkspaceArtifactRef,
} from "@/core/artifacts/utils";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { swallow } from "@/core/utils/log";
import {
  getFileExtensionDisplayName,
  getFileIcon,
  getFileName,
} from "@/core/utils/files";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FilePenLineIcon,
  FilesIcon,
  LinkIcon,
  Loader2Icon,
  PlugIcon,
  WandSparklesIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useArtifacts } from "../artifacts";
import { emitOpenAgentWorkbench } from "../agent-workbench-events";
import { isInternalWorkingFilePath } from "../agent-workbench-utils";
import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { TaskConnectionRecovery, taskConnectionIssue } from "./task-connection-recovery";
import { hasModelPreparationIssue, isNoModelFailure, ModelSetupActions } from "./model-setup-actions";
import {
  changeDisplayPath,
  extractResultUrl,
  extractRetryPrompt,
  isFinalOutputArtifactPath,
  summarizeOutputs,
  type FailurePresentation,
  type OutputChange,
} from "./message-output-summary-model";
export {
  extractResultUrl,
  extractRetryPrompt,
  hasMessageOutputSummary,
  type FailurePresentation,
} from "./message-output-summary-model";

export function MessageOutputSummary({
  messages,
  turnMessages,
  retryContextMessages,
  threadId,
  onOpenArtifact: onOpenArtifactProp,
  onRetryTask,
  onAuthorizeNetwork,
  authorizingNetworkTier = null,
  isRetrying = false,
  failure,
  className,
  presentation = "final",
}: {
  auditNotice?: string | null;
  messages: Message[];
  /** Full message slice of the turn this receipt belongs to. The plain
   *  assistant group never contains human or tool messages, so verification
   *  results, the original prompt and deploy URLs can only be found here.
   *  Falls back to `messages` when absent. */
  turnMessages?: Message[];
  /** Full conversation used when the failed turn contains only punctuation. */
  retryContextMessages?: Message[];
  threadId?: string;
  /** Keep artifact navigation inside the host workbench when available. */
  onOpenArtifact?: (path: string) => void;
  /** Retry the failed task while preserving the host conversation context. */
  onRetryTask?: (prompt: string) => void;
  /** Grant the network tier required by an environment-blocked task. */
  onAuthorizeNetwork?: (tier: "common" | "full") => void;
  /** Prevent duplicate grants while thread settings are being persisted. */
  authorizingNetworkTier?: "common" | "full" | null;
  /** Keep retry controls honest while a replacement turn is being dispatched. */
  isRetrying?: boolean;
  failure?: FailurePresentation | null;
  className?: string;
  presentation?: "final" | "process";
}) {
  const { t } = useI18n();
  const { select, setOpen } = useArtifacts();
  const scanMessages = turnMessages ?? messages;
  const connectionIssue = useMemo(() => taskConnectionIssue(scanMessages), [scanMessages]);
  const modelPreparationIssue = useMemo(() => hasModelPreparationIssue(scanMessages), [scanMessages]);
  const noModel = isNoModelFailure(failure);
  const summary = useMemo(() => summarizeOutputs(scanMessages), [scanMessages]);
  // Error details frequently contain failed proxy endpoints. They are
  // diagnostics, not user-facing results, so a failed turn must never expose
  // them as an "Open result" action.
  const resultUrl = useMemo(
    () => (failure ? null : extractResultUrl(scanMessages)),
    [failure, scanMessages],
  );
  const originalPrompt = useMemo(
    () =>
      extractRetryPrompt(scanMessages, retryContextMessages ?? scanMessages),
    [retryContextMessages, scanMessages],
  );
  if (
    !failure &&
    summary.artifacts.length === 0 &&
    summary.changes.length === 0 &&
    summary.verifications.length === 0
  ) {
    return null;
  }

  const isFailure = Boolean(failure);
  const isResolvedFailure = Boolean(failure?.resolved);
  // Network loss, an environment block, and a "needs your input" hand-off are
  // not agent failures — amber, not red. No model is a setup step: neutral.
  const isWarningFailure =
    failure?.kind === "auth" ||
    failure?.kind === "capability" ||
    failure?.kind === "network" ||
    failure?.kind === "backpressure" ||
    failure?.kind === "quota-exhausted" || failure?.kind === "rate-limit" ||
    failure?.kind === "verification" ||
    failure?.kind === "environment" ||
    failure?.kind === "blocked";

  const friendlyVerificationName = (toolName: string): string => {
    switch (toolName) {
      case "run_tests":
      case "test":
        return t.message.testsPassed;
      case "lint_check":
        return t.message.lintClean;
      case "build":
        return t.message.buildSucceeded;
      default:
        return t.message.verificationRan;
    }
  };

  const handleMakeSimilar = () => {
    if (!originalPrompt || isRetrying) return;
    if (onRetryTask) {
      onRetryTask(originalPrompt);
      return;
    }
    window.location.hash = `/workspace/realtime/new?prompt=${encodeURIComponent(
      originalPrompt,
    )}`;
  };

  const openArtifact = (path: string) => {
    if (onOpenArtifactProp) {
      onOpenArtifactProp(path);
      return;
    }
    select(normalizeWorkspaceArtifactRef(path, threadId));
    setOpen(true);
  };

  const finalOutputChanges = summary.changes.filter(
    (change) => change.created && isFinalOutputArtifactPath(change.path),
  );
  const finalOutputRefs = new Set(
    finalOutputChanges.map((change) =>
      normalizeWorkspaceArtifactRef(change.path, threadId),
    ),
  );
  const reviewableChanges = summary.changes;
  const visibleArtifacts = summary.artifacts.filter(
    (artifact) =>
      !isInternalWorkingFilePath(artifact.path) &&
      !finalOutputRefs.has(
        normalizeWorkspaceArtifactRef(artifact.path, threadId),
      ),
  );
  const totalAdded = reviewableChanges.reduce(
    (sum, item) => sum + item.added,
    0,
  );
  const totalRemoved = reviewableChanges.reduce(
    (sum, item) => sum + item.removed,
    0,
  );
  const sourceChanges = reviewableChanges.filter(
    (change) => !finalOutputChanges.includes(change),
  );
  const changeSummaryLabel =
    finalOutputChanges.length > 0 && sourceChanges.length === 0
      ? t.message.artifactsCreated(finalOutputChanges.length)
      : finalOutputChanges.length > 0
        ? t.message.artifactsCreatedAndFilesEdited(
            finalOutputChanges.length,
            sourceChanges.length,
          )
        : t.message.filesEdited(sourceChanges.length);
  // File changes are a completed change set, not another execution step.
  // They receive their own review surface below; keep the generic receipt
  // banner only for failures or turns without a diff.
  const showReceiptBanner = isFailure || reviewableChanges.length === 0;
  const openChangesReview = () => emitOpenAgentWorkbench({ tab: "diff" });

  if (presentation === "process") {
    if (reviewableChanges.length === 0) return null;
    return (
      <section
        aria-label={t.message.changesSummary}
        className={cn("min-w-0", className)}
        data-testid="process-change-summary"
      >
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {reviewableChanges.map((change) => (
            <ChangeRow
              key={change.path}
              change={change}
              threadId={threadId}
              onOpen={
                finalOutputChanges.includes(change)
                  ? () => openArtifact(change.path)
                  : undefined
              }
              presentation="process"
            />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <div
      className={cn(
        "mt-2 flex min-w-0 max-w-full flex-col gap-2 overflow-x-clip",
        className,
      )}
    >
      {showReceiptBanner && (
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs",
            isResolvedFailure || noModel
              ? "border-border-default bg-muted/35"
              : isFailure
                ? isWarningFailure
                  ? "border-warning/20 bg-warning/[0.04]"
                  : "border-destructive/20 bg-destructive/[0.035]"
                : "border-success/20 bg-success/[0.055]",
          )}
        >
          {isResolvedFailure ? (
            <CheckCircle2Icon className="size-4 shrink-0 text-success/75" />
          ) : noModel ? (<PlugIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />) : isFailure ? (
            isWarningFailure ? (
              <AlertTriangleIcon className="size-4 shrink-0 text-warning" />
            ) : (
              <XCircleIcon className="size-4 shrink-0 text-destructive" />
            )
          ) : (
            <CheckCircle2Icon className="size-4 shrink-0 text-success" />
          )}
          <div className="min-w-0 flex-1">
            <div
              title={isResolvedFailure ? failure?.message : undefined}
              className={cn(
                "font-medium text-foreground/85",
                isFailure
                  ? "whitespace-pre-wrap break-words leading-5"
                  : "truncate",
              )}
            >
              {isResolvedFailure
                ? t.message.previousAttemptRecovered
                : isFailure
                  ? (failure?.message ?? t.message.taskFailed)
                  : t.message.taskOutputs}
            </div>
            {!isFailure && (
              <div className="truncate text-xs text-muted-foreground">
                {t.message.taskCompleted}
                {reviewableChanges.length > 0 ? ` · ${changeSummaryLabel}` : ""}
                {visibleArtifacts.length > 0
                  ? ` · ${t.message.artifactsCreated(visibleArtifacts.length)}`
                  : ""}
                {summary.verifications.length > 0
                  ? ` · ${t.message.verificationRan} ${
                      summary.verifications.filter((entry) => entry.passed)
                        .length
                    }/${summary.verifications.length}`
                  : ""}
              </div>
            )}
          </div>
          {reviewableChanges.length > 0 && (
            <div className="shrink-0 rounded-full bg-background/75 px-2 py-1 font-mono text-xs shadow-[var(--shadow-xs)]">
              <span className="text-success">+{totalAdded}</span>
              <span className="mx-1 text-muted-foreground"> </span>
              <span className="text-destructive">-{totalRemoved}</span>
            </div>
          )}
          {resultUrl && (
            <RoutedWebLink
              href={resultUrl}
              openTargetSource="task-result"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-default bg-background/70 px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/55 hover:text-foreground"
              title={t.message.resultUrl}
            >
              <LinkIcon className="size-3" />
              {t.message.openResult}
            </RoutedWebLink>
          )}
          {isFailure &&
            !isResolvedFailure &&
            (failure?.kind === "auth" || failure?.kind === "quota-exhausted" || failure?.kind === "rate-limit" || modelPreparationIssue || noModel) && (
              <ModelSetupActions noModel={noModel} quota={failure?.kind === "quota-exhausted"} indent />
            )}
          {isFailure &&
            !isResolvedFailure &&
            failure?.kind === "environment" &&
            onAuthorizeNetwork && (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onAuthorizeNetwork("common")}
                  disabled={authorizingNetworkTier !== null || isRetrying}
                  aria-busy={authorizingNetworkTier === "common"}
                  className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-warning/35 bg-warning/[0.08] px-2 py-1 text-left text-xs font-medium leading-4 text-warning transition-colors hover:border-warning/55 hover:bg-warning/15 disabled:cursor-wait disabled:opacity-70"
                >
                  {authorizingNetworkTier === "common" ? (
                    <Loader2Icon
                      className="size-3 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {t.streaming.environmentBlockedAuthorizeCommon}
                </button>
                <button
                  type="button"
                  onClick={() => onAuthorizeNetwork("full")}
                  disabled={authorizingNetworkTier !== null || isRetrying}
                  aria-busy={authorizingNetworkTier === "full"}
                  className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-warning/25 px-2 py-1 text-left text-xs font-medium leading-4 text-warning/90 transition-colors hover:border-warning/45 hover:bg-warning/10 disabled:cursor-wait disabled:opacity-70"
                >
                  {authorizingNetworkTier === "full" ? (
                    <Loader2Icon
                      className="size-3 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {t.streaming.environmentBlockedAuthorizeFull}
                </button>
              </div>
            )}
          {isFailure &&
            !isResolvedFailure &&
            failure?.kind !== "auth" && failure?.kind !== "quota-exhausted" && !noModel &&
            !connectionIssue &&
            (failure?.kind !== "environment" || !onAuthorizeNetwork) &&
            originalPrompt && (
              <button
                type="button"
                onClick={handleMakeSimilar}
                disabled={isRetrying}
                aria-busy={isRetrying}
                title={t.message.retryTaskHint}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-70",
                  isWarningFailure
                    ? "border-warning/35 bg-warning/[0.08] text-warning hover:border-warning/55 hover:bg-warning/15"
                    : "border-destructive/30 bg-destructive/[0.08] text-destructive hover:border-destructive/50 hover:bg-destructive/15",
                )}
              >
                {isRetrying ? (
                  <Loader2Icon className="size-3 animate-spin" aria-hidden />
                ) : (
                  <WandSparklesIcon className="size-3" aria-hidden />
                )}
                {isRetrying ? t.message.retryingTask : t.message.retryTask}
              </button>
            )}
          {isFailure && !isResolvedFailure && connectionIssue && (
            <TaskConnectionRecovery key={`${threadId}:${JSON.stringify(connectionIssue)}`}
              issue={connectionIssue} busy={isRetrying}
              onContinue={originalPrompt && onRetryTask ? handleMakeSimilar : undefined} />
          )}
        </div>
      )}
      {visibleArtifacts.length > 0 && (
        <section aria-label={t.message.artifactsSummary} className="space-y-2">
          <div className="text-sm font-semibold text-foreground">
            {t.message.artifactsSummary}
          </div>
          <div className="flex flex-col gap-2">
            {visibleArtifacts.map((artifact) => (
              <button
                key={artifact.path}
                type="button"
                onClick={() => openArtifact(artifact.path)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-lg border border-border-default bg-muted/25 px-3 py-2.5 text-left",
                  "transition-colors hover:border-border hover:bg-muted/45",
                )}
              >
                <span className="shrink-0">
                  {getFileIcon(artifactDisplayPath(artifact.path), "size-7")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {artifact.title ||
                      getFileName(artifactDisplayPath(artifact.path))}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {artifact.kind ||
                      getFileExtensionDisplayName(
                        artifactDisplayPath(artifact.path),
                      )}
                  </span>
                </span>
                <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground opacity-70 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </section>
      )}

      {summary.verifications.length > 0 && (
        <section aria-label={t.message.verificationRan} className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircle2Icon className="size-4 shrink-0 text-muted-foreground" />
            {t.message.verificationRan}
            <span className="rounded-full bg-muted/60 px-1.5 py-0.5 font-mono text-xs font-medium text-muted-foreground">
              {summary.verifications.filter((v) => v.passed).length}/
              {summary.verifications.length}
            </span>
          </div>
          <ul className="overflow-hidden rounded-lg border border-border-default bg-muted/25 divide-y divide-border-default">
            {summary.verifications.map((entry) => {
              const passed = entry.passed;
              const label = friendlyVerificationName(entry.toolName);
              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-2 px-3 py-2 text-xs"
                >
                  {passed ? (
                    <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-success" />
                  ) : (
                    <XCircleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">
                        {label}
                      </span>
                      <span
                        className={cn(
                          "rounded px-1 py-0.5 text-xs font-mono font-medium",
                          passed
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {passed
                          ? t.message.verificationPassed
                          : t.message.verificationFailed}
                      </span>
                    </div>
                    {entry.detail && (
                      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-1.5 font-mono text-xs leading-relaxed text-muted-foreground">
                        {entry.detail}
                      </pre>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {reviewableChanges.length > 0 && (
        <section
          aria-label={t.message.changesSummary}
          className="mt-3 min-w-0 overflow-hidden rounded-xl border border-border-default bg-muted/[0.12]"
          data-testid="output-change-set"
        >
          <div className="flex min-w-0 items-center gap-3 border-b border-border-default bg-muted/25 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-[var(--shadow-xs)]">
              <FilesIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground/90">
                {t.message.completedChanges}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {changeSummaryLabel}
              </span>
            </span>
            <span
              className="shrink-0 font-mono text-xs"
              aria-label={`+${totalAdded} -${totalRemoved}`}
            >
              <span className="text-success">+{totalAdded}</span>
              <span className="mx-1 text-muted-foreground"> </span>
              <span className="text-destructive">-{totalRemoved}</span>
            </span>
            <button
              type="button"
              onClick={openChangesReview}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              aria-label={t.message.changesSummary}
            >
              <span className="hidden sm:inline">
                {t.message.changesSummary}
              </span>
              <ChevronRightIcon className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <ul className="max-h-72 divide-y divide-border-default overflow-y-auto">
            {reviewableChanges.map((change) => (
              <ChangeRow
                key={change.path}
                change={change}
                threadId={threadId}
                onOpen={
                  finalOutputChanges.includes(change)
                    ? () => openArtifact(change.path)
                    : openChangesReview
                }
                presentation="final"
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * One file row in the changes summary. When the server streamed
 * per-hunk metadata (FileChangeItem.changes[].hunks) the row becomes
 * expandable and each hunk can be accepted or rejected individually.
 * Reject reverse-applies just that hunk through the same
 * ``/api/fs/revert-diff`` endpoint the "撤销" (revert-all) button uses;
 * accept is informational — the file already contains the change.
 */
function ChangeRow({
  change,
  threadId,
  onOpen,
  presentation,
}: {
  change: OutputChange;
  threadId?: string;
  onOpen?: () => void;
  presentation: "final" | "process";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [decisions, setDecisions] = useState<
    Record<string, "accepted" | "rejected">
  >({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const hasHunks = change.hunks.length > 0;

  const rejectHunk = async (hunk: FileHunk) => {
    if (rejecting) return;
    setRejecting(hunk.id);
    try {
      const base = getBackendBaseURL();
      const response = await fetch(`${base}/api/fs/revert-diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: change.path,
          diff: singleHunkDiff(change.path, hunk, change.diff ?? null),
          thread_id: threadId,
          delete_empty: false,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response));
      }
      setDecisions((prev) => ({ ...prev, [hunk.id]: "rejected" }));
      notifyWorkspaceChanged();
      toast.success(t.message.hunkReverted);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.message.hunkRevertFailed,
      );
    } finally {
      setRejecting(null);
    }
  };

  return (
    <li
      className={cn(
        "min-w-0 text-sm",
        presentation === "final" && "bg-background/35",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 text-[13px] leading-5 text-muted-foreground transition-colors",
          presentation === "final"
            ? "group/change-row px-3 py-2.5 hover:bg-muted/20"
            : "group/process-row py-1",
        )}
      >
        <FilePenLineIcon
          className={cn(
            "shrink-0 text-muted-foreground",
            presentation === "final" ? "size-4" : "size-3.5",
          )}
        />
        {onOpen ? (
          <button
            type="button"
            title={change.path}
            onClick={onOpen}
            className="min-w-0 flex-1 truncate text-left font-mono text-foreground/80 transition-colors hover:text-foreground hover:underline"
          >
            {changeDisplayPath(change.path)}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-foreground/80">
            {changeDisplayPath(change.path)}
          </span>
        )}
        {change.diffTruncated && (
          <span
            title={t.message.diffTruncatedTooltip}
            className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-xs text-warning"
          >
            {t.message.diffTruncated}
          </span>
        )}
        <span className="shrink-0 font-mono text-xs">
          <span className="text-success">+{change.added}</span>
          <span className="mx-1 text-muted-foreground"> </span>
          <span className="text-destructive">-{change.removed}</span>
        </span>
        {/* Disclosure sits at the row's trailing edge: the file name is what a
            reader scans for, so the affordance follows the content instead of
            indenting every path behind a chevron. */}
        {hasHunks && (
          <button
            type="button"
            aria-label={t.message.changesSummary}
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDownIcon
              className={cn(
                "size-3.5 transition-transform",
                !open && "-rotate-90",
              )}
            />
          </button>
        )}
      </div>
      {hasHunks && open && (
        <div className="ml-4 flex flex-col gap-1.5 border-l-2 border-border/50 py-1.5 pl-3">
          {change.hunks.map((hunk) => (
            <HunkDecisionRow
              key={hunk.id}
              hunk={hunk}
              decision={decisions[hunk.id] ?? hunk.decision}
              rejecting={rejecting === hunk.id}
              onAccept={() =>
                setDecisions((prev) => ({ ...prev, [hunk.id]: "accepted" }))
              }
              onReject={() => void rejectHunk(hunk)}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function HunkDecisionRow({
  hunk,
  decision,
  rejecting,
  onAccept,
  onReject,
}: {
  hunk: FileHunk;
  decision: "pending" | "accepted" | "rejected";
  rejecting: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { t } = useI18n();
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  return (
    <div
      className="overflow-hidden rounded border border-border-subtle bg-card/60 text-xs"
      data-hunk-decision={decision}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-muted/30 px-2 py-1">
        <span className="font-mono text-xs text-muted-foreground">
          {header}
        </span>
        <div className="flex items-center gap-1.5">
          {decision === "pending" ? (
            <>
              <button
                type="button"
                onClick={onAccept}
                className="inline-flex h-6 items-center rounded-md border border-border-default px-2 text-xs font-medium text-success transition-colors hover:bg-success/10 dark:text-success"
              >
                {t.message.accept}
              </button>
              <button
                type="button"
                onClick={onReject}
                disabled={rejecting}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-border-default px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-55 dark:text-destructive"
              >
                {rejecting && (
                  <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
                )}
                {t.message.reject}
              </button>
            </>
          ) : (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide",
                decision === "accepted"
                  ? "bg-success/15 text-success"
                  : "bg-destructive/15 text-destructive",
              )}
            >
              {decision === "accepted"
                ? t.message.accepted
                : t.message.rejected}
            </span>
          )}
        </div>
      </div>
      <pre className="max-h-48 overflow-auto font-mono text-xs leading-snug">
        {hunk.body.split(/\r?\n/).map((line, idx) =>
          line ? (
            <div key={idx} className={cn("px-2", hunkLineTone(line))}>
              {line}
            </div>
          ) : null,
        )}
      </pre>
    </div>
  );
}

function hunkLineTone(line: string): string {
  if (line.startsWith("@@")) return "text-muted-foreground";
  if (line.startsWith("+")) return "bg-success/10 text-success";
  if (line.startsWith("-")) return "bg-destructive/10 text-destructive";
  return "text-foreground/80";
}

function notifyWorkspaceChanged() {
  window.dispatchEvent(new CustomEvent("echo:workspace-changed"));
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
    if (payload?.detail?.error) return String(payload.detail.error);
  } catch (e) {
    swallow(e);
  }
  return response.statusText || `Request failed (${response.status})`;
}
