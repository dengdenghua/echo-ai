/**
 * Copy for the group member avatar stack under the composer
 * (GroupMemberAvatarStack in chat-input-box.tsx): tooltips, accessible
 * names and the toasts raised when a member is opened or @-mentioned.
 */

export interface MemberAvatarsCopy {
  stackTitle: string;
  /** Joins member names in the overflow tooltip. */
  nameSeparator: string;
  mentionMember: (name: string) => string;
  agentTitle: (name: string) => string;
  agentAria: (name: string) => string;
  overflowTitle: (count: number, names: string) => string;
  overflowAria: (count: number) => string;
  overflowHeading: string;
  overflowMentionAction: string;
  overflowViewProcess: string;
  openingProcess: (name: string) => string;
  mentionInserted: (name: string) => string;
}

const zhCN: MemberAvatarsCopy = {
  stackTitle: "群聊成员 · 点击 AI 查看进程，点击真人或右键 / Shift+Enter 提及",
  nameSeparator: "、",
  mentionMember: (name) => `提及 ${name}`,
  agentTitle: (name) => `${name} · 点击查看并行进程，右键或 Shift+Enter @ 成员`,
  agentAria: (name) => `查看 ${name} 并行进程（Shift+Enter 或右键 @ 提及）`,
  overflowTitle: (count, names) => `更多群成员 (${count}): ${names}`,
  overflowAria: (count) => `更多 ${count} 位群成员`,
  overflowHeading: "更多群成员（点击查看进程，右键或 Shift+Enter @ 提及）",
  overflowMentionAction: "提及成员",
  overflowViewProcess: "查看进程",
  openingProcess: (name) => `正在打开【${name}】的并行进程执行画面`,
  mentionInserted: (name) => `已在输入框 @ ${name}`,
};

const enUS: MemberAvatarsCopy = {
  stackTitle:
    "Group members · click an AI to view its process; click a person, right-click or press Shift+Enter to @mention",
  nameSeparator: ", ",
  mentionMember: (name) => `Mention ${name}`,
  agentTitle: (name) =>
    `${name} · click to view its parallel process; right-click or Shift+Enter to @mention`,
  agentAria: (name) =>
    `View ${name}'s parallel process (Shift+Enter or right-click to @mention)`,
  overflowTitle: (count, names) => `${count} more members: ${names}`,
  overflowAria: (count) => `${count} more group members`,
  overflowHeading:
    "More members (click to view process; right-click or Shift+Enter to @mention)",
  overflowMentionAction: "Mention",
  overflowViewProcess: "View process",
  openingProcess: (name) => `Opening ${name}'s parallel process`,
  mentionInserted: (name) => `Added @${name} to the message`,
};

const jaJP: MemberAvatarsCopy = {
  stackTitle:
    "グループメンバー · AI をクリックでプロセスを表示、人をクリック・右クリック・Shift+Enter でメンション",
  nameSeparator: "、",
  mentionMember: (name) => `${name} をメンション`,
  agentTitle: (name) =>
    `${name} · クリックで並列プロセスを表示、右クリックまたは Shift+Enter で @メンション`,
  agentAria: (name) =>
    `${name} の並列プロセスを表示（Shift+Enter または右クリックで @メンション）`,
  overflowTitle: (count, names) => `ほか ${count} 人のメンバー: ${names}`,
  overflowAria: (count) => `ほか ${count} 人のグループメンバー`,
  overflowHeading:
    "ほかのメンバー（クリックでプロセスを表示、右クリックまたは Shift+Enter で @メンション）",
  overflowMentionAction: "メンション",
  overflowViewProcess: "プロセスを表示",
  openingProcess: (name) => `${name} の並列プロセスを開いています`,
  mentionInserted: (name) => `入力欄に @${name} を追加しました`,
};

const koKR: MemberAvatarsCopy = {
  stackTitle:
    "그룹 멤버 · AI를 클릭하면 프로세스 보기, 사람 클릭·우클릭·Shift+Enter로 멘션",
  nameSeparator: ", ",
  mentionMember: (name) => `${name} 멘션`,
  agentTitle: (name) =>
    `${name} · 클릭하면 병렬 프로세스 보기, 우클릭 또는 Shift+Enter로 @멘션`,
  agentAria: (name) =>
    `${name} 병렬 프로세스 보기 (Shift+Enter 또는 우클릭으로 @멘션)`,
  overflowTitle: (count, names) => `멤버 ${count}명 더 보기: ${names}`,
  overflowAria: (count) => `그룹 멤버 ${count}명 더 보기`,
  overflowHeading:
    "멤버 더 보기 (클릭하면 프로세스 보기, 우클릭 또는 Shift+Enter로 @멘션)",
  overflowMentionAction: "멘션",
  overflowViewProcess: "프로세스 보기",
  openingProcess: (name) => `${name}의 병렬 프로세스를 여는 중`,
  mentionInserted: (name) => `입력란에 @${name}을(를) 추가했습니다`,
};

export function memberAvatarsCopy(locale: string): MemberAvatarsCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
