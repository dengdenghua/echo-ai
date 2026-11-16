import { afterEach, describe, expect, it } from "vitest";

import { currentActorId, currentActorScope } from "./api";

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

describe("currentActorScope", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("prefers the provider-qualified actor id", () => {
    expect(currentActorScope({
      actor_id: "local:owner",
      user_id: "owner",
      provider: "local",
    })).toBe("local:owner");
  });

  it("qualifies a bare user id with its provider", () => {
    expect(currentActorScope({ user_id: "reader-7", provider: "oct" })).toBe(
      "oct:reader-7",
    );
  });

  it("uses one stable anonymous bucket when no identity exists", () => {
    expect(currentActorScope()).toBe("anonymous");
  });
});
