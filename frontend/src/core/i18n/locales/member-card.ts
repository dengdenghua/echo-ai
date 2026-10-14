/**
 * Copy for the speaker frame on agent messages: the member card behind the
 * avatar and the name row in team rooms (message-list-renderers.tsx).
 */

export interface MemberCardCopy {
  teamLead: string;
  member: string;
  presence: string;
  summaryFallback: string;
  model: string;
  strengths: string;
  viewProfile: (name: string) => string;
  replyTo: (name: string) => string;
}

const zhCN: MemberCardCopy = {
  teamLead: "队长",
  member: "协作成员",
  presence: "参与对话",
  summaryFallback: "正在参与当前协作。",
  model: "模型",
  strengths: "擅长",
  viewProfile: (name) => `${name} · 查看成员信息`,
  replyTo: (name) => `↪ 回应 @${name}`,
};

const enUS: MemberCardCopy = {
  teamLead: "Lead",
  member: "Member",
  presence: "In this conversation",
  summaryFallback: "Working on this collaboration.",
  model: "Model",
  strengths: "Good at",
  viewProfile: (name) => `${name} · view member profile`,
  replyTo: (name) => `↪ replying to @${name}`,
};

const jaJP: MemberCardCopy = {
  teamLead: "リーダー",
  member: "メンバー",
  presence: "会話に参加中",
  summaryFallback: "この共同作業に参加しています。",
  model: "モデル",
  strengths: "得意分野",
  viewProfile: (name) => `${name} · メンバー情報を表示`,
  replyTo: (name) => `↪ @${name} への返信`,
};

const koKR: MemberCardCopy = {
  teamLead: "팀장",
  member: "구성원",
  presence: "대화 참여 중",
  summaryFallback: "현재 협업에 참여하고 있습니다.",
  model: "모델",
  strengths: "강점",
  viewProfile: (name) => `${name} · 구성원 정보 보기`,
  replyTo: (name) => `↪ @${name}에게 답장`,
};

export function memberCardCopy(locale: string): MemberCardCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
