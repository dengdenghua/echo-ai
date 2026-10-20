import { describe, expect, it } from "vitest";
import {
  parseCodeBuddyModels,
  parseCodeBuddyStatus,
} from "./codebuddy-status";

describe("parseCodeBuddyStatus", () => {
  it("parses a ready status with observations", () => {
    const parsed = parseCodeBuddyStatus({
      available: true,
      reason_code: null,
      reason: null,
      authentication: "cli_managed",
      capability_checks: {
        chat: {
          state: "verified",
          model: "codebuddy/auto",
          checked_at: 1234.5,
        },
        web_search: { state: "untested" },
        tools: { state: "bogus" },
      },
    });
    expect(parsed.available).toBe(true);
    expect(parsed.reason).toBeNull();
    expect(parsed.capability_checks?.chat).toEqual({
      state: "verified",
      model: "codebuddy/auto",
      checked_at: 1234.5,
    });
    expect(parsed.capability_checks?.web_search).toEqual({
      state: "untested",
    });
    // Invalid states are dropped rather than trusted.
    expect(parsed.capability_checks?.tools).toBeUndefined();
  });

  it("parses the not-installed failure shape", () => {
    const parsed = parseCodeBuddyStatus({
      available: false,
      reason_code: "not_installed",
      reason: "请先安装 CodeBuddy CLI",
    });
    expect(parsed.available).toBe(false);
    expect(parsed.reason).toBe("请先安装 CodeBuddy CLI");
    expect(parsed.capability_checks).toBeUndefined();
  });

  it("treats non-boolean available as false", () => {
    expect(parseCodeBuddyStatus({ available: "yes" }).available).toBe(false);
    expect(parseCodeBuddyStatus(null).available).toBe(false);
    expect(parseCodeBuddyStatus(undefined).reason).toBe("invalid response");
  });

  it("keeps reason as null when the field is missing", () => {
    expect(parseCodeBuddyStatus({ available: true }).reason).toBeNull();
  });
});

describe("parseCodeBuddyModels", () => {
  it("keeps string model ids only", () => {
    const parsed = parseCodeBuddyModels({
      models: ["auto", 42, "codebuddy/big", null],
    });
    expect(parsed.models).toEqual(["auto", "codebuddy/big"]);
  });

  it("returns an empty list for malformed payloads", () => {
    expect(parseCodeBuddyModels(null).models).toEqual([]);
    expect(parseCodeBuddyModels({ models: "auto" }).models).toEqual([]);
    expect(parseCodeBuddyModels({}).models).toEqual([]);
  });
});
