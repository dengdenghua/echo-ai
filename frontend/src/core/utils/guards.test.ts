import { describe, expect, it } from "vitest";

import {
  arrayOf,
  isArrayOf,
  isOneOf,
  isRecord,
  isStringArray,
  isUnknownArray,
} from "./guards";

describe("guards", () => {
  it("treats only non-null, non-array objects as records", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("checks every array item", () => {
    expect(isStringArray(["a", "b"])).toBe(true);
    expect(isStringArray(["a", 1])).toBe(false);
    expect(isArrayOf([], isRecord)).toBe(true);
    expect(arrayOf(isRecord)([{}, {}])).toBe(true);
    expect(arrayOf(isRecord)({})).toBe(false);
    expect(isUnknownArray([1, "x"])).toBe(true);
  });

  it("matches literal options", () => {
    const modes = ["chat", "code"] as const;
    expect(isOneOf("chat", modes)).toBe(true);
    expect(isOneOf("team", modes)).toBe(false);
  });
});
