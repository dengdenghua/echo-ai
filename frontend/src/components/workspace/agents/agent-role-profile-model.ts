import { calculateAbilityScores } from "@/components/workspace/evolution-dashboard/ability-radar-chart";
import { transformToSkills } from "@/components/workspace/evolution-dashboard/game-data-transformer";
import type { TimelineEvent } from "@/components/workspace/evolution-dashboard/growth-timeline";
import type { AgentWorldAgent } from "@/core/agents/types";
import type {
  EvolutionOverview,
  EvolutionStory,
  EvolutionStoryChange,
  SkillPerformance,
} from "@/core/evolution/api";
import type { Translations } from "@/core/i18n/locales/types";

export type EditableAgentConfig = {
  description: string;
  model: string;
  soul: string;
  arms: string[];
  extraAffinity: string;
  privateSkills: string;
};

export function makeCodeName(agent: AgentWorldAgent): string {
  return agent.name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 3).toUpperCase())
    .join("-");
}

export function makeUid(agent: AgentWorldAgent): string {
  const seed = Array.from(agent.id || agent.name).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  return `${makeCodeName(agent).slice(0, 3) || "AGT"}-${String(seed % 90_000).padStart(5, "0")}`;
}

export function parseList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeList(items: string[] | undefined): string {
  return (items ?? []).join(", ");
}

export function sameList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

