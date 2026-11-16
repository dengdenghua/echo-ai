import { describe, expect, it } from "vitest";

import { workbenchSnapshotKey } from "./workbench-snapshot-cache";

describe("workbench snapshot account scope", () => {
  it("keeps identical thread/turn ids disjoint across accounts", () => {
    expect(
      workbenchSnapshotKey("local:owner", "thread-1", "turn-1"),
    ).not.toBe(workbenchSnapshotKey("local:reader", "thread-1", "turn-1"));
  });

  it("is no longer the legacy unscoped key", () => {
    expect(workbenchSnapshotKey("local:owner", "thread-1", "turn-1")).not.toBe(
      "thread-1:turn-1",
    );
    expect(
      workbenchSnapshotKey("local:owner", "thread-1", "turn-1"),
    ).toContain("local:owner");
  });
});
