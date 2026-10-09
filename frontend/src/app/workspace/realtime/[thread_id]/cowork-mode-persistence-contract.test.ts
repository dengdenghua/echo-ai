import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const realtimeDir = join(process.cwd(), "src/app/workspace/realtime/[thread_id]");

// The roster/response-mode sync moved out of page.tsx: the writer lives in
// use-cowork-roster-sync.ts and the saved roster projection in
// use-collaborator-selection.ts.
const rosterSyncSource = ["use-cowork-roster-sync.ts", "use-collaborator-selection.ts"]
  .map((file) => readFileSync(join(realtimeDir, file), "utf8"))
  .join("\n")
  .replace(/\r\n/g, "\n");

describe("realtime cowork response-mode persistence contract", () => {
  test("syncs the user's current mode intent instead of the stale saved mode", () => {
    expect(rosterSyncSource).toContain(
      "pendingRosterModeRef.current ??\n        normalizeTeamResponseMode(teamModeIntent)",
    );
    expect(rosterSyncSource).not.toContain(
      "pendingRosterModeRef.current ??\n        normalizeTeamResponseMode(savedCollaborationMode)",
    );
  });

  test("a failed save can retry the same signature and visibly rolls back", () => {
    expect(rosterSyncSource).toContain("lastCoworkSyncSignatureRef.current = null;");
    expect(rosterSyncSource).toContain('toast.error("AI 成员保存失败，请重试")');
  });

  test("uses the mutation's group-state cache as the authoritative mode source", () => {
    expect(rosterSyncSource).toContain(
      "coworkGroupQuery.data?.state.mode ?? collabSessionQuery.data?.mode",
    );
    expect(rosterSyncSource).toContain(
      "coworkGroupQuery.data?.state ?? sessionState ?? null",
    );
  });

  test("only an explicit interaction in this tab may persist mode or roster", () => {
    expect(rosterSyncSource).toContain(
      "collaboratorSelectionTouchedRef.current ||\n      responseModeIntentTouchedRef.current ||\n      pendingRosterModeRef.current !== null",
    );
    expect(rosterSyncSource).toContain("if (!hasLocalWriteIntent) return;");
    expect(rosterSyncSource).not.toContain("matchesSavedRoster");
  });
});
