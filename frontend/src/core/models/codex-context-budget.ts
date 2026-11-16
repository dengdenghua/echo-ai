export const CODEX_CONTEXT_BUDGET_CHANGED = "echo:codex-context-budget-changed";
const key = (principal: string, model: string) => `echo:codex-context-budget:${principal}:${model.replace(/^chatgpt[/:]/, "")}`;
export function readCodexContextBudget(principal: string, model: string): number | undefined {
  try {
    const value = Number(localStorage.getItem(key(principal, model)));
    return Number.isInteger(value) && value >= 32000 && value <= 1000000 ? value : undefined;
  } catch { return undefined; }
}
export function saveCodexContextBudget(principal: string, model: string, value?: number) {
  if (value !== undefined && (!Number.isInteger(value) || value < 32000 || value > 1000000)) throw new Error("无效的压缩预算");
  if (value === undefined) localStorage.removeItem(key(principal, model));
  else localStorage.setItem(key(principal, model), String(value));
  window.dispatchEvent(new Event(CODEX_CONTEXT_BUDGET_CHANGED));
}
