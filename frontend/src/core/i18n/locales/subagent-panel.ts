/**
 * Section headings in the sub-agent details sheet
 * (components/workspace/messages/subagent-details-panel.tsx) that have no
 * equivalent in the shared ``t.subagents`` table.
 */

export interface SubagentPanelCopy {
  status: string;
  tokens: string;
  taskDescription: string;
  result: string;
  skills: string;
}

const zhCN: SubagentPanelCopy = {
  status: "状态",
  tokens: "Token 用量",
  taskDescription: "任务描述",
  result: "执行结果",
  skills: "技能",
};

const enUS: SubagentPanelCopy = {
  status: "Status",
  tokens: "Tokens",
  taskDescription: "Task description",
  result: "Result",
  skills: "Skills",
};

const jaJP: SubagentPanelCopy = {
  status: "ステータス",
  tokens: "トークン",
  taskDescription: "タスクの説明",
  result: "結果",
  skills: "スキル",
};

const koKR: SubagentPanelCopy = {
  status: "상태",
  tokens: "토큰",
  taskDescription: "작업 설명",
  result: "결과",
  skills: "스킬",
};

export function subagentPanelCopy(locale: string): SubagentPanelCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
