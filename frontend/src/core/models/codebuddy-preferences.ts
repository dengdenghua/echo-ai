import type { ReasoningEffort } from "@/core/threads";

export const CODEBUDDY_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type CodeBuddyPreferences = { effort?: ReasoningEffort; autocompact?: number };
const key = (principal: string, model: string) => `echo:codebuddy-controls:${principal}:${model}`;
export function readCodeBuddyPreferences(principal: string, model: string): CodeBuddyPreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(key(principal, model)) || "{}");
    return {
      ...(CODEBUDDY_EFFORTS.includes(raw.effort) ? { effort: raw.effort } : {}),
      ...(Number.isInteger(raw.autocompact) && raw.autocompact >= 100000 && raw.autocompact <= 1000000
        ? { autocompact: raw.autocompact } : {}),
    };
  } catch { return {}; }
}
export function writeCodeBuddyPreferences(principal: string, model: string, value: CodeBuddyPreferences) {
  localStorage.setItem(key(principal, model), JSON.stringify(value));
}
export function codeBuddyTurnPreferences(principal: string, model: string, engine: unknown) {
  if (engine !== "codebuddy") return {};
  const preferences = readCodeBuddyPreferences(principal, model);
  return { codebuddy_effort: preferences.effort, codebuddy_autocompact: preferences.autocompact };
}
