import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAutomationTarget, saveAutomationTarget } from "./target";

describe("automation target persistence", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("keeps a structured target per conversation", () => {
    saveAutomationTarget("thread-a", {
      kind: "browser_tab",
      source: "browser_relay",
      id: "91",
      title: "Release dashboard",
      url: "https://example.test/releases",
    });

    expect(loadAutomationTarget("thread-a")).toEqual(
      expect.objectContaining({ id: "91", title: "Release dashboard" }),
    );
    expect(loadAutomationTarget("thread-b")).toBeNull();
  });

  it("drops malformed or explicitly cleared values", () => {
    window.localStorage.setItem("echo:automation-target:thread-a", "{}");
    expect(loadAutomationTarget("thread-a")).toBeNull();

    saveAutomationTarget("thread-a", {
      kind: "desktop_window",
      source: "computer",
      id: "window-1",
      title: "Notes",
    });
    saveAutomationTarget("thread-a", null);
    expect(loadAutomationTarget("thread-a")).toBeNull();
  });

  it("isolates targets when local and remote computers have the same thread id", () => {
    const target = {
      kind: "desktop_window",
      source: "computer",
      id: "local-window",
      title: "Local notes",
    } as const;
    saveAutomationTarget("thread-a", target);
    window.history.replaceState({}, "", "/?echoRemote=host-a");
    expect(loadAutomationTarget("thread-a")).toBeNull();
    saveAutomationTarget("thread-a", {
      ...target,
      id: "remote-window",
      title: "Remote notes",
    });
    window.history.replaceState({}, "", "/?echoRemote=host-b");
    expect(loadAutomationTarget("thread-a")).toBeNull();
    window.history.replaceState({}, "", "/");
    expect(loadAutomationTarget("thread-a")?.id).toBe("local-window");
    window.history.replaceState({}, "", "/?echoRemote=host-a");
    expect(loadAutomationTarget("thread-a")?.id).toBe("remote-window");
  });
});
