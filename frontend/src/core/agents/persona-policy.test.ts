import { describe, expect, test } from "vitest";

import {
  DEFAULT_PRIMARY_AGENT_ID,
  isPrimaryPersonaAgentId,
  primaryPersonaAgentIdOrDefault,
  WHITE_GHOST_AGENT_ORDER,
} from "./persona-policy";

describe("primary persona policy", () => {
  test("keeps the operational White Ghost squad as fixed identities", () => {
    expect(WHITE_GHOST_AGENT_ORDER).toEqual([
      "eve",
      "kane",
      "raven",
      "luna",
      "shion",
      "noah",
      "zero",
      "leon",
    ]);
    expect(isPrimaryPersonaAgentId("coder")).toBe(true);
    expect(isPrimaryPersonaAgentId("desktop_operator")).toBe(true);
  });

  test("treats installed experts as on-demand", () => {
    expect(isPrimaryPersonaAgentId("twin_ai_engineer")).toBe(false);
    expect(isPrimaryPersonaAgentId("installed_code_reviewer")).toBe(false);
    expect(isPrimaryPersonaAgentId("echo_kane")).toBe(true);
  });

  test("migrates a stale expert identity to the default squad member", () => {
    expect(primaryPersonaAgentIdOrDefault("aoi")).toBe("zero");
    expect(primaryPersonaAgentIdOrDefault(" coder ")).toBe("kane");
    expect(primaryPersonaAgentIdOrDefault("workbuddy-expert")).toBe(
      DEFAULT_PRIMARY_AGENT_ID,
    );
    expect(primaryPersonaAgentIdOrDefault(null)).toBe(DEFAULT_PRIMARY_AGENT_ID);
  });
});
