import { describe, expect, it } from "vitest";

import {
  CONTEXT_BREAKDOWN_ORDER,
  CONTEXT_SEGMENT_COLORS,
  normalizeContextBreakdown,
} from "./context-breakdown";

describe("normalizeContextBreakdown", () => {
  it("translates the endpoint's snake_case keys into ring keys", () => {
    const segments = normalizeContextBreakdown([
      { key: "system_prompt", tokens: 120 },
      { key: "mcp_tools", tokens: 40 },
      { key: "messages", tokens: 900 },
    ]);

    // Ring order, not payload order: the list is read top-down and the
    // conversation is the row a reader looks for first.
    expect(segments).toEqual([
      { key: "messages", tokens: 900 },
      { key: "mcpTools", tokens: 40 },
      { key: "systemPrompt", tokens: 120 },
    ]);
  });

  it("returns null rather than an empty list when nothing is recognisable", () => {
    // Every caller prefers its own estimate to an empty ring, so the
    // "nothing to show" answer has to be distinguishable from "showed zero".
    expect(normalizeContextBreakdown([])).toBeNull();
    expect(
      normalizeContextBreakdown([{ key: "unknown", tokens: 10 }]),
    ).toBeNull();
    expect(normalizeContextBreakdown(null)).toBeNull();
    expect(normalizeContextBreakdown("nope")).toBeNull();
  });

  it("drops zero and negative buckets instead of listing empty rows", () => {
    const segments = normalizeContextBreakdown([
      { key: "messages", tokens: 0 },
      { key: "memory", tokens: -5 },
      { key: "skills", tokens: 12 },
    ]);

    expect(segments).toEqual([{ key: "skills", tokens: 12 }]);
  });

  it("survives junk entries inside the list", () => {
    expect(
      normalizeContextBreakdown([null, "nope", { key: "messages" }, 7]),
    ).toBeNull();
  });

  it("sums a bucket that the payload repeats", () => {
    const segments = normalizeContextBreakdown([
      { key: "messages", tokens: 100 },
      { key: "messages", tokens: 25 },
    ]);

    expect(segments).toEqual([{ key: "messages", tokens: 125 }]);
  });

  it("gives every ring key a colour", () => {
    for (const key of CONTEXT_BREAKDOWN_ORDER) {
      expect(CONTEXT_SEGMENT_COLORS[key]).toBeTruthy();
    }
  });
});
