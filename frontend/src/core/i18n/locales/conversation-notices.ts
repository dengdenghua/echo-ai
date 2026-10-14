/**
 * Copy for small status notices inside the message list: the model-switch
 * divider (model-switch-timeline-entry.tsx), the loading skeleton
 * (skeleton.tsx) and the connection repair actions shown under a failed
 * task (task-connection-recovery.tsx).
 */

export interface ConversationNoticesCopy {
  modelSwitched: (model: string) => string;
  loadingConversation: string;
  repairConnections: string;
  continuing: string;
  continueTask: string;
}

const zhCN: ConversationNoticesCopy = {
  modelSwitched: (model) => `模型已切换为 ${model}`,
  loadingConversation: "正在加载对话",
  repairConnections: "修复所需连接",
  continuing: "正在继续…",
  continueTask: "继续当前任务",
};

const enUS: ConversationNoticesCopy = {
  modelSwitched: (model) => `Model switched to ${model}`,
  loadingConversation: "Loading conversation",
  repairConnections: "Repair required connections",
  continuing: "Continuing…",
  continueTask: "Continue this task",
};

const jaJP: ConversationNoticesCopy = {
  modelSwitched: (model) => `モデルを ${model} に切り替えました`,
  loadingConversation: "会話を読み込み中",
  repairConnections: "必要な接続を修復",
  continuing: "続行中…",
  continueTask: "このタスクを続行",
};

const koKR: ConversationNoticesCopy = {
  modelSwitched: (model) => `모델 전환됨: ${model}`,
  loadingConversation: "대화 불러오는 중",
  repairConnections: "필요한 연결 복구",
  continuing: "계속하는 중…",
  continueTask: "이 작업 계속하기",
};

export function conversationNoticesCopy(
  locale: string,
): ConversationNoticesCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
