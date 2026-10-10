import { describe, expect, it } from "vitest";

import {
  arrayOf,
  isArrayOf,
  isObjectLike,
  isOneOf,
  isRecord,
  isStringArray,
  isUnknownArray,
  objectLike,
  stringAt,
} from "./guards";

describe("guards", () => {
  it("treats only non-null, non-array objects as records", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("lets arrays through as object-like, unlike records", () => {
    expect(isObjectLike([])).toBe(true);
    expect(isObjectLike({})).toBe(true);
    expect(isObjectLike(null)).toBe(false);
    expect(isObjectLike("x")).toBe(false);
    expect(objectLike({ a: 1 })).toEqual({ a: 1 });
    expect(objectLike(7)).toBeUndefined();
  });

  it("reads string entries by dynamic key", () => {
    const table = { title: "Title", count: 2 };
    expect(stringAt(table, "title")).toBe("Title");
    expect(stringAt(table, "count")).toBeUndefined();
    expect(stringAt(table, "missing")).toBeUndefined();
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
