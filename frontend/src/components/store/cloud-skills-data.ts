/**
 * Names, labels and the local-inventory fallback for the HUB Skills tab
 * (``CloudSkillsPanel``).
 */
import {
  fetchUnifiedAssets,
  type CloudSkillItem,
  type UnifiedAsset,
} from "@/core/agents/agent-world-api";
import { listSkills } from "@/core/skills/api";
import type { SkillInfo } from "@/core/skills/types";

import { skillCategories } from "./skill-categories";

export const SKILL_NAMES: Record<string, string> = {
  "academic-paper-expert": "学术论文助手",
  "ad-copywriter": "广告文案",
  "ad-creative": "广告创意",
  "agent-generator": "智能体生成器",
  "skill-creator": "技能创建器",
  "plugin-creator": "插件创建器",
  "agent-visual-kit": "智能体视觉设计",
  "agnes-image-generate": "AI 图像生成",
  "agnes-video-generate": "AI 视频生成",
  "agnes-video-poll": "视频生成进度查询",
  "api-and-interface-design": "API 与接口设计",
  "api-doc-gen": "API 文档生成",
  "api-shape-explorer": "API 方案探索",
  "auto-hypothesis-test": "统计假设检验",
  "auto-stat-test": "自动统计检验",
  "backend-building": "后端开发",
};

export function normalizeSkillName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
}

export function localSkillAliases(asset: UnifiedAsset) {
  return [asset.id, asset.name, asset.name_zh]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeSkillName);
}

/** Runtime skill registry rows (what the composer lists) as local assets. */
function runtimeSkillAsAsset(skill: SkillInfo): UnifiedAsset {
  return {
    id: skill.name,
    kind: "skill",
    source: "local",
    name: skill.name,
    description: skill.description,
    category: skill.category,
  };
}

/**
 * Local skills when the installed-status answer did not carry them. The
 * unified asset index answers 404 until someone runs POST /api/assets/sync,
 * so a miss there is expected and falls through to the runtime skill
 * registry, the list the composer's skills menu reads.
 */
export async function loadFallbackLocalSkills(): Promise<UnifiedAsset[]> {
  try {
    const unified = await fetchUnifiedAssets({
      kind: "skill",
      limit: 500,
      offset: 0,
    });
    if (unified.items.length > 0) return unified.items;
  } catch {
    // Index not built yet; use the runtime registry below.
  }
  try {
    return (await listSkills())
      .filter((skill) => !/^(android|ios)\./.test(skill.name))
      .map(runtimeSkillAsAsset);
  } catch {
    return [];
  }
}

export interface SkillEntry {
  key: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  source?: string;
  cloud: CloudSkillItem | null;
  local: UnifiedAsset | null;
}

export function entryCategories(entry: SkillEntry): string[] {
  const name = entry.cloud?.original_name || entry.name;
  return ["skill-creator", "plugin-creator", "agent-generator"].includes(name)
    ? ["开发工具"]
    : skillCategories(entry.cloud?.tags);
}

export function sourceLabel(source?: string) {
  const labels: Record<string, string> = {
    builtin: "系统内置",
    local: "本地技能",
    imported: "本地导入",
    echo: "echo",
    "echo-repository": "echo",
    openai: "OpenAI 官方",
    anthropic: "Anthropic 官方",
    vercel: "Vercel 官方",
    "minimax-design": "MiniMax Design",
    "skills.sh": "Skills.sh 社区",
  };
  return source?.trim() ? labels[source] || source : "未提供";
}

export function authorLabel(author?: string, source?: string) {
  if (
    ["echo", "echo-repository", "echo"].includes(source ?? "") ||
    /^(echo-ai|echo|echo)$/i.test(author?.trim() ?? "")
  )
    return "echo";
  return author?.trim() || "未提供";
}
