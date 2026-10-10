import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attentionNotificationsZhCN } from "@/core/i18n/locales/attention-notifications";
import type { PauseRequest, TasksListResponse } from "@/core/tasks/api";

import {
  attentionBody,
  attentionPrefsFromSettings,
  attentionTitle,
  classifyPauseRequest,
  createAttentionTracker,
  shouldNotifyAttention,
  threadIdFromPathname,
  type AttentionEvent,
  type AttentionPrefs,
  type AttentionViewContext,
  type ThreadAttentionSink,
} from "./attention";

const ALL_ON: AttentionPrefs = {
  enabled: true,
  onlyWhenUnfocused: false,
  categories: { completed: true, failed: true, approval: true, paused: true },
};

function setup({
  context = { appFocused: false, visibleThreadId: null },
  prefs = ALL_ON,
  burst,
}: {
  context?: AttentionViewContext;
  prefs?: AttentionPrefs;
  burst?: number;
} = {}) {
  const view = { ...context };
  const settings = { ...prefs };
  const delivered: AttentionEvent[] = [];
  const summaries: number[] = [];
  const sink: ThreadAttentionSink = {
    set: vi.fn(),
    describe: vi.fn(),
    clear: vi.fn(),
    clearTask: vi.fn(),
  };
  const tracker = createAttentionTracker({
    getContext: () => view,
    getPrefs: () => settings,
    deliver: (event) => delivered.push(event),
    deliverSummary: (count) => summaries.push(count),
    sink,
    burst,
  });
  return { tracker, view, settings, delivered, summaries, sink };
}

function pause(
  taskId: string,
  threadId: string,
  reason: PauseRequest["reason"],
  extra: Partial<PauseRequest> = {},
): PauseRequest {
  return {
    task_id: taskId,
    thread_id: threadId,
    reason,
    requested_at: 100,
    requested_by: "system",
    note: "",
    agent_id: "general",
    ...extra,
  };
}

function active(taskId: string, threadId: string) {
  return {
    task_id: taskId,
    thread_id: threadId,
    agent_id: "general",
    started_at: 1,
    current_iteration: 1,
    max_iterations: 10,
    tokens_spent: 0,
    cost_usd: 0,
    max_tokens: 0,
    max_usd: 0,
  };
}

function snapshot(parts: TasksListResponse): TasksListResponse {
  return { active: [], paused: [], pending: [], ...parts };
}

