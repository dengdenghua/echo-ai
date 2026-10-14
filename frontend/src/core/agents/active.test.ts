import { describe, expect, it } from "vitest";

import { activeAgentIdForLocation } from "./active";

describe("activeAgentIdForLocation", () => {
  it("uses the fresh-task query persona before the stored persona", () => {
    // The query id goes through `canonicalAgentId`, so the legacy runtime id
    // `market_researcher` resolves to its persona `noah`. The stored id is
    // returned as-is (see the two cases below), which is why they still read
    // `general`.
    expect(
      activeAgentIdForLocation(
        "/workspace/realtime/new",
        "?agent=market_researcher",
        "general",
      ),
    ).toBe("noah");
  });

  it("keeps a historical thread on the persisted persona until its owner loads", () => {
    expect(
      activeAgentIdForLocation(
        "/workspace/realtime/thread-1",
        "?agent=market_researcher",
        "general",
      ),
    ).toBe("general");
  });

  it("does not promote an on-demand expert to a primary persona", () => {
    expect(
      activeAgentIdForLocation(
        "/workspace/realtime/new",
        "?agent=valuation-analyst",
        "general",
      ),
    ).toBe("general");
  });
});
