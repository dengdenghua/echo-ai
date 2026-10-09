import { describe, expect, it } from "vitest";

import { currentActorId } from "./api";

describe("currentActorId with restored authentication", () => {
  it("resolves a cookie-restored actor without a stored token or user", () => {
    expect(currentActorId({
      user_id: "account-42",
      actor_id: "oct:owner@example.com",
      username: "Owner",
    })).toBe("oct:owner@example.com");
  });

  it("falls back to the authenticated user id for legacy accounts", () => {
    expect(currentActorId({ user_id: "owner-42", username: "Owner" }))
      .toBe("owner-42");
  });

  it("does not resolve a different signed-in user to the owner", () => {
    expect(currentActorId({ user_id: "reader-7", username: "Reader" }))
      .not.toBe("owner-42");
    expect(currentActorId(null)).toBe("anonymous");
  });
});
