import { beforeEach, expect, it } from "vitest";
import { codeBuddyTurnPreferences, readCodeBuddyPreferences, writeCodeBuddyPreferences } from "./codebuddy-preferences";
beforeEach(() => localStorage.clear());
it("sends the saved controls only to the matching account, model and engine", () => {
  writeCodeBuddyPreferences("alice", "codebuddy/hy4std", { effort: "high", autocompact: 300000 });
  expect(codeBuddyTurnPreferences("alice", "codebuddy/hy4std", "codebuddy")).toEqual({codebuddy_effort:"high",codebuddy_autocompact:300000});
  expect(codeBuddyTurnPreferences("alice", "codebuddy/hy4std", "codex")).toEqual({});
  expect(readCodeBuddyPreferences("bob", "codebuddy/hy4std")).toEqual({});
  expect(readCodeBuddyPreferences("alice", "codebuddy/hy3")).toEqual({});
});
it("rejects corrupted and out-of-range stored values", () => {
  localStorage.setItem("echo:codebuddy-controls:alice:m", '{"effort":"off","autocompact":30000000}');
  expect(readCodeBuddyPreferences("alice", "m")).toEqual({});
  localStorage.setItem("echo:codebuddy-controls:alice:m", 'null');
  expect(readCodeBuddyPreferences("alice", "m")).toEqual({});
});