describe("attention notification rules", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies a completed turn once it settles, not on the first flicker", () => {
    const { tracker, delivered } = setup();
    tracker.ingestRunStatus({
      threadId: "t1",
      state: "running",
      title: "写报告",
    });
    tracker.ingestRunStatus({ threadId: "t1", state: "error" });
    tracker.ingestRunStatus({ threadId: "t1", state: "done" });
    expect(delivered).toHaveLength(0);

    vi.advanceTimersByTime(1_600);
    expect(delivered).toEqual([
      expect.objectContaining({
        kind: "completed",
        threadId: "t1",
        href: "/workspace/realtime/t1",
        title: "写报告",
        source: "live",
      }),
    ]);
  });

  it("drops a terminal state that turns back into running", () => {
    const { tracker, delivered } = setup();
    tracker.ingestRunStatus({ threadId: "t1", state: "running" });
    tracker.ingestRunStatus({ threadId: "t1", state: "done" });
    tracker.ingestRunStatus({ threadId: "t1", state: "running" });
    vi.advanceTimersByTime(5_000);
    expect(delivered).toHaveLength(0);
  });

  it("reports failures and does not announce history on first sight", () => {
    const { tracker, delivered } = setup();
    // Opening a thread that already failed earlier: no transition observed.
    tracker.ingestRunStatus({ threadId: "old", state: "error" });
    tracker.ingestRunStatus({ threadId: "t1", state: "running" });
    tracker.ingestRunStatus({ threadId: "t1", state: "error" });
    vi.advanceTimersByTime(2_000);
    expect(delivered.map((event) => [event.threadId, event.kind])).toEqual([
      ["t1", "failed"],
    ]);
  });

  it("notifies approvals and each new wait cause in one run", () => {
    const { tracker, delivered } = setup();
    tracker.ingestRunStatus({ threadId: "t1", state: "running" });
    tracker.ingestRunStatus({
      threadId: "t1",
      state: "waiting",
      attention: { kind: "approval" },
    });
    // Same wait re-published (title change, re-render): still one.
    tracker.ingestRunStatus({
      threadId: "t1",
      state: "waiting",
      attention: { kind: "approval" },
      title: "部署",
    });
    // The approval timed out into a checkpointed pause: a new cause.
    tracker.ingestRunStatus({
      threadId: "t1",
      state: "waiting",
      attention: { kind: "approval", reason: "approval_timeout" },
    });
    expect(delivered.map((event) => [event.kind, event.reason])).toEqual([
      ["approval", undefined],
      ["approval", "approval_timeout"],
    ]);
  });

  it("treats a done that settles into a pause as the pause", () => {
    const { tracker, delivered } = setup();
    tracker.ingestRunStatus({ threadId: "t1", state: "running" });
    tracker.ingestRunStatus({ threadId: "t1", state: "done" });
    tracker.ingestRunStatus({
      threadId: "t1",
      state: "waiting",
      attention: { kind: "paused", reason: "budget" },
    });
    vi.advanceTimersByTime(2_000);
    expect(delivered.map((event) => [event.kind, event.reason])).toEqual([
      ["paused", "budget"],
    ]);
  });

  it("never notifies the user's own pause", () => {
    const { tracker, delivered, sink } = setup();
    tracker.ingestRunStatus({ threadId: "t1", state: "running" });
    tracker.ingestRunStatus({
      threadId: "t1",
      state: "waiting",
      attention: { kind: "paused", reason: "user" },
    });
    expect(delivered).toHaveLength(0);
    expect(sink.describe).toHaveBeenCalledWith("t1", "paused", "user");
  });

  describe("foreground / visible thread", () => {
    it("stays quiet for the thread on screen while the window is focused", () => {
      const { tracker, delivered, sink } = setup({
        context: { appFocused: true, visibleThreadId: "t1" },
      });
      tracker.ingestRunStatus({ threadId: "t1", state: "running" });
      tracker.ingestRunStatus({
        threadId: "t1",
        state: "waiting",
        attention: { kind: "approval" },
      });
      expect(delivered).toHaveLength(0);
      // Marker recorded as already seen: no sticky sidebar light.
      expect(sink.set).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "t1", unseen: false }),
      );
    });

    it("notifies the thread on screen when the window is in the background", () => {
      const { tracker, delivered, sink } = setup({
        context: { appFocused: false, visibleThreadId: "t1" },
      });
      tracker.ingestRunStatus({ threadId: "t1", state: "running" });
      tracker.ingestRunStatus({
        threadId: "t1",
        state: "waiting",
        attention: { kind: "approval" },
      });
      expect(delivered).toHaveLength(1);
      expect(sink.set).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "t1", unseen: true }),
      );
    });

    it("notifies another thread even while the window is focused", () => {
      const { tracker, delivered } = setup({
        context: { appFocused: true, visibleThreadId: "other" },
      });
      tracker.ingestTasks(snapshot({ active: [active("task-1", "t1")] }));
      tracker.ingestTasks(
        snapshot({ paused: [pause("task-1", "t1", "budget_near_limit")] }),
      );
      expect(delivered.map((event) => event.kind)).toEqual(["paused"]);
    });

    it("skips a completion the user watched settle, even after leaving", () => {
      const { tracker, delivered, view } = setup({
        context: { appFocused: true, visibleThreadId: "t1" },
      });
      tracker.ingestRunStatus({ threadId: "t1", state: "running" });
      tracker.ingestRunStatus({ threadId: "t1", state: "done" });
      view.visibleThreadId = "t2";
      tracker.ingestRunStatus({ threadId: "t1", state: null });
      vi.advanceTimersByTime(2_000);
      expect(delivered).toHaveLength(0);
    });
  });

  describe("settings", () => {
    it("honours the master switch and per-category toggles", () => {
      const { tracker, delivered, settings } = setup();
      settings.categories = { ...ALL_ON.categories, completed: false };
      tracker.ingestRunStatus({ threadId: "t1", state: "running" });
      tracker.ingestRunStatus({ threadId: "t1", state: "done" });
      vi.advanceTimersByTime(2_000);
      expect(delivered).toHaveLength(0);

      settings.categories = ALL_ON.categories;
      settings.enabled = false;
      tracker.ingestRunStatus({ threadId: "t2", state: "running" });
      tracker.ingestRunStatus({ threadId: "t2", state: "error" });
      vi.advanceTimersByTime(2_000);
      expect(delivered).toHaveLength(0);
    });

    it("maps local settings, defaulting categories to on", () => {
      expect(attentionPrefsFromSettings({ enabled: true })).toEqual(ALL_ON);
      expect(
        attentionPrefsFromSettings({
          enabled: true,
          only_when_unfocused: true,
          approval: false,
        }),
      ).toMatchObject({
        onlyWhenUnfocused: true,
        categories: { approval: false, paused: true },
      });
    });

    it("only-when-unfocused silences other threads too", () => {
      const prefs = { ...ALL_ON, onlyWhenUnfocused: true };
      const event = { kind: "failed" as const, threadId: "t1" };
      expect(
        shouldNotifyAttention(
          event,
          { appFocused: true, visibleThreadId: "t2" },
          prefs,
        ),
      ).toBe(false);
      expect(
        shouldNotifyAttention(
          event,
          { appFocused: false, visibleThreadId: "t1" },
          prefs,
        ),
      ).toBe(true);
    });
  });

  describe("polled tasks (threads without a mounted page)", () => {
    it("announces nothing from the first snapshot", () => {
      const { tracker, delivered } = setup();
      tracker.ingestTasks(
        snapshot({
          active: [active("task-1", "t1")],
          paused: [pause("task-2", "t2", "budget_near_limit")],
        }),
      );
      expect(delivered).toHaveLength(0);
    });

    it("classifies new pauses by their PauseController reason", () => {
      const { tracker, delivered } = setup();
      tracker.ingestTasks(snapshot({}));
      tracker.ingestTasks(
        snapshot({
          paused: [
            pause("a", "t-approval", "approval_required"),
            pause("b", "t-iter", "iteration_near_limit"),
            pause("c", "t-wall", "external", {
              note: "wall-time limit exceeded (wall_time_limit)",
            }),
          ],
        }),
      );
      expect(delivered.map((event) => [event.kind, event.reason])).toEqual([
        ["approval", "approval_timeout"],
        ["paused", "iteration"],
        ["paused", "wall_clock"],
      ]);
    });

    it("reports a task that left the active list without pausing as finished", () => {
      const { tracker, delivered, sink } = setup();
      tracker.ingestTasks(snapshot({ active: [active("task-1", "t1")] }));
      tracker.ingestTasks(snapshot({}));
      expect(delivered).toEqual([
        expect.objectContaining({
          kind: "finished",
          threadId: "t1",
          taskId: "task-1",
          source: "tasks",
        }),
      ]);
      expect(sink.clear).toHaveBeenCalledWith("t1");
    });

    it("does not call a paused task finished", () => {
      const { tracker, delivered } = setup();
      tracker.ingestTasks(snapshot({ active: [active("task-1", "t1")] }));
      tracker.ingestTasks(
        snapshot({ pending: [pause("task-1", "t1", "budget_near_limit")] }),
      );
      expect(delivered).toHaveLength(0);
    });

    it("leaves threads with a mounted page to the live signal", () => {
      const { tracker, delivered } = setup();
      tracker.ingestRunStatus({ threadId: "t1", state: "running" });
      tracker.ingestTasks(snapshot({ active: [active("task-1", "t1")] }));
      tracker.ingestTasks(
        snapshot({ paused: [pause("task-1", "t1", "budget_near_limit")] }),
      );
      tracker.ingestTasks(snapshot({}));
      expect(delivered).toHaveLength(0);
    });

    it("takes over once the page unmounts", () => {
      const { tracker, delivered } = setup();
      tracker.ingestRunStatus({ threadId: "t1", state: "running" });
      tracker.ingestTasks(snapshot({ active: [active("task-1", "t1")] }));
      tracker.ingestRunStatus({ threadId: "t1", state: null });
      tracker.ingestTasks(snapshot({}));
      expect(delivered.map((event) => event.kind)).toEqual(["finished"]);
    });

    it("drops the marker of a pause that was dismissed", () => {
      const { tracker, sink } = setup();
      tracker.ingestTasks(snapshot({ active: [active("task-1", "t1")] }));
      tracker.ingestTasks(
        snapshot({ paused: [pause("task-1", "t1", "budget_near_limit")] }),
      );
      tracker.ingestTasks(snapshot({}));
      expect(sink.clearTask).toHaveBeenCalledWith("task-1");
    });
  });

  describe("dedupe and throttling", () => {
    it("delivers one occurrence once, whichever source reports it", () => {
      const { tracker, delivered } = setup();
      tracker.ingestTasks(snapshot({}));
      // Live page reports the budget pause, then unmounts before the poll
      // that carries the same pause record arrives.
      tracker.ingestRunStatus({ threadId: "t1", state: "running" });
      tracker.ingestRunStatus({
        threadId: "t1",
        state: "waiting",
        attention: { kind: "paused", reason: "budget" },
      });
      tracker.ingestRunStatus({ threadId: "t1", state: null });
      tracker.ingestTasks(
        snapshot({ paused: [pause("task-1", "t1", "budget_near_limit")] }),
      );
      expect(delivered).toHaveLength(1);
    });

    it("notifies again for the next run of the same thread", () => {
      const { tracker, delivered } = setup();
      for (let run = 0; run < 2; run += 1) {
        tracker.ingestRunStatus({ threadId: "t1", state: "running" });
        tracker.ingestRunStatus({ threadId: "t1", state: "done" });
        vi.advanceTimersByTime(2_000);
      }
      expect(delivered).toHaveLength(2);
    });

    it("collapses a burst into one summary notification", () => {
      const { tracker, delivered, summaries } = setup({ burst: 2 });
      tracker.ingestTasks(snapshot({}));
      tracker.ingestTasks(
        snapshot({
          paused: ["a", "b", "c", "d"].map((id) =>
            pause(`task-${id}`, `t-${id}`, "budget_near_limit"),
          ),
        }),
      );
      expect(delivered).toHaveLength(2);
      expect(summaries).toEqual([]);
      vi.advanceTimersByTime(5_000);
      expect(summaries).toEqual([2]);
    });

    it("stops timers on dispose", () => {
      const { tracker, delivered } = setup();
      tracker.ingestRunStatus({ threadId: "t1", state: "running" });
      tracker.ingestRunStatus({ threadId: "t1", state: "done" });
      tracker.dispose();
      vi.advanceTimersByTime(5_000);
      expect(delivered).toHaveLength(0);
    });
  });
});

