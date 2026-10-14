import { describe, expect, it } from "vitest";

import { formatProcessReplayLabel } from "./process-replay-label";

describe("formatProcessReplayLabel", () => {
  it("shows elapsed time and calls replay events records", () => {
    expect(
      formatProcessReplayLabel({
        title: "过程回放",
        itemCount: "46 条",
        durationMs: 125_000,
      }),
    ).toBe("过程回放 · 2m5s · 46 条");
  });

  it("keeps legacy history accurate when duration is unavailable", () => {
    expect(
      formatProcessReplayLabel({
        title: "过程回放",
        itemCount: "46 条",
        durationMs: null,
      }),
    ).toBe("过程回放 · 46 条");
  });
});
