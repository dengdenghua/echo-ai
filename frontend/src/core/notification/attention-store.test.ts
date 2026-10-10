import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildThreadRunStatusByHref,
  unseenAttentionStatusByHref,
} from "@/core/threads/sidebar";

import {
  clearThreadAttentionForTask,
  describeThreadAttention,
  getThreadAttentionSnapshot,
  markThreadAttentionSeen,
  resetThreadAttentionForTests,
  setThreadAttention,
  subscribeThreadAttention,
} from "./attention-store";

const href = (id: string) => `/workspace/realtime/${id}`;

describe("thread attention store", () => {
  afterEach(() => {
    resetThreadAttentionForTests();
  });

  it("keeps a marker until the thread is seen, then only its label", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThreadAttention(listener);
    setThreadAttention({
      threadId: "t1",
      kind: "approval",
      at: 1,
      unseen: true,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    markThreadAttentionSeen("t1");
    expect(getThreadAttentionSnapshot().get("t1")).toMatchObject({
      kind: "approval",
      unseen: false,
    });
    // Seeing it again is a no-op (no re-render).
    markThreadAttentionSeen("t1");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("updates the cause without resetting whether it was seen", () => {
    setThreadAttention({
      threadId: "t1",
      kind: "approval",
      at: 1,
      unseen: true,
    });
    describeThreadAttention("t1", "paused", "budget");
    expect(getThreadAttentionSnapshot().get("t1")).toMatchObject({
      kind: "paused",
      reason: "budget",
      unseen: true,
    });
    describeThreadAttention("t2", "paused", "user");
    expect(getThreadAttentionSnapshot().get("t2")?.unseen).toBe(false);
  });

  it("drops markers of a dismissed pause task", () => {
    setThreadAttention({
      threadId: "t1",
      kind: "paused",
      taskId: "task-1",
      at: 1,
      unseen: true,
    });
    clearThreadAttentionForTask("task-1");
    expect(getThreadAttentionSnapshot().has("t1")).toBe(false);
  });
});

describe("sidebar status with attention markers", () => {
  it("lights unseen failures red and unseen waits amber", () => {
    const byHref = unseenAttentionStatusByHref(
      [
        { threadId: "failed", kind: "failed", unseen: true },
        { threadId: "approval", kind: "approval", unseen: true },
        { threadId: "seen", kind: "paused", unseen: false },
      ],
      new Map([["approval", "/workspace/realtime/approval?x=1"]]),
    );
    expect(Object.fromEntries(byHref)).toEqual({
      [href("failed")]: "error",
      "/workspace/realtime/approval?x=1": "waiting",
    });
  });

  it("keeps the marker after the page's live status is cleared", () => {
    const statuses = buildThreadRunStatusByHref({
      activeTeamTasks: [],
      attentionStatusByHref: new Map([[href("t1"), "waiting"]]),
      liveThreadRunStatusByHref: new Map(),
      threadHrefById: new Map([["t1", href("t1")]]),
    });
    expect(statuses.get(href("t1"))).toBe("waiting");
  });

  it("lets fresher polled or live state win over a stale marker", () => {
    const statuses = buildThreadRunStatusByHref({
      activeTeamTasks: [],
      attentionStatusByHref: new Map([
        [href("resumed"), "error"],
        [href("live"), "waiting"],
      ]),
      backgroundTasks: {
        active: [
          {
            task_id: "task-1",
            thread_id: "resumed",
            agent_id: "general",
            started_at: 1,
            current_iteration: 1,
            max_iterations: 10,
            tokens_spent: 0,
            cost_usd: 0,
            max_tokens: 0,
            max_usd: 0,
          },
        ],
      },
      liveThreadRunStatusByHref: new Map([[href("live"), "running"]]),
      threadHrefById: new Map([
        ["resumed", href("resumed")],
        ["live", href("live")],
      ]),
    });
    expect(statuses.get(href("resumed"))).toBe("running");
    expect(statuses.get(href("live"))).toBe("running");
  });
});
