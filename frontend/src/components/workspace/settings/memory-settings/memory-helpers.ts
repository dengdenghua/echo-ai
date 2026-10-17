import type { useI18n } from "@/core/i18n/hooks";
import type { UserMemory } from "@/core/memory/types";
import { formatTimeAgo } from "@/core/utils/datetime";

export type MemoryFact = UserMemory["facts"][number];

export type MemorySection = {
  title: string;
  summary: string;
  updatedAt?: string;
};

export type MemorySectionGroup = {
  title: string;
  sections: MemorySection[];
};

export type PendingImport = {
  fileName: string;
  memory: UserMemory;
};

export type FactFormState = {
  content: string;
  category: string;
  confidence: string;
};

export const DEFAULT_FACT_FORM_STATE: FactFormState = {
  content: "",
  category: "context",
  confidence: "0.8",
};

export function confidenceToLevelKey(confidence: unknown): {
  key: "veryHigh" | "high" | "normal" | "unknown";
  value?: number;
} {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return { key: "unknown" };
  }

  const value = Math.min(1, Math.max(0, confidence));
  if (value >= 0.85) return { key: "veryHigh", value };
  if (value >= 0.65) return { key: "high", value };
  return { key: "normal", value };
}

function formatMemorySection(
  section: MemorySection,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const content =
    safeSummary(section) ||
    `<span class="text-muted-foreground">${t.settings.memory.markdown.empty}</span>`;
  return [
    `### ${section.title}`,
    content,
    "",
    section.updatedAt &&
      `> ${t.settings.memory.markdown.updatedAt}: \`${formatTimeAgo(section.updatedAt)}\``,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildMemorySectionGroups(
  memory: UserMemory,
  t: ReturnType<typeof useI18n>["t"],
): MemorySectionGroup[] {
  // Implementation note.
  // Implementation note.
  const user: Partial<UserMemory["user"]> = memory.user ?? {};
  const history: Partial<UserMemory["history"]> = memory.history ?? {};
  const read = (
    s: { summary?: string; updatedAt?: string } | undefined | null,
  ): { summary: string; updatedAt: string } => ({
    summary: s?.summary ?? "",
    updatedAt: s?.updatedAt ?? "",
  });
  return [
    {
      title: t.settings.memory.markdown.userContext,
      sections: [
        {
          title: t.settings.memory.markdown.work,
          ...read(user.workContext),
        },
        {
          title: t.settings.memory.markdown.personal,
          ...read(user.personalContext),
        },
        {
          title: t.settings.memory.markdown.topOfMind,
          ...read(user.topOfMind),
        },
      ],
    },
    {
      title: t.settings.memory.markdown.historyBackground,
      sections: [
        {
          title: t.settings.memory.markdown.recentMonths,
          ...read(history.recentMonths),
        },
        {
          title: t.settings.memory.markdown.earlierContext,
          ...read(history.earlierContext),
        },
        {
          title: t.settings.memory.markdown.longTermBackground,
          ...read(history.longTermBackground),
        },
      ],
    },
  ];
}

export function summariesToMarkdown(
  memory: UserMemory,
  sectionGroups: MemorySectionGroup[],
  t: ReturnType<typeof useI18n>["t"],
) {
  const parts: string[] = [];

  parts.push(`## ${t.settings.memory.markdown.overview}`);
  parts.push(
    `- **${t.common.lastUpdated}**: \`${formatTimeAgo(memory.lastUpdated)}\``,
  );

  for (const group of sectionGroups) {
    parts.push(`\n## ${group.title}`);
    for (const section of group.sections) {
      parts.push(formatMemorySection(section, t));
    }
  }

  const markdown = parts.join("\n\n");
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;
  for (const line of lines) {
    i++;
    if (i !== 1 && line.startsWith("## ")) {
      if (out.length === 0 || out[out.length - 1] !== "---") {
        out.push("---");
      }
    }
    out.push(line);
  }

  return out.join("\n");
}

// Implementation note.
// Implementation note.
// Implementation note.
// Implementation note.
function safeSummary(section: { summary?: string } | undefined | null): string {
  return (section?.summary ?? "").trim();
}

export function isMemorySummaryEmpty(memory: UserMemory) {
  const user: Partial<UserMemory["user"]> = memory.user ?? {};
  const history: Partial<UserMemory["history"]> = memory.history ?? {};
  return (
    safeSummary(user.workContext) === "" &&
    safeSummary(user.personalContext) === "" &&
    safeSummary(user.topOfMind) === "" &&
    safeSummary(history.recentMonths) === "" &&
    safeSummary(history.earlierContext) === "" &&
    safeSummary(history.longTermBackground) === ""
  );
}

export function truncateFactPreview(content: string, maxLength = 140) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const ellipsis = "...";
  if (maxLength <= ellipsis.length) {
    return normalized.slice(0, maxLength);
  }
  return `${normalized.slice(0, maxLength - ellipsis.length)}${ellipsis}`;
}

export function upperFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function factScopeLabel(
  fact: MemoryFact,
  t: {
    settings: {
      memory: { projectScope: string; agentScope: string; globalScope: string };
    };
  },
) {
  if (fact.scope === "project" && fact.project)
    return `${t.settings.memory.projectScope}${fact.project}`;
  if (fact.scope === "agent" && fact.agent_id)
    return `${t.settings.memory.agentScope}${fact.agent_id}`;
  return t.settings.memory.globalScope;
}

export function isThreadSource(source: string) {
  return source !== "manual" && !source.includes(":") && source.length > 8;
}
