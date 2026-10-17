// Types, constants and pure helpers for the "new agent" page: template and
// preset shapes, agent-ID suggestion, and the bootstrap prompts sent to the
// agent-generator flow.

import type { ReactNode } from "react";

import { swallow } from "@/core/utils/log";
import { getAgent } from "@/core/agents/api";

export type AgentTemplate = {
  id: string;
  icon: ReactNode;
  name: string;
  nameSuggestion: string;
  description: string;
  prompt: string;
  integrations: string[];
  capabilities: string[];
};

export type AgentRolePreset = {
  id: string;
  label: string;
  nameSuggestion: string;
  brief: string;
};

export type AgentScenePreset = {
  id: string;
  label: string;
  brief: string;
  permissions: string[];
};

export type AgentCapabilityPack = {
  id: string;
  label: string;
  arms: string[];
  skills: string[];
  brief: string;
};

export const NAME_RE = /^[A-Za-z0-9-]+$/;
export const SAVE_HINT_STORAGE_KEY = "echo.agent-create.save-hint-seen";
const AGENT_READ_RETRY_DELAYS_MS = [200, 500, 1_000, 2_000];
export const AGENT_GENERATOR_SKILL_ID = "agent-generator";

export const TEMPLATE_PROMPTS: Record<string, string> = {
  "team-qa":
    "创建一个团队知识问答智能体。它需要读取团队提供的文档、历史讨论和项目资料，在团队消息中用简洁可靠的方式回答问题；遇到不确定内容要说明来源和置信度。",
  "morning-planner":
    "创建一个晨间计划智能体。每天根据我的日历、待办事项、未结束会话和优先级，生成当天可执行计划；需要识别冲突、建议时间块，并在任务变化时更新计划。",
  "defect-triage":
    "创建一个缺陷分诊智能体。它需要阅读新提交的缺陷描述、日志和截图，判断影响范围与优先级，补全复现步骤，并把结论同步到团队缺陷跟踪器。",
  "data-analyst":
    "创建一个数据分析智能体。它需要把模糊的数据需求转成分析计划，检查数据集结构和异常，编写或修复 SQL，选择合适的图表或表格，并在分享前做质量检查。",
  "exec-assistant":
    "创建一个执行助理智能体。它需要帮助我汇总日程、收件箱、会议纪要和项目进展，提炼需要我决策的事项，草拟回复，并持续跟进后续动作。",
  "knowledge-search":
    "创建一个知识搜索智能体。它需要跨本地知识库、网页资料和历史会话检索信息，归纳成可执行答案；对于时效性内容要主动搜索并给出来源。",
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function suggestAgentName(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (words.length === 0) return "custom-agent";
  return words.join("-").slice(0, 36).replace(/-+$/g, "") || "custom-agent";
}

export async function getAgentWithRetry(agentName: string) {
  for (const delay of [0, ...AGENT_READ_RETRY_DELAYS_MS]) {
    if (delay > 0) {
      await wait(delay);
    }

    try {
      return await getAgent(agentName);
    } catch (e) {
      swallow(e);
    }
  }

  return null;
}

export function buildTemplatePrompt(
  template: AgentTemplate,
  roleName?: string | null,
  roleFocus?: string | null,
  roleCapability?: string | null,
) {
  if (!roleName) return template.prompt;
  const context = [
    "",
    `目标岗位：${roleName}`,
    roleCapability ? `复合能力：${roleCapability}` : null,
    roleFocus ? `主要辅助：${roleFocus}` : null,
    "",
  ];
  return [
    template.prompt,
    ...context,
    "请基于这个岗位上下文生成专属 Agent：明确职责边界、默认工具、输出格式、需要沉淀的知识、不能自动承诺的风险事项和首次可执行任务。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildGuidedConfigPrompt({
  role,
  scenes,
  packs,
  template,
}: {
  role: AgentRolePreset;
  scenes: AgentScenePreset[];
  packs: AgentCapabilityPack[];
  template?: AgentTemplate;
}) {
  const arms = uniqueValues(packs.flatMap((pack) => pack.arms));
  const skills = uniqueValues([
    AGENT_GENERATOR_SKILL_ID,
    ...packs.flatMap((pack) => pack.skills),
  ]);
  const permissions = uniqueValues(
    scenes.flatMap((scene) => scene.permissions),
  );
  return [
    `我想创建一个「${role.label}」Agent。`,
    "",
    "一句话目标：",
    role.brief,
    "",
    "主要场景：",
    ...scenes.map((scene) => `- ${scene.label}：${scene.brief}`),
    "",
    "请默认调用 agent-generator，把上面的简短描述扩写成可保存的 Agent 配置。",
    "",
    "配置偏好：",
    `- ARM：${arms.join(", ")}`,
    `- Skill 白名单：${skills.join(", ")}`,
    `- 权限边界：${permissions.join("；")}`,
    ...packs.map((pack) => `- 技能包：${pack.label} - ${pack.brief}`),
    "",
    template ? `启动模板：${template.name}。${template.description}` : null,
    "",
    "请生成 SOUL、工具边界、默认输出格式、首次可执行任务和需要用户确认的高风险动作。",
  ]
    .filter(Boolean)
    .join("\n");
}
