import { describe, expect, it } from "vitest";

import { engineContextUsage } from "./engine-token-usage";

describe("engineContextUsage", () => {
  it("reads Codex's latest request and window", () => {
    expect(
      engineContextUsage({
        total: { totalTokens: 90_000, inputTokens: 80_000 },
        last: { totalTokens: 31_200, inputTokens: 30_000, outputTokens: 1_200 },
        modelContextWindow: 272_000,
      }),
    ).toEqual({ contextTokens: 31_200, contextWindow: 272_000 });
  });

  it("adds input and output when no total is given, without a window", () => {
    expect(
      engineContextUsage({
        last_token_usage: { input_tokens: 10_000, output_tokens: 500 },
      }),
    ).toEqual({ contextTokens: 10_500, contextWindow: null });
  });

  it("ignores Echo's throughput reports and empty usage", () => {
    expect(
      engineContextUsage({ chars: 400, elapsedMs: 900, charsPerSec: 444 }),
    ).toBeNull();
    expect(engineContextUsage({ last: { totalTokens: 0 } })).toBeNull();
    expect(engineContextUsage(null)).toBeNull();
  });
});
