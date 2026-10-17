import type { UserMemory } from "@/core/memory/types";

export const MAX_MEMORY_IMPORT_BYTES = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMemoryTimestamp(
  value: unknown,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    ((allowEmpty && value.length === 0) || Number.isFinite(Date.parse(value)))
  );
}

function isMemorySection(value: unknown): value is {
  summary: string;
  updatedAt: string;
} {
  return (
    isRecord(value) &&
    typeof value.summary === "string" &&
    isMemoryTimestamp(value.updatedAt, true)
  );
}

function isMemoryFact(value: unknown): value is UserMemory["facts"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.content === "string" &&
    value.content.trim().length > 0 &&
    typeof value.category === "string" &&
    value.category.trim().length > 0 &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    isMemoryTimestamp(value.createdAt) &&
    typeof value.source === "string" &&
    value.source.trim().length > 0
  );
}

export function isImportedMemory(value: unknown): value is UserMemory {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.version !== "string" ||
    value.version.trim().length === 0 ||
    !isMemoryTimestamp(value.lastUpdated, true) ||
    !isRecord(value.user) ||
    !isRecord(value.history) ||
    !Array.isArray(value.facts)
  ) {
    return false;
  }

  if (!value.facts.every(isMemoryFact)) {
    return false;
  }
  const factIds = new Set(value.facts.map((fact) => fact.id));
  if (factIds.size !== value.facts.length) {
    return false;
  }

  return (
    isMemorySection(value.user.workContext) &&
    isMemorySection(value.user.personalContext) &&
    isMemorySection(value.user.topOfMind) &&
    isMemorySection(value.history.recentMonths) &&
    isMemorySection(value.history.earlierContext) &&
    isMemorySection(value.history.longTermBackground)
  );
}
