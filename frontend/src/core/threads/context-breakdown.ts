/**
 * Shared vocabulary for the composer ring's context segments.
 *
 * The keys are the ring's own naming, not the wire format: the endpoint sends
 * ``mcp_tools`` / ``system_prompt`` and this module is the single place that
 * translates. Keeping that translation here means the payload shape is pinned
 * in one testable function instead of at each call site.
 */

export type ContextBreakdownKey =
  | "messages"
  | "mcpTools"
  | "systemTools"
  | "skills"
  | "systemPrompt"
  | "memory";

export interface ContextBreakdownSegment {
  key: ContextBreakdownKey;
  tokens: number;
}

export const CONTEXT_BREAKDOWN_ORDER: ContextBreakdownKey[] = [
  "messages",
  "mcpTools",
  "systemTools",
  "skills",
  "systemPrompt",
  "memory",
];

/** Ring colours, in the order the segments are listed. */
export const CONTEXT_SEGMENT_COLORS: Record<ContextBreakdownKey, string> = {
  messages: "bg-primary/70",
  mcpTools: "bg-chart-4",
  systemTools: "bg-chart-3",
  skills: "bg-chart-2",
  systemPrompt: "bg-chart-1",
  memory: "bg-chart-5",
};

const SERVER_KEY_MAP: Record<string, ContextBreakdownKey> = {
  messages: "messages",
  mcp_tools: "mcpTools",
  system_tools: "systemTools",
  skills: "skills",
  system_prompt: "systemPrompt",
  memory: "memory",
};

/**
 * Translate the endpoint's segments into ring segments.
 *
 * Returns ``null`` — not an empty list — when nothing recognisable came back,
 * because every caller would rather show its own estimate than an empty ring.
 * Unknown keys are dropped rather than shown under a wrong label.
 */
export function normalizeContextBreakdown(
  payload: unknown,
): ContextBreakdownSegment[] | null {
  if (!Array.isArray(payload)) return null;
  const totals = new Map<ContextBreakdownKey, number>();
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const record = item as { key?: unknown; tokens?: unknown };
    const key =
      typeof record.key === "string" ? SERVER_KEY_MAP[record.key] : undefined;
    if (!key) continue;
    const raw =
      typeof record.tokens === "number" && Number.isFinite(record.tokens)
        ? record.tokens
        : 0;
    totals.set(key, (totals.get(key) ?? 0) + Math.max(0, Math.round(raw)));
  }
  const segments = CONTEXT_BREAKDOWN_ORDER.filter(
    (key) => (totals.get(key) ?? 0) > 0,
  ).map((key) => ({ key, tokens: totals.get(key) ?? 0 }));
  return segments.length > 0 ? segments : null;
}
