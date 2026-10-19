import type { ReasoningEffort } from "./types";

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

export function parseReasoningEffort(
  value: unknown,
): ReasoningEffort | undefined {
  return isReasoningEffort(value) ? value : undefined;
}
