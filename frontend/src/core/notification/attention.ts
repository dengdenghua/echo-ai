/**
 * Long-task attention notifications: decide when a thread needs the user —
 * it completed, failed, waits on an approval / reply, or paused — and hand
 * one deduplicated, throttled notification per occurrence to a deliverer.
 *
 * Two existing frontend signals feed it; no extra backend protocol:
 *
 *  - ``thread:run-status`` (event bus): the mounted realtime thread page
 *    publishes its derived run state. Only the thread on screen has a live
 *    socket, so this covers exactly one thread at a time, with the precise
 *    outcome (completed vs failed, approval vs pause cause).
 *  - ``/api/tasks`` snapshots (PauseController): every running ReAct task,
 *    plus checkpointed pauses with their reason. This covers threads that are
 *    not on screen (and background loop attempts): a new pause entry, or an
 *    active task leaving without pausing ("finished" — the endpoint does not
 *    say whether it succeeded).
 *
 * Threads with a mounted page are left to the live signal; the polled diff
 * only speaks for detached threads. Pure (no React / DOM) so the trigger
 * rules are unit-tested in isolation.
 */
import type { EventMap, ThreadAttentionSignal } from "@/core/events";
import type { AttentionNotificationCopy } from "@/core/i18n/locales/attention-notifications";
import type { LocalSettings } from "@/core/settings";
import type { PauseRequest, TasksListResponse } from "@/core/tasks/api";

import type { ThreadAttentionEntry } from "./attention-store";

export type AttentionKind =
  | "completed"
  | "finished"
  | "failed"
  | "approval"
  | "blocked"
  | "paused";

/** User-facing toggles (settings page). */
export type AttentionCategory = "completed" | "failed" | "approval" | "paused";

export type AttentionReason = NonNullable<ThreadAttentionSignal["reason"]>;

export interface AttentionEvent {
  /** Identity of the occurrence (thread, run episode, what happened). Both
   * sources derive the same key for the same occurrence, so it is delivered
   * at most once whichever source reports it first. */
  key: string;
  kind: AttentionKind;
  threadId: string;
  href: string;
  reason?: AttentionReason;
  title?: string;
  taskId?: string;
  source: "live" | "tasks";
}

export interface AttentionPrefs {
  enabled: boolean;
  onlyWhenUnfocused: boolean;
  categories: Record<AttentionCategory, boolean>;
}

export interface AttentionViewContext {
  /** Window visible and focused. */
  appFocused: boolean;
  /** Thread whose conversation page is the current route. */
  visibleThreadId: string | null;
}

export type RunStatusPayload = EventMap["thread:run-status"];

/** Sink for the sidebar markers (see attention-store.ts). */
export interface ThreadAttentionSink {
  set(entry: ThreadAttentionEntry): void;
  /** Update the cause shown on the marker without touching ``unseen``. */
  describe(
    threadId: string,
    kind: ThreadAttentionEntry["kind"],
    reason?: AttentionReason,
  ): void;
  clear(threadId: string): void;
  clearTask(taskId: string): void;
}

export interface AttentionTrackerOptions {
  getContext: () => AttentionViewContext;
  getPrefs: () => AttentionPrefs;
  deliver: (event: AttentionEvent) => void;
  /** Called once the burst limit swallowed ``count`` notifications. */
  deliverSummary: (count: number) => void;
  sink?: ThreadAttentionSink;
  now?: () => number;
  /** Live terminal states settle this long before notifying, so a brief
   * error/done flicker while the turn closes reports the final outcome. */
  settleMs?: number;
  /** Token bucket: ``burst`` notifications, one more every ``refillMs``. */
  burst?: number;
  refillMs?: number;
}

export interface AttentionTracker {
  ingestRunStatus(payload: RunStatusPayload): void;
  ingestTasks(data: TasksListResponse | undefined): void;
  dispose(): void;
}

export const ATTENTION_SETTLE_MS = 1_500;
export const ATTENTION_BURST = 3;
export const ATTENTION_REFILL_MS = 5_000;
const SENT_KEY_LIMIT = 500;

export function threadRouteForAttention(threadId: string): string {
  return `/workspace/realtime/${encodeURIComponent(threadId)}`;
}

