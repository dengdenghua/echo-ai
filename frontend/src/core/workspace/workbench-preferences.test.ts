import { beforeEach, describe, expect, it } from "vitest";

import {
  preferredWorkbenchTab,
  rememberedWorkbenchTab,
  rememberWorkbenchTab,
} from "./workbench-preferences";

describe("persona workbench preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses each persona's workbench default", () => {
    // Kane's preset ships `defaultWorkbenchTab: "agent"`, which has been the
    // value since the initial commit — this assertion previously expected
    // "terminal" and was red independently of the persona-alias migration.
    // Tracking the shipped data here; flipping the preset to "terminal" is a
    // product call, not a test fix.
    expect(preferredWorkbenchTab("coder", false)).toBe("agent");
    expect(preferredWorkbenchTab("desktop_operator", false)).toBe("browser");
    expect(preferredWorkbenchTab("market_researcher", false)).toBe("workspace");
    expect(preferredWorkbenchTab("aoi", false)).toBe("workspace");
  });

  it("resolves legacy and canonical ids to the same preference slot", () => {
    rememberWorkbenchTab("coder", "browser");
    expect(rememberedWorkbenchTab("kane")).toBe("browser");
    expect(rememberedWorkbenchTab("coder")).toBe("browser");
  });

  it("always gives a bound project the highest priority", () => {
    rememberWorkbenchTab("general", "browser");
    expect(preferredWorkbenchTab("general", true)).toBe("project");
  });

  it("keeps manual choices isolated by persona", () => {
    rememberWorkbenchTab("coder", "browser");
    rememberWorkbenchTab("aoi", "agent");

    expect(rememberedWorkbenchTab("coder")).toBe("browser");
    expect(rememberedWorkbenchTab("aoi")).toBe("agent");
    expect(rememberedWorkbenchTab("market_researcher")).toBeNull();
  });

  it("ignores transient tabs that should not become persona defaults", () => {
    rememberWorkbenchTab("general", "project");
    rememberWorkbenchTab("general", "artifacts");
    expect(rememberedWorkbenchTab("general")).toBeNull();
  });
});
