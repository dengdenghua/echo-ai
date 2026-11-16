import { beforeEach, expect, it } from "vitest";
import { readCodexContextBudget, saveCodexContextBudget } from "./codex-context-budget";
beforeEach(() => localStorage.clear());
it("persists across reads while isolating accounts and models", () => {
  saveCodexContextBudget("alice", "chatgpt/gpt-test", 64000);
  expect(readCodexContextBudget("alice", "gpt-test")).toBe(64000);
  expect(readCodexContextBudget("bob", "gpt-test")).toBeUndefined();
  expect(readCodexContextBudget("alice", "other")).toBeUndefined();
  saveCodexContextBudget("alice", "gpt-test");
  expect(readCodexContextBudget("alice", "gpt-test")).toBeUndefined();
});
it("rejects invalid and corrupt budgets", () => {
  for (const value of [0, 31999, 1000001, NaN, 64000.5]) expect(() => saveCodexContextBudget("a", "m", value)).toThrow();
  localStorage.setItem("echo:codex-context-budget:a:m", "broken");
  expect(readCodexContextBudget("a", "m")).toBeUndefined();
});
