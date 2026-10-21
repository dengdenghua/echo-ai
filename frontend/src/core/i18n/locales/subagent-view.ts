/**
 * Copy for one member's process view in the workbench
 * (agent-workbench-panel/subagent-process-view.tsx): the header actions, the
 * running hint and the private follow-up bar.
 */

export interface SubagentViewCopy {
  backToOverview: string;
  shareToGroup: string;
  shareToGroupHint: string;
  shareUnavailable: string;
  sharedToComposer: string;
  /** The draft placed in the group composer when a reply is shared. */
  sharedReply: (name: string, reply: string) => string;
  processing: string;
  task: string;
  execution: string;
  result: string;
  elapsed: string;
  privateChatHint: string;
  privateChat: string;
  privateChatLabel: (name: string) => string;
  privateChatPlaceholder: (name: string) => string;
  privateChatTitle: (name: string) => string;
}

const zhCN: SubagentViewCopy = {
  backToOverview: "返回总览",
  shareToGroup: "分享到群聊",
  shareToGroupHint: "放入群聊输入框，确认后发送",
  shareUnavailable: "有回复后可以分享",
  sharedToComposer: "已放入群聊输入框，确认后发送",
  sharedReply: (name, reply) => `${name} 的回复：\n\n${reply}`,
  processing: "正在处理，稍后会在这里显示进展…",
  task: "任务说明",
  execution: "执行过程",
  result: "任务结果",
  elapsed: "已用时间",
  privateChatHint: "在新的私聊中继续交流",
  privateChat: "另开私聊",
  privateChatLabel: (name) => `与 ${name} 私聊`,
  privateChatPlaceholder: (name) => `给 ${name} 的私聊草稿…`,
  privateChatTitle: (name) => `打开与 ${name} 的单独对话`,
};

const enUS: SubagentViewCopy = {
  backToOverview: "Back to overview",
  shareToGroup: "Share to group",
  shareToGroupHint: "Add to the group message box; you confirm before sending",
  shareUnavailable: "You can share once there is a reply",
  sharedToComposer: "Added to the group message box. Review it, then send.",
  sharedReply: (name, reply) => `${name}'s reply:\n\n${reply}`,
  processing: "Working on it. Progress will appear here…",
  task: "Task brief",
  execution: "Activity",
  result: "Result",
  elapsed: "Elapsed time",
  privateChatHint: "Continue in a new private conversation",
  privateChat: "New private chat",
  privateChatLabel: (name) => `Private chat with ${name}`,
  privateChatPlaceholder: (name) => `Draft a private message to ${name}…`,
  privateChatTitle: (name) => `Open a separate conversation with ${name}`,
};

const jaJP: SubagentViewCopy = {
  backToOverview: "概要に戻る",
  shareToGroup: "グループに共有",
  shareToGroupHint: "グループの入力欄に追加し、確認してから送信します",
  shareUnavailable: "返信があると共有できます",
  sharedToComposer:
    "グループの入力欄に追加しました。確認してから送信してください",
  sharedReply: (name, reply) => `${name} の返信：\n\n${reply}`,
  processing: "処理中です。進捗はここに表示されます…",
  task: "タスクの説明",
  execution: "実行状況",
  result: "結果",
  elapsed: "経過時間",
  privateChatHint: "新しい個別チャットで会話を続けます",
  privateChat: "新規個別チャット",
  privateChatLabel: (name) => `${name} と個別チャット`,
  privateChatPlaceholder: (name) => `${name} に何を聞きますか？`,
  privateChatTitle: (name) => `${name} との個別の会話を開く`,
};

const koKR: SubagentViewCopy = {
  backToOverview: "개요로 돌아가기",
  shareToGroup: "그룹에 공유",
  shareToGroupHint: "그룹 입력란에 넣고 확인한 뒤 보냅니다",
  shareUnavailable: "답변이 있으면 공유할 수 있습니다",
  sharedToComposer: "그룹 입력란에 넣었습니다. 확인한 뒤 보내세요",
  sharedReply: (name, reply) => `${name}의 답변:\n\n${reply}`,
  processing: "처리 중입니다. 진행 상황이 여기에 표시됩니다…",
  task: "작업 설명",
  execution: "실행 과정",
  result: "작업 결과",
  elapsed: "경과 시간",
  privateChatHint: "새 개인 대화에서 계속합니다",
  privateChat: "새 개인 채팅",
  privateChatLabel: (name) => `${name}와(과) 개인 채팅`,
  privateChatPlaceholder: (name) => `${name}에게 무엇을 물어볼까요?`,
  privateChatTitle: (name) => `${name}와(과) 별도 대화 열기`,
};

export function subagentViewCopy(locale: string): SubagentViewCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