/** Thread id of the realtime conversation route, if that is the route. */
export function threadIdFromPathname(pathname: string): string | null {
  const match = /^\/workspace\/realtime\/([^/?#]+)/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function attentionCategory(kind: AttentionKind): AttentionCategory {
  if (kind === "completed" || kind === "finished") return "completed";
  if (kind === "failed") return "failed";
  if (kind === "approval" || kind === "blocked") return "approval";
  return "paused";
}

/**
 * Map a PauseController record onto an attention signal. ``user_request``
 * pauses are the user's own doing and return null. The wall-clock cap has no
 * reason of its own: the runtime files it as ``external`` with a
 * "wall-time limit exceeded" note.
 */
export function classifyPauseRequest(
  request: Pick<PauseRequest, "reason" | "note">,
): ThreadAttentionSignal | null {
  switch (request.reason) {
    case "user_request":
      return null;
    case "approval_required":
      return { kind: "approval", reason: "approval_timeout" };
    case "budget_near_limit":
      return { kind: "paused", reason: "budget" };
    case "iteration_near_limit":
      return { kind: "paused", reason: "iteration" };
    case "model_spinning":
      return { kind: "paused", reason: "model_spinning" };
    default:
      return {
        kind: "paused",
        reason: /wall[\s_-]?time/i.test(request.note ?? "")
          ? "wall_clock"
          : "other",
      };
  }
}

export function attentionPrefsFromSettings(
  notification: LocalSettings["notification"],
): AttentionPrefs {
  return {
    enabled: notification.enabled,
    onlyWhenUnfocused: notification.only_when_unfocused ?? false,
    categories: {
      completed: notification.completed ?? true,
      failed: notification.failed ?? true,
      approval: notification.approval ?? true,
      paused: notification.paused ?? true,
    },
  };
}

export function isViewingThread(
  context: AttentionViewContext,
  threadId: string,
): boolean {
  return context.appFocused && context.visibleThreadId === threadId;
}

/** Settings + "is the user already looking at it" gate. */
export function shouldNotifyAttention(
  event: Pick<AttentionEvent, "kind" | "threadId">,
  context: AttentionViewContext,
  prefs: AttentionPrefs,
): boolean {
  if (!prefs.enabled) return false;
  if (!prefs.categories[attentionCategory(event.kind)]) return false;
  if (context.appFocused) {
    if (prefs.onlyWhenUnfocused) return false;
    if (context.visibleThreadId === event.threadId) return false;
  }
  return true;
}

export function attentionTitle(
  copy: AttentionNotificationCopy,
  kind: AttentionKind,
  reason?: AttentionReason,
): string {
  switch (kind) {
    case "completed":
      return copy.completedTitle;
    case "finished":
      return copy.finishedTitle;
    case "failed":
      return copy.failedTitle;
    case "blocked":
      return copy.blockedTitle;
    case "approval":
      return reason === "approval_timeout"
        ? copy.approvalTimeoutTitle
        : copy.approvalTitle;
    case "paused":
      if (reason === "budget") return copy.pausedBudgetTitle;
      if (reason === "iteration") return copy.pausedIterationTitle;
      if (reason === "wall_clock") return copy.pausedWallClockTitle;
      if (reason === "model_spinning") return copy.pausedSpinningTitle;
      return copy.pausedTitle;
  }
}

export function attentionBody(
  copy: AttentionNotificationCopy,
  event: Pick<AttentionEvent, "kind" | "title">,
): string {
  const title = event.title?.trim() || copy.untitledThread;
  if (event.kind === "finished") return `${title}\n${copy.finishedHint}`;
  if (event.kind === "completed" || event.kind === "failed") return title;
  return `${title}\n${copy.actionHint}`;
}

type TrackState = "running" | "pending" | "waiting" | "error" | "done";

interface ThreadTrack {
  state?: TrackState;
  /** ``kind:reason`` of the current wait, so a new cause re-notifies. */
  attention?: string;
  /** Bumped every time the thread starts running again. */
  episode: number;
  href?: string;
  title?: string;
  terminal?: {
    kind: "completed" | "failed";
    /** The user was looking at the thread when it settled. */
    seen: boolean;
    timer: ReturnType<typeof setTimeout>;
  };
}

interface TasksBaseline {
  /** task_id → thread_id */
  active: Map<string, string>;
  /** task_id → identity of the pause record */
  paused: Map<string, string>;
}

function isRunningState(state: TrackState | undefined): boolean {
  return state === "running" || state === "pending";
}

function pauseStamp(request: PauseRequest): string {
  return `${request.task_id}@${request.requested_at}`;
}

function signalKey(signal: ThreadAttentionSignal): string {
  return `${signal.kind}:${signal.reason ?? ""}`;
}

function occurrenceKey(
  threadId: string,
  episode: number,
  what: string,
): string {
  return `${threadId}\u0000${episode}\u0000${what}`;
}

export function createAttentionTracker(
  options: AttentionTrackerOptions,
): AttentionTracker {
  const now = options.now ?? Date.now;
  const settleMs = options.settleMs ?? ATTENTION_SETTLE_MS;
  const burst = Math.max(1, options.burst ?? ATTENTION_BURST);
  const refillMs = options.refillMs ?? ATTENTION_REFILL_MS;
  const sink = options.sink;

  const threads = new Map<string, ThreadTrack>();
  const liveThreads = new Set<string>();
  const sentKeys = new Set<string>();
  let baseline: TasksBaseline | null = null;
  let tokens = burst;
  let lastRefill = now();
  let suppressed = 0;
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const track = (threadId: string): ThreadTrack => {
    let entry = threads.get(threadId);
    if (!entry) {
      entry = { episode: 0 };
      threads.set(threadId, entry);
    }
    return entry;
  };

  const hrefFor = (threadId: string, entry: ThreadTrack) =>
    entry.href ?? threadRouteForAttention(threadId);

  const viewing = (threadId: string) =>
    isViewingThread(options.getContext(), threadId);

  const takeToken = (): boolean => {
    const current = now();
    const refills = Math.floor((current - lastRefill) / refillMs);
    if (refills > 0) {
      tokens = Math.min(burst, tokens + refills);
      lastRefill += refills * refillMs;
    }
    if (tokens >= 1) {
      tokens -= 1;
      return true;
    }
    return false;
  };

  const flushSummary = () => {
    summaryTimer = null;
    if (disposed || suppressed === 0) return;
    if (!takeToken()) {
      summaryTimer = setTimeout(flushSummary, refillMs);
      return;
    }
    const count = suppressed;
    suppressed = 0;
    options.deliverSummary(count);
  };

  const updateSink = (event: AttentionEvent, seen: boolean) => {
    if (!sink) return;
    if (event.kind === "completed" || event.kind === "finished") {
      sink.clear(event.threadId);
      return;
    }
    sink.set({
      threadId: event.threadId,
      kind: event.kind,
      reason: event.reason,
      taskId: event.taskId,
      at: now(),
      unseen: !seen,
    });
  };

  /** ``seen``: the user already saw it happen (it settled on screen). */
  const emit = (event: AttentionEvent, seen = false) => {
    if (disposed || sentKeys.has(event.key)) return;
    sentKeys.add(event.key);
    if (sentKeys.size > SENT_KEY_LIMIT) {
      const oldest = sentKeys.values().next().value;
      if (oldest !== undefined) sentKeys.delete(oldest);
    }
    const alreadySeen = seen || viewing(event.threadId);
    updateSink(event, alreadySeen);
    if (seen) return;
    if (
      !shouldNotifyAttention(event, options.getContext(), options.getPrefs())
    ) {
      return;
    }
    if (takeToken()) {
      options.deliver(event);
      return;
    }
    suppressed += 1;
    summaryTimer ??= setTimeout(flushSummary, refillMs);
  };

  const cancelTerminal = (entry: ThreadTrack) => {
    if (!entry.terminal) return;
    clearTimeout(entry.terminal.timer);
    entry.terminal = undefined;
  };

  const scheduleTerminal = (
    threadId: string,
    entry: ThreadTrack,
    kind: "completed" | "failed",
  ) => {
    if (entry.terminal) {
      // Keep the original deadline; only the final outcome changes.
      entry.terminal.kind = kind;
      entry.terminal.seen ||= viewing(threadId);
      return;
    }
    const episode = entry.episode;
    const timer = setTimeout(() => {
      const pending = entry.terminal;
      entry.terminal = undefined;
      if (!pending) return;
      emit(
        {
          key: occurrenceKey(threadId, episode, "terminal"),
          kind: pending.kind,
          threadId,
          href: hrefFor(threadId, entry),
          title: entry.title,
          source: "live",
        },
        pending.seen,
      );
    }, settleMs);
    entry.terminal = { kind, seen: viewing(threadId), timer };
  };

  const startRunning = (
    threadId: string,
    entry: ThreadTrack,
    state: "running" | "pending",
  ) => {
    if (!isRunningState(entry.state)) {
      entry.episode += 1;
      sink?.clear(threadId);
    }
    cancelTerminal(entry);
    entry.state = state;
    entry.attention = undefined;
  };

  const snapshotPaused = (paused: Map<string, PauseRequest>) =>
    new Map(
      Array.from(paused, ([taskId, request]) => [taskId, pauseStamp(request)]),
    );

  return {
    ingestRunStatus(payload) {
      const threadId = payload.threadId?.trim();
      if (!threadId || disposed) return;
      const entry = track(threadId);
      if (payload.href) entry.href = payload.href;
      if (payload.title?.trim()) entry.title = payload.title.trim();
      const { state } = payload;
      if (state === null) {
        // The page went away (unmount / thread switch). Keep the state so a
        // remount compares against it; the poll speaks for it meanwhile.
        liveThreads.delete(threadId);
        return;
      }
      liveThreads.add(threadId);
      const previous = entry.state;

      if (state === "running" || state === "pending") {
        startRunning(threadId, entry, state);
        return;
      }

      if (state === "waiting") {
        const signal = payload.attention ?? { kind: "paused" as const };
        const key = signalKey(signal);
        // A pending (unsettled) done/error that turns into a wait was the
        // turn closing into a pause, not a real terminal state.
        const changed =
          isRunningState(previous) ||
          entry.terminal !== undefined ||
          (previous === "waiting" && entry.attention !== key);
        cancelTerminal(entry);
        entry.state = "waiting";
        entry.attention = key;
        if (!changed || signal.reason === "user") {
          sink?.describe(threadId, signal.kind, signal.reason);
          return;
        }
        emit({
          key: occurrenceKey(threadId, entry.episode, key),
          kind: signal.kind,
          reason: signal.reason,
          threadId,
          href: hrefFor(threadId, entry),
          title: entry.title,
          source: "live",
        });
        return;
      }

      // done / error
      if (
        isRunningState(previous) ||
        previous === "waiting" ||
        entry.terminal !== undefined
      ) {
        scheduleTerminal(
          threadId,
          entry,
          state === "done" ? "completed" : "failed",
        );
      }
      entry.state = state;
      entry.attention = undefined;
    },

    ingestTasks(data) {
      if (!data || disposed) return;
      const active = new Map<string, string>();
      for (const task of data.active ?? []) {
        active.set(task.task_id, task.thread_id?.trim() ?? "");
      }
      const paused = new Map<string, PauseRequest>();
      for (const request of data.paused ?? []) {
        paused.set(request.task_id, request);
      }
      const pending = new Set((data.pending ?? []).map((r) => r.task_id));
      const activeThreads = new Set(
        Array.from(active.values()).filter(Boolean),
      );

      if (!baseline) {
        // First snapshot: whatever is already paused or running predates
        // this session's observation — remember it, announce nothing.
        for (const threadId of activeThreads) {
          if (liveThreads.has(threadId)) continue;
          const entry = track(threadId);
          if (!isRunningState(entry.state)) {
            entry.episode += 1;
            entry.state = "running";
          }
        }
        baseline = { active, paused: snapshotPaused(paused) };
        return;
      }

      for (const threadId of activeThreads) {
        if (liveThreads.has(threadId)) continue;
        startRunning(threadId, track(threadId), "running");
      }

      for (const [taskId, request] of paused) {
        const stamp = pauseStamp(request);
        if (baseline.paused.get(taskId) === stamp) continue;
        const threadId = request.thread_id?.trim();
        // A mounted page reports its own pause (with this same reason).
        if (!threadId || liveThreads.has(threadId)) continue;
        const entry = track(threadId);
        cancelTerminal(entry);
        entry.state = "waiting";
        const signal = classifyPauseRequest(request);
        if (!signal) {
          entry.attention = "paused:user";
          sink?.describe(threadId, "paused", "user");
          continue;
        }
        entry.attention = signalKey(signal);
        emit({
          key: occurrenceKey(threadId, entry.episode, entry.attention),
          kind: signal.kind,
          reason: signal.reason,
          threadId,
          href: hrefFor(threadId, entry),
          title: entry.title,
          taskId,
          source: "tasks",
        });
      }

      for (const [taskId, threadId] of baseline.active) {
        if (active.has(taskId) || paused.has(taskId) || pending.has(taskId)) {
          continue;
        }
        if (
          !threadId ||
          liveThreads.has(threadId) ||
          activeThreads.has(threadId)
        ) {
          continue;
        }
        const entry = track(threadId);
        if (!isRunningState(entry.state)) continue;
        entry.state = "done";
        entry.attention = undefined;
        emit({
          key: occurrenceKey(threadId, entry.episode, "terminal"),
          kind: "finished",
          threadId,
          href: hrefFor(threadId, entry),
          title: entry.title,
          taskId,
          source: "tasks",
        });
      }

      // A pause that vanished without its task running again was dismissed
      // (or resumed and already finished): its marker has nothing to say.
      for (const taskId of baseline.paused.keys()) {
        if (!paused.has(taskId) && !pending.has(taskId)) {
          sink?.clearTask(taskId);
        }
      }

      baseline = { active, paused: snapshotPaused(paused) };
    },

    dispose() {
      disposed = true;
      for (const entry of threads.values()) cancelTerminal(entry);
      if (summaryTimer !== null) clearTimeout(summaryTimer);
      summaryTimer = null;
    },
  };
}
