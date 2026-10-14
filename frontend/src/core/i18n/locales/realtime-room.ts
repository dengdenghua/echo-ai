/**
 * Copy for the realtime conversation room: the notices and reply strip above
 * the composer (realtime-composer-area.tsx) and the toasts raised by the
 * room's hooks (submit, mode switch, roster sync, human invites).
 */

export interface RealtimeRoomCopy {
  /** Joins member display names inside one sentence. */
  nameSeparator: string;
  /** Fallback display name for the current person in the room. */
  selfName: string;
  dismissJoinNotice: string;
  membersJoined: (names: string) => string;
  teamReady: (names: string) => string;
  teamReadyHint: string;
  /** Prefix of the reply strip; the quoted message text follows directly. */
  replyingTo: (name: string) => string;
  replyFallbackName: string;
  cancelReply: string;
  autoNewSession: (hours: number) => string;
  modeSwitchFailed: string;
  membersSaveFailed: string;
  inviteNeedsFirstMessage: string;
  inviteRoomFailed: string;
  inviteLinkFailed: string;
}

const zhCN: RealtimeRoomCopy = {
  nameSeparator: "、",
  selfName: "我",
  dismissJoinNotice: "关闭入群提示",
  membersJoined: (names) => `${names} 已加入群聊。欢迎！你想和团队一起做什么？`,
  teamReady: (names) => `团队已就绪 · ${names}`,
  teamReadyHint: "发送第一条消息后保存群聊。你想和团队一起做什么？",
  replyingTo: (name) => `回复 ${name}：`,
  replyFallbackName: "协作成员",
  cancelReply: "取消回复",
  autoNewSession: (hours) =>
    `已为你开启新会话（距上次对话已超过 ${hours} 小时）`,
  modeSwitchFailed: "切换模式失败，已还原",
  membersSaveFailed: "AI 成员保存失败，请重试",
  inviteNeedsFirstMessage: "请先发送一条消息，再邀请真人加入群聊",
  inviteRoomFailed: "群聊房间创建失败，请重试",
  inviteLinkFailed: "无法创建邀请链接",
};

const enUS: RealtimeRoomCopy = {
  nameSeparator: ", ",
  selfName: "Me",
  dismissJoinNotice: "Dismiss join notice",
  membersJoined: (names) =>
    `${names} joined the group chat. Welcome! What would you like to do with the team?`,
  teamReady: (names) => `Team ready · ${names}`,
  teamReadyHint:
    "The group chat is saved when you send the first message. What would you like to do with the team?",
  replyingTo: (name) => `Replying to ${name}: `,
  replyFallbackName: "Member",
  cancelReply: "Cancel reply",
  autoNewSession: (hours) =>
    `Started a new session (more than ${hours} ${hours === 1 ? "hour" : "hours"} since your last conversation)`,
  modeSwitchFailed: "Couldn't switch modes. Reverted.",
  membersSaveFailed: "Couldn't save AI members. Please try again.",
  inviteNeedsFirstMessage:
    "Send a message first, then invite people to the group chat.",
  inviteRoomFailed: "Couldn't create the group chat room. Please try again.",
  inviteLinkFailed: "Couldn't create an invite link",
};

const jaJP: RealtimeRoomCopy = {
  nameSeparator: "、",
  selfName: "自分",
  dismissJoinNotice: "参加のお知らせを閉じる",
  membersJoined: (names) =>
    `${names} がグループチャットに参加しました。ようこそ！チームで何をしましょうか？`,
  teamReady: (names) => `チームの準備完了 · ${names}`,
  teamReadyHint:
    "最初のメッセージを送信するとグループチャットが保存されます。チームで何をしましょうか？",
  replyingTo: (name) => `${name} への返信：`,
  replyFallbackName: "メンバー",
  cancelReply: "返信をキャンセル",
  autoNewSession: (hours) =>
    `前回の会話から ${hours} 時間以上経過したため、新しいセッションを開始しました`,
  modeSwitchFailed: "モードを切り替えられなかったため、元に戻しました",
  membersSaveFailed:
    "AI メンバーを保存できませんでした。もう一度お試しください",
  inviteNeedsFirstMessage:
    "メッセージを送信してから、グループチャットに人を招待してください",
  inviteRoomFailed:
    "グループチャットのルームを作成できませんでした。もう一度お試しください",
  inviteLinkFailed: "招待リンクを作成できません",
};

const koKR: RealtimeRoomCopy = {
  nameSeparator: ", ",
  selfName: "나",
  dismissJoinNotice: "참여 알림 닫기",
  membersJoined: (names) =>
    `${names}님이 그룹 채팅에 참여했습니다. 환영합니다! 팀과 무엇을 함께할까요?`,
  teamReady: (names) => `팀 준비 완료 · ${names}`,
  teamReadyHint:
    "첫 메시지를 보내면 그룹 채팅이 저장됩니다. 팀과 무엇을 함께할까요?",
  replyingTo: (name) => `${name}에게 답장: `,
  replyFallbackName: "구성원",
  cancelReply: "답장 취소",
  autoNewSession: (hours) =>
    `마지막 대화 후 ${hours}시간이 넘게 지나 새 세션을 시작했습니다`,
  modeSwitchFailed: "모드를 전환하지 못해 이전 상태로 되돌렸습니다",
  membersSaveFailed: "AI 멤버를 저장하지 못했습니다. 다시 시도해 주세요",
  inviteNeedsFirstMessage:
    "먼저 메시지를 보낸 뒤 그룹 채팅에 사람을 초대하세요",
  inviteRoomFailed: "그룹 채팅방을 만들지 못했습니다. 다시 시도해 주세요",
  inviteLinkFailed: "초대 링크를 만들 수 없습니다",
};

export function realtimeRoomCopy(locale: string): RealtimeRoomCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
