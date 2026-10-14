import { canonicalAgentId } from "@/core/agents/aliases";
/**
 * Persona-driven workspace presets.
 *
 * A persona owns the default shape of the product surface: which modules are
 * visible, which workbench should open, and eventually which apps/skills are
 * suggested. User overrides are applied after this preset and never mutate it.
 */

export type WorkspacePreset = {
  id: string;
  direction: string;
  themeId: PersonaThemeId;
  defaultHiddenModuleIds: readonly string[];
  defaultVisibleModuleIds?: readonly string[];
  defaultWorkbenchTab: PersonaWorkbenchTab;
  workbenchLabel: string;
  workbenchSummary: string;
  workbenchLanes: readonly string[];
  primaryAction?: {
    label: string;
    to: string;
  };
  workbench:
    | "general"
    | "office"
    | "development"
    | "automation"
    | "growth"
    | "commerce"
    | "trading"
    | "media";
};

export type PersonaThemeId =
  | "eve"
  | "kane"
  | "raven"
  | "luna"
  | "shion"
  | "noah"
  | "zero";

export type PersonaWorkbenchTab =
  | "agent"
  | "terminal"
  | "browser"
  | "workspace";

const BASE_PRESET: WorkspacePreset = {
  id: "general",
  direction: "通用协作",
  themeId: "eve",
  defaultHiddenModuleIds: [],
  defaultWorkbenchTab: "agent",
  workbenchLabel: "协作工作台",
  workbenchSummary: "围绕当前对话组织任务、材料与交付。",
  workbenchLanes: ["任务", "资料", "交付"],
  workbench: "general",
};

export const PERSONA_WORKSPACE_PRESETS: Readonly<
  Record<string, WorkspacePreset>
> = {
  eve: {
    ...BASE_PRESET,
    id: "office-coordination",
    direction: "办公与项目协调",
    workbenchLabel: "工作台首页",
    workbenchSummary: "查看协作能力与全部项目；当前项目的进度、里程碑和成员请在「项目」面板中管理。",
    workbenchLanes: ["任务协调", "资料整理", "交付跟进"],
    primaryAction: { label: "查看全部项目", to: "/workspace/projects" },
    workbench: "office",
  },
  kane: {
    ...BASE_PRESET,
    id: "software-development",
    direction: "软件研发",
    themeId: "kane",
    defaultWorkbenchTab: "agent",
    workbenchLabel: "开发",
    workbenchSummary: "聚合代码执行、变更审阅和可运行预览。",
    workbenchLanes: ["终端", "变更", "预览"],
    workbench: "development",
  },
  raven: {
    ...BASE_PRESET,
    id: "browser-desktop-automation",
    direction: "浏览器与桌面自动化",
    themeId: "raven",
    defaultWorkbenchTab: "browser",
    workbenchLabel: "自动化工作台",
    workbenchSummary: "查看浏览器现场、操控过程和执行结果。",
    workbenchLanes: ["浏览器", "操作", "回执"],
    workbench: "automation",
  },
  luna: {
    ...BASE_PRESET,
    id: "growth-creative",
    direction: "增长与品牌内容",
    themeId: "luna",
    defaultWorkbenchTab: "workspace",
    workbenchLabel: "增长工作台",
    workbenchSummary: "从洞察、内容到投放复盘组织增长任务。",
    workbenchLanes: ["洞察", "内容", "复盘"],
    primaryAction: {
      label: "创建增长任务",
      to: "/workspace/realtime/new?agent=luna",
    },
    workbench: "growth",
  },
  shion: {
    ...BASE_PRESET,
    id: "ecommerce-operations",
    direction: "电商与供应链",
    themeId: "shion",
    defaultWorkbenchTab: "workspace",
    workbenchLabel: "电商运营台",
    workbenchSummary: "围绕商品、渠道和履约组织电商经营工作。",
    workbenchLanes: ["商品", "渠道", "履约"],
    primaryAction: {
      label: "创建经营分析任务",
      to: "/workspace/realtime/new?agent=shion",
    },
    workbench: "commerce",
  },
  noah: {
    ...BASE_PRESET,
    id: "market-trading",
    direction: "交易与市场研究",
    themeId: "noah",
    defaultHiddenModuleIds: [],
    defaultWorkbenchTab: "workspace",
    workbenchLabel: "交易研究台",
    workbenchSummary: "围绕市场研究、标的跟踪和研究报告组织任务。",
    workbenchLanes: ["研究", "跟踪", "报告"],
    primaryAction: {
      label: "开始市场研究",
      to: "/workspace/realtime/new?agent=noah",
    },
    workbench: "trading",
  },
  zero: {
    ...BASE_PRESET,
    id: "media-production",
    direction: "AI 影视与创意制作",
    themeId: "zero",
    defaultWorkbenchTab: "workspace",
    workbenchLabel: "AI 影视工作台",
    workbenchSummary: "按素材、制作和交付组织 AI 影视生产流程。",
    workbenchLanes: ["素材", "制作", "交付"],
    primaryAction: {
      label: "打开视频素材库",
      to: "/workspace/storage?surface=company&library=videos",
    },
    workbench: "media",
  },
};

export function workspacePresetForAgent(
  agentId: string | null | undefined,
): WorkspacePreset {
  return PERSONA_WORKSPACE_PRESETS[canonicalAgentId(agentId?.trim() ?? "")] ?? BASE_PRESET;
}

export function defaultModuleIdsForAgent(
  allModuleIds: readonly string[],
  agentId: string | null | undefined,
): string[] {
  const preset = workspacePresetForAgent(agentId);
  const hidden = new Set(preset.defaultHiddenModuleIds);
  const visible = new Set(preset.defaultVisibleModuleIds ?? []);
  return allModuleIds.filter((id) => !hidden.has(id) || visible.has(id));
}
