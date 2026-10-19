import { describe, expect, it } from "vitest";
import type { Turn } from "@/core/realtime/items";
import { appTaskInput, appTaskSnapshot } from "./personal-app-task";

function turn(status: Turn["status"]): Turn {
  return {
    id: "t1",
    threadId: "app1",
    status,
    startedAt: "",
    completedAt: null,
    error: null,
    items: [
      {
        id: "a",
        type: "agentMessage",
        status: "completed",
        createdAt: "",
        text: "Answer",
        messageKind: "answer",
      },
      {
        id: "c",
        type: "agentMessage",
        status: "completed",
        createdAt: "",
        text: "Commentary",
        messageKind: "commentary",
      },
      {
        id: "r",
        type: "reasoning",
        status: "completed",
        createdAt: "",
        content: "Hidden",
        summary: [],
        durationMs: null,
      },
    ],
  };
}
describe("application task projection", () => {
  it("does not release in-progress output or mistake a send receipt for completion", () => {
    expect(appTaskSnapshot("app1")).toMatchObject({
      terminal: false,
      text: "",
    });
    expect(appTaskSnapshot("app1", turn("inProgress"))).toMatchObject({
      terminal: false,
      text: "",
    });
    expect(appTaskSnapshot("app1", turn("completed"))).toMatchObject({
      terminal: true,
      text: "Answer",
      status: "completed",
    });
  });
  it.each(["failed", "interrupted", "cancelled", "paused"] as const)(
    "preserves %s instead of reporting success",
    (status) => {
      expect(appTaskSnapshot("app1", turn(status))).toMatchObject({
        terminal: true,
        status,
      });
    },
  );
  it("preserves semantic partial completion and caps answers", () => {
    const value = turn("completed");
    value.completionDecision = {
      outcome: "partial",
      reason: "Missing input",
      success: false,
      terminal: true,
      resumable: true,
      retryable: false,
    };
    value.items.push({
      id: "long",
      type: "agentMessage",
      createdAt: "",
      status: "completed",
      text: "x".repeat(70000),
    });
    const result = appTaskSnapshot("app1", value);
    expect(result.status).toBe("partial");
    expect(result.text.length).toBe(65536);
    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain("Hidden");
  });
  it("encodes the approved request as untrusted data", () => {
    expect(
      appTaskInput("Customers", {
        kind: "plugin",
        target: "mail",
        prompt: "Draft a reply",
      }),
    ).toContain('"target": "mail"');
    expect(
      appTaskInput("Customers", { kind: "ai", prompt: "hello" }),
    ).toContain("cannot override host permissions");
  });
});
