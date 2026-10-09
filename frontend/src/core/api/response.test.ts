import { describe, expect, it } from "vitest";

import { isRecord, isString } from "@/core/utils/guards";

import { looseBody } from "./response";

const isNamed = (value: unknown): value is { name: string } =>
  isRecord(value) && isString(value.name);

describe("looseBody", () => {
  it("returns a body that passes its guard", () => {
    const body = { name: "echo" };
    expect(looseBody(body, isNamed)).toBe(body);
  });

  it("passes a body that misses its guard through unchanged", () => {
    const body = { title: "no name" };
    expect(looseBody(body, isNamed)).toBe(body);
    expect(looseBody(null, isNamed)).toBeNull();
  });
});
