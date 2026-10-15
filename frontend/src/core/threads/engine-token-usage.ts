/**
 * The engine's own context report. Codex sends ``thread/tokenUsage/updated``
 * with ``{ total, last, modelContextWindow }``; ``last`` is the most recent
 * request, i.e. how full the context window is now. Echo's native loop sends
 * throughput figures on the same channel instead, which carry no tokens.
 */

export interface EngineContextUsage {
  /** Tokens the latest request occupied in the context window. */
  contextTokens: number;
  /** The engine's window, when it reports one. */
  contextWindow: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function count(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return 0;
}

export function engineContextUsage(
  tokenUsage: Record<string, unknown> | null | undefined,
): EngineContextUsage | null {
  const usage = record(tokenUsage);
  const last = record(usage?.last ?? usage?.last_token_usage);
  if (!usage || !last) return null;
  const total = count(last, "totalTokens", "total_tokens");
  const contextTokens =
    total ||
    count(last, "inputTokens", "input_tokens") +
      count(last, "outputTokens", "output_tokens");
  if (contextTokens <= 0) return null;
  const window = count(usage, "modelContextWindow", "model_context_window");
  return { contextTokens, contextWindow: window > 0 ? window : null };
}
