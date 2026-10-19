import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RealtimeApprovalPrompt } from "@/components/workspace/realtime-approval-toasts";
import { useRealtimeThread } from "@/core/realtime/use-realtime-thread";
import { useI18n } from "@/core/i18n/hooks";
import { appTaskCopy } from "@/core/i18n/locales/personal-app-task";
import {
  appTaskInput,
  appTaskSnapshot,
  type AppTaskSnapshot,
  isAppTaskSnapshot,
  type PersonalAppTask,
} from "@/core/apps/personal-app-task";

export function PersonalAppTaskRunner({
  task,
  onSnapshot,
}: {
  task: PersonalAppTask;
  onSnapshot: (snapshot: AppTaskSnapshot) => void;
}) {
  const { locale } = useI18n();
  const copy = appTaskCopy(locale);
  const {
    state,
    readyForMutations,
    connectionPhase,
    startTurn,
    interrupt,
    resolveApproval,
    resume,
  } = useRealtimeThread({ threadId: task.id });
  const started = useRef(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [cancelledBeforeStart, setCancelledBeforeStart] = useState(false);
  const turn = state.turns.find((candidate) =>
    candidate.items.some((item) => item.id === task.clientItemId),
  );

  useEffect(() => {
    if (!readyForMutations || started.current || cancelledBeforeStart) return;
    started.current = true;
    // Never resend automatically after disconnect or an uncertain receipt.
    if (turn) return;
    void startTurn({
      input: appTaskInput(task.appName, task.request),
      clientItemId: task.clientItemId,
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "workspaceWrite", networkAccess: false },
      metadata: {
        source: "personal-app",
        appId: task.appId,
        deploymentId: task.deploymentId,
      },
    }).catch((error: unknown) =>
      setSendError(error instanceof Error ? error.message : String(error)),
    );
  }, [readyForMutations, startTurn, task, turn, cancelledBeforeStart]);

  const snapshot = appTaskSnapshot(task.id, turn);
  if (cancelledBeforeStart) {
    snapshot.status = "cancelled";
    snapshot.terminal = true;
  } else if (!snapshot.terminal) {
    snapshot.status =
      sendError && !turn
        ? "unknown"
        : connectionPhase === "recovery_error"
          ? "recovery_error"
          : !readyForMutations
            ? started.current
              ? "reconnecting"
              : "connecting"
            : state.pendingApprovals.length
              ? "awaiting_approval"
              : "running";
  }
  // A resolved startTurn promise is not proof of completion: reconnect may
  // resolve it before durable history provides the authoritative outcome.
  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    const parsed: unknown = JSON.parse(serialized);
    if (isAppTaskSnapshot(parsed)) onSnapshot(parsed);
  }, [serialized, onSnapshot]);

  const stop = async () => {
    if (!started.current) {
      setCancelledBeforeStart(true);
      return;
    }
    setStopping(true);
    setControlError(null);
    try {
      await interrupt();
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    } finally {
      setStopping(false);
    }
  };

  return (
    <section
      className="space-y-2 rounded-md border p-3 text-sm"
      aria-label={copy.task}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status">{copy.status[snapshot.status] ?? snapshot.status}</p>
        <div className="flex gap-2">
          {!snapshot.terminal && (
            <Button
              size="sm"
              variant="outline"
              disabled={
                stopping || (started.current && (!readyForMutations || !turn))
              }
              onClick={() => void stop()}
            >
              {copy.stop}
            </Button>
          )}
          {connectionPhase === "recovery_error" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void resume().catch((error: unknown) =>
                  setControlError(String(error)),
                );
              }}
            >
              {copy.reconnect}
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link to={snapshot.route}>{copy.open}</Link>
          </Button>
        </div>
      </div>
      {!snapshot.terminal && (
        <p className="text-xs text-muted-foreground">{copy.closeHint}</p>
      )}
      {((sendError && !turn) || controlError) && (
        <p role="alert">{controlError ?? sendError}</p>
      )}
      <RealtimeApprovalPrompt
        approvals={state.pendingApprovals}
        resolveApproval={resolveApproval}
      />
      {snapshot.text && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
          {snapshot.text}
        </pre>
      )}
    </section>
  );
}
