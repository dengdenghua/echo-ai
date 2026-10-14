import { describe, expect, test } from "vitest";

import {
  ACTIVE_ARTIFACT_REFRESH_MS,
  MAX_ARTIFACT_REFRESH_MS,
  backedOffArtifactInterval,
  getWorkspaceArtifactRefetchInterval,
} from "./polling";

describe("getWorkspaceArtifactRefetchInterval", () => {
  test("is silent while the conversation is idle", () => {
    expect(getWorkspaceArtifactRefetchInterval(false)).toBe(false);
  });

  test("refreshes artifacts while a turn is running", () => {
    expect(getWorkspaceArtifactRefetchInterval(true)).toBe(
      ACTIVE_ARTIFACT_REFRESH_MS,
    );
    expect(getWorkspaceArtifactRefetchInterval(true, "working")).toBe(
      ACTIVE_ARTIFACT_REFRESH_MS,
    );
  });

  test("waits for the agent's first event before polling", () => {
    expect(getWorkspaceArtifactRefetchInterval(true, "waiting")).toBe(false);
  });
});

describe("backedOffArtifactInterval", () => {
  test("doubles per unchanged listing and stops at the cap", () => {
    const base = ACTIVE_ARTIFACT_REFRESH_MS;
    expect(backedOffArtifactInterval(base, 0)).toBe(base);
    expect(backedOffArtifactInterval(base, 1)).toBe(base * 2);
    expect(backedOffArtifactInterval(base, 2)).toBe(base * 4);
    expect(backedOffArtifactInterval(base, 10)).toBe(MAX_ARTIFACT_REFRESH_MS);
  });
});
