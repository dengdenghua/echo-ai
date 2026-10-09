import { beforeEach, describe, expect, it } from "vitest";

import {
  LOCAL_WORK_LOCATION,
  readWorkLocation,
  workLocationContext,
  writeWorkLocation,
  type WorkLocation,
} from "./work-location";

const NODE: WorkLocation = {
  kind: "node",
  node_id: "nas",
  workspace_id: "ws-1",
  role: "coder",
  label: "书房 NAS",
  workspace_name: "Project",
};

describe("work location", () => {
  beforeEach(() => window.localStorage.clear());

  it("remembers a node choice per conversation and defaults to this computer", () => {
    writeWorkLocation("thread-a", NODE);

    expect(readWorkLocation("thread-a")).toEqual(NODE);
    expect(readWorkLocation("thread-b")).toEqual(LOCAL_WORK_LOCATION);
    expect(readWorkLocation(null)).toEqual(LOCAL_WORK_LOCATION);
  });

  it("does not store this computer, so switching back clears the entry", () => {
    writeWorkLocation("thread-a", NODE);
    writeWorkLocation("thread-a", LOCAL_WORK_LOCATION);

    expect(window.localStorage.getItem("echo.work-location.v1")).toBe("{}");
  });

  it("falls back to this computer for malformed storage", () => {
    window.localStorage.setItem(
      "echo.work-location.v1",
      JSON.stringify({ "thread-a": { kind: "node", node_id: "nas" } }),
    );

    expect(readWorkLocation("thread-a")).toEqual(LOCAL_WORK_LOCATION);
  });

  it("sends only the routing fields to the server", () => {
    expect(workLocationContext(LOCAL_WORK_LOCATION)).toBeUndefined();
    expect(workLocationContext(NODE)).toEqual({
      kind: "node",
      node_id: "nas",
      workspace_id: "ws-1",
      role: "coder",
    });
  });
});