export function uniqueList(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export type AgentCharacterProfile = {
  epithet: string;
  quote: string;
  intro: string;
  background: string;
  age: string;
  personality: string;
  temperament: string;
  currentState: string;
  visualKeywords: string[];
  prompt: string;
};

export type VisualPromptGroup = {
  id: string;
  label: string;
  options: { id: string; label: string }[];
};

export type RoleProfileNotes = {
  bestFor: string[];
  boundaries: string[];
};

export const MAX_VISUAL_REFERENCE_IMAGES = 3;

const VISUAL_PROMPT_OPTION_PROMPTS: Record<string, string> = {
  "game-character":
    "premium game HUD character illustration, polished live2D-adjacent key art, readable silhouette",
  "clean-anime":
    "clean anime-inspired linework, elegant facial rendering, refined hair shapes, controlled highlights",
  "semi-real":
    "semi-realistic character concept art, natural proportions, cinematic but not photorealistic, not painterly",
  "full-body":
    "full body visible, standing turnaround pose, entire character contained inside canvas, figure reads large in frame",
  "safe-headroom":
    "full head visible with extra top margin, do not crop hair or head, preserve footroom too",
  "avatar-ready":
    "face clear and centered enough for a Zero-style large-face avatar crop from the front view",
  "three-view-consistency":
    "front side and back views must keep the same face, hairstyle, outfit, colors, proportions, and facial appeal",
  transparent:
    "transparent background, isolated character, no scenery, no colored backdrop, no infographic layout",
  "soft-shadow":
    "subtle grounding shadow only when necessary, no environment, suitable for UI overlay",
  "high-resolution":
    "high resolution, crisp edges, detailed outfit materials, sharp eyes, clean hands, no blur",
  "no-artifacts":
    "avoid extra fingers, distorted hands, asymmetrical eyes, duplicate limbs, detached accessories, messy text, watermark",
};

export const DEFAULT_VISUAL_PROMPT_OPTION_IDS = [
  "game-character",
  "full-body",
  "safe-headroom",
  "avatar-ready",
  "three-view-consistency",
  "transparent",
  "high-resolution",
  "no-artifacts",
];

export function buildVisualPrompt(
  basePrompt: string,
  selectedIds: string[],
  customPrompt: string,
): string {
  const optionPrompts = selectedIds
    .map((id) => VISUAL_PROMPT_OPTION_PROMPTS[id])
    .filter(Boolean);
  return [
    basePrompt,
    "Use agent-visual-kit metaskill workflow.",
    "Generate three high-definition character turnaround views plus a separate square avatar for this Agent.",
    "Visual target: premium Echo Hub agent art, calm readable pose, attractive face, role-first costume language.",
    "Composition rule: body should read large in the Hub, while the avatar should behave like Zero with the face filling most of the icon.",
    ...optionPrompts,
    customPrompt.trim() ? `user additions: ${customPrompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function parseReferenceImageInput(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read image"));
      }
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

export function buildRoleProfileNotes(
  agent: AgentWorldAgent,
  t: Translations,
): RoleProfileNotes {
  const key = `${agent.name} ${agent.display_name}`.toLowerCase();
  if (key.includes("coder") || agent.name === "kane") {
    return {
      bestFor: t.agentRoleProfile.coderBestFor,
      boundaries: t.agentRoleProfile.coderBoundaries,
    };
  }
  if (
    agent.name === "noah" ||
    key.includes("market_researcher") ||
    key.includes("research")
  ) {
    return {
      bestFor: t.agentRoleProfile.researcherBestFor,
      boundaries: t.agentRoleProfile.researcherBoundaries,
    };
  }
  if (agent.name === "luna" || key.includes("vibe") || key.includes("growth")) {
    return {
      bestFor: t.agentRoleProfile.growthBestFor,
      boundaries: t.agentRoleProfile.growthBoundaries,
    };
  }
  if (
    agent.name === "shion" ||
    key.includes("ecommerce") ||
    key.includes("commerce")
  ) {
    return {
      bestFor: t.agentRoleProfile.ecommerceBestFor,
      boundaries: t.agentRoleProfile.ecommerceBoundaries,
    };
  }
  if (key.includes("aoi") || agent.name === "zero") {
    return {
      bestFor: t.agentRoleProfile.aoiBestFor,
      boundaries: t.agentRoleProfile.aoiBoundaries,
    };
  }
  return {
    bestFor: t.agentRoleProfile.defaultBestFor,
    boundaries: t.agentRoleProfile.defaultBoundaries,
  };
}

function pickCategoryValue<T>(
  values: Record<string, T>,
  category: AgentWorldAgent["category"],
  fallback: T,
): T {
  return values[category] ?? fallback;
}

export function buildCharacterProfile(
  agent: AgentWorldAgent,
  t: Translations,
): AgentCharacterProfile {
  const custom = agent.character_profile;
  if (custom) {
    const visualKeywords =
      custom.visual_keywords && custom.visual_keywords.length > 0
        ? custom.visual_keywords
        : (t.agentConfig.characterVisualKeywords.assistant ?? []);
    const detailLines = [
      custom.background ? `background: ${custom.background}` : "",
      custom.personality ? `personality: ${custom.personality}` : "",
      custom.temperament ? `temperament: ${custom.temperament}` : "",
      custom.likes?.length ? `likes: ${custom.likes.join("; ")}` : "",
      custom.dislikes?.length ? `dislikes: ${custom.dislikes.join("; ")}` : "",
      custom.quirks?.length ? `quirks: ${custom.quirks.join("; ")}` : "",
      custom.tone?.length ? `tone: ${custom.tone.join("; ")}` : "",
      custom.appearance?.length
        ? `appearance: ${custom.appearance.join("; ")}`
        : "",
      custom.interaction?.length
        ? `interaction: ${custom.interaction.join("; ")}`
        : "",
      custom.current_state?.length
        ? `current state: ${custom.current_state.join("; ")}`
        : "",
      custom.emotion_list?.length
        ? `available emotions: ${custom.emotion_list.join(", ")}`
        : "",
    ].filter(Boolean);

    return {
      epithet:
        custom.epithet ??
        t.agentConfig.characterEpithets[agent.category] ??
        agent.display_name,
      quote:
        custom.quote ?? t.agentConfig.characterQuotes[agent.category] ?? "",
      intro:
        custom.intro ??
        custom.background ??
        descriptionOrFallback(
          agent.description,
          t.agentConfig.characterDefaultOrigin,
        ),
      background:
        custom.background ??
        descriptionOrFallback(
          agent.description,
          t.agentConfig.characterDefaultOrigin,
        ),
      age:
        custom.apparent_age ??
        t.agentConfig.characterAgeArchetypes[agent.category] ??
        t.agentConfig.characterAgeArchetypes.assistant ??
        "",
      personality:
        custom.personality ??
        t.agentConfig.characterPersonalities[agent.category] ??
        t.agentConfig.characterPersonalities.assistant ??
        "",
      temperament:
        custom.temperament ??
        t.agentConfig.characterTemperaments[agent.category] ??
        t.agentConfig.characterTemperaments.assistant ??
        "",
      currentState: custom.current_state?.[0] ?? "",
      visualKeywords,
      prompt: [
        `character name: ${agent.display_name}`,
        custom.gender ? `gender: ${custom.gender}` : "",
        `character epithet: ${custom.epithet ?? agent.display_name}`,
        custom.quote ? `signature line: ${custom.quote}` : "",
        custom.intro ? `readable character intro: ${custom.intro}` : "",
        ...detailLines,
        `visual keywords: ${visualKeywords.join(", ")}`,
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  const role = t.agentConfig.categoryRoles[agent.category] ?? agent.category;
  const type = t.agentConfig.categoryTypes[agent.category] ?? agent.category;
  const faction = agent.is_official
    ? t.agentConfig.officialFaction
    : t.agentConfig.authorFaction(agent.author);
  const fallbackAge = t.agentConfig.characterAgeArchetypes.assistant ?? "";
  const fallbackPersonality =
    t.agentConfig.characterPersonalities.assistant ?? "";
  const fallbackTemperament =
    t.agentConfig.characterTemperaments.assistant ?? "";
  const fallbackVisualKeywords =
    t.agentConfig.characterVisualKeywords.assistant ?? [];
  const fallbackEpithet = t.agentConfig.characterEpithets.assistant ?? role;
  const fallbackQuote = t.agentConfig.characterQuotes.assistant ?? "";
  const age = pickCategoryValue(
    t.agentConfig.characterAgeArchetypes,
    agent.category,
    fallbackAge,
  );
  const personality = pickCategoryValue(
    t.agentConfig.characterPersonalities,
    agent.category,
    fallbackPersonality,
  );
  const temperament = pickCategoryValue(
    t.agentConfig.characterTemperaments,
    agent.category,
    fallbackTemperament,
  );
  const visualKeywords = pickCategoryValue(
    t.agentConfig.characterVisualKeywords,
    agent.category,
    fallbackVisualKeywords,
  );
  const epithet = pickCategoryValue(
    t.agentConfig.characterEpithets,
    agent.category,
    fallbackEpithet,
  );
  const quote = pickCategoryValue(
    t.agentConfig.characterQuotes,
    agent.category,
    fallbackQuote,
  );
  const background = t.agentConfig.characterBackground(
    agent.display_name,
    role,
    type,
    faction,
    agent.description,
  );
  const intro = t.agentConfig.characterIntro(
    agent.display_name,
    role,
    type,
    faction,
    descriptionOrFallback(
      agent.description,
      t.agentConfig.characterDefaultOrigin,
    ),
    personality,
    temperament,
  );
  const prompt = [
    `character epithet: ${epithet}`,
    `signature line: ${quote}`,
    `readable character intro: ${intro}`,
    `character background: ${background}`,
    `apparent age: ${age}`,
    `personality: ${personality}`,
    `temperament: ${temperament}`,
    `visual keywords: ${visualKeywords.join(", ")}`,
  ].join("; ");

  return {
    epithet,
    quote,
    intro,
    background,
    age,
    personality,
    temperament,
    currentState: "",
    visualKeywords,
    prompt,
  };
}

function descriptionOrFallback(description: string, fallback: string): string {
  const trimmed = description.trim();
  if (!trimmed) return fallback;
  const fallbackUsesCjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(
    fallback,
  );
  const descriptionCjkCount = (
    trimmed.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? []
  ).length;
  const descriptionLatinCount = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  if (fallbackUsesCjk && descriptionLatinCount > descriptionCjkCount * 3) {
    return fallback;
  }
  return trimmed;
}

/** View model for the growth, radar and skill-tree tabs of the profile. */
export function buildEvolutionTabData(
  evolutionData: EvolutionOverview | null,
  skillPerformances: SkillPerformance[] | null,
  evolutionStory: EvolutionStory | null,
) {
  if (!evolutionData || !skillPerformances) return null;

  const skills = transformToSkills(skillPerformances);
  const abilityScores = calculateAbilityScores(
    evolutionData,
    skillPerformances,
    "general",
  );

  // Generate timeline events from evolution story
  const timelineEvents: TimelineEvent[] = [];

  if (evolutionStory?.changes) {
    evolutionStory.changes
      .slice(0, 10)
      .forEach((change: EvolutionStoryChange, idx: number) => {
        timelineEvents.push({
          id: `event-${idx}`,
          type:
            change.kind === "skill"
              ? "skill"
              : change.kind === "rule"
                ? "rule"
                : "achievement",
          timestamp: new Date(Date.now() - idx * 86400000).toISOString(),
          title: change.title || "未知事件",
          description: change.content || change.kind,
        });
      });
  }

  return {
    skills,
    abilityScores,
    timelineEvents,
  };
}
