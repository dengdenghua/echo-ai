import { describe, expect, it } from "vitest";

import { workspaceUtilityDestination } from "./utility-destinations";

describe("merged utility destinations", () => {
  it.each([
    [
      "/workspace/computer",
      "/workspace/storage",
      { library: "computer", view: "control" },
    ],
    [
      "/workspace/desktop-organizer",
      "/workspace/storage",
      { library: "computer", view: "organizer" },
    ],
    [
      "/workspace/channels",
      "/workspace/settings",
      { section: "tools", toolsTab: "channels" },
    ],
    [
      "/workspace/reflex",
      "/workspace/evolution",
      { section: "governance", detail: "reflex" },
    ],
    ["/workspace/diagnostics", "/workspace/observability", { tab: "system" }],
  ])(
    "keeps the feature selected when opening the old %s address",
    (source, path, selection) => {
      const result = workspaceUtilityDestination(
        source,
        "?echo_remote=qa-host&embedded=1&view=unknown",
      );
      const destination = new URL(result!, "https://echo.invalid");
      expect(destination.pathname).toBe(path);
      expect(destination.searchParams.get("echo_remote")).toBe("qa-host");
      expect(destination.searchParams.get("embedded")).toBe("1");
      for (const [key, value] of Object.entries(selection)) {
        expect(destination.searchParams.get(key)).toBe(value);
      }
    },
  );

  it("leaves independent actions and normal pages alone", () => {
    expect(workspaceUtilityDestination("/workspace/reflex/edit")).toBeNull();
    expect(workspaceUtilityDestination("/workspace/projects")).toBeNull();
  });
});
