import { describe, expect, test } from "vitest";

import { createEchoBrowserSessionIdentity } from "./api";

describe("browser session identity", () => {
  test("binds browser sessions to an Echo workspace path", () => {
    const first = createEchoBrowserSessionIdentity({
      threadId: "thread-1",
      workspacePath: "F:\\work\\echo-ai",
    });
    const second = createEchoBrowserSessionIdentity({
      threadId: "thread-2",
      workspacePath: "F:\\work\\echo-ai",
    });

    expect(first).toEqual(second);
    expect(first.scope).toBe("workspace");
    expect(first.displayName).toBe("echo-ai");
    expect(first.projectId).toBe("echo-workspace:F:\\work\\echo-ai");
    expect(first.sessionId).toMatch(/^echo-workspace-echo-ai-/);
    expect(first.profileId).toBe(first.sessionId);
  });

  test("keeps same-name workspace folders isolated", () => {
    const alpha = createEchoBrowserSessionIdentity({
      workspacePath: "F:\\alpha\\echo-ai",
    });
    const beta = createEchoBrowserSessionIdentity({
      workspacePath: "F:\\beta\\echo-ai",
    });

    expect(alpha.displayName).toBe(beta.displayName);
    expect(alpha.sessionId).not.toBe(beta.sessionId);
    expect(alpha.profileId).not.toBe(beta.profileId);
  });

  test("falls back to thread scope when no workspace is active", () => {
    const identity = createEchoBrowserSessionIdentity({
      threadId: "thread-123456789",
    });

    expect(identity.scope).toBe("thread");
    expect(identity.displayName).toBe("thread/thread-1");
    expect(identity.projectId).toBe("echo-thread:thread-123456789");
    expect(identity.sessionId).toMatch(/^echo-thread-thread-thread-1-/);
  });
});