describe("attention helpers", () => {
  it("parses the realtime thread route", () => {
    expect(threadIdFromPathname("/workspace/realtime/abc%20d")).toBe("abc d");
    expect(threadIdFromPathname("/workspace/projects")).toBeNull();
  });

  it("ignores user pauses and spots the wall-clock cap", () => {
    expect(classifyPauseRequest({ reason: "user_request", note: "" })).toBe(
      null,
    );
    expect(
      classifyPauseRequest({
        reason: "external",
        note: "wall-time limit exceeded (wall_time_limit)",
      }),
    ).toEqual({ kind: "paused", reason: "wall_clock" });
    expect(classifyPauseRequest({ reason: "external", note: "" })).toEqual({
      kind: "paused",
      reason: "other",
    });
  });

  it("titles each kind and adds the follow-up hint", () => {
    const copy = attentionNotificationsZhCN;
    expect(attentionTitle(copy, "paused", "budget")).toBe(
      "任务已暂停：预算已达上限",
    );
    expect(attentionTitle(copy, "approval", "approval_timeout")).toBe(
      "审批超时，任务已暂停",
    );
    expect(attentionBody(copy, { kind: "completed", title: "周报" })).toBe(
      "周报",
    );
    expect(attentionBody(copy, { kind: "approval" })).toBe(
      "未命名任务\n点击前往处理。",
    );
  });
});
