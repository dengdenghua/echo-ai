import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  consumeTaskCollaboratorPreset,
  taskCollaboratorRouteForLeader,
  TASK_COLLABORATOR_PRESET_EVENT,
  writeTaskCollaboratorPreset,
} from "./task-collaborator-preset";

describe("task collaborator presets", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  test("stores a normalized one-shot collaborator preset", () => {
    const listener = vi.fn();
    window.addEventListener(TASK_COLLABORATOR_PRESET_EVENT, listener);

    writeTaskCollaboratorPreset({
      leaderId: " coder ",
      collaboratorIds: [" general ", "general", "", "codex-cli"],
      mode: "swarm",
      label: "  Build group  ",
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeTaskCollaboratorPreset()).toEqual({
      // The leader is normalized to a canonical squad persona (`coder` → `kane`).
      // Collaborators are not: they may be any installed agent, so `normalizeIds`
      // only trims and de-duplicates.
      leaderId: "kane",
      collaboratorIds: ["general", "codex-cli"],
      mode: "swarm",
      label: "Build group",
      openPicker: false,
    });
    expect(consumeTaskCollaboratorPreset()).toBeNull();

    window.removeEventListener(TASK_COLLABORATOR_PRESET_EVENT, listener);
  });

  test("routes preset leaders into the unified task surface", () => {
    expect(taskCollaboratorRouteForLeader()).toBe("/workspace/realtime/new");
    expect(taskCollaboratorRouteForLeader("general")).toBe(
      "/workspace/realtime/new",
    );
    expect(taskCollaboratorRouteForLeader("installed expert")).toBe(
      "/workspace/realtime/new",
    );
  });

  test("normalizes a non-squad leader back to the fixed default identity", () => {
    writeTaskCollaboratorPreset({
      leaderId: "installed_researcher",
      collaboratorIds: ["research-advisor"],
    });

    expect(consumeTaskCollaboratorPreset()).toEqual({
      // A non-squad leader falls back to `DEFAULT_PRIMARY_AGENT_ID`, which is
      // the canonical `eve` rather than the legacy `general`.
      leaderId: "eve",
      collaboratorIds: ["research-advisor"],
      mode: "cluster",
      label: undefined,
      openPicker: false,
    });
  });
});
