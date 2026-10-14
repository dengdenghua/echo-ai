/**
 * Copy for the clarification card an agent shows when it needs the user to
 * pick or type an answer (components/workspace/messages/clarification-choice-card.tsx).
 */

export interface ClarificationCopy {
  /** The agent waits; it never answers on the user's behalf. */
  waitsForYou: string;
  sendOther: string;
}

const zhCN: ClarificationCopy = {
  waitsForYou: "请选择后提交，不会自动代答",
  sendOther: "发送这个回答",
};

const enUS: ClarificationCopy = {
  waitsForYou: "Pick an answer to continue; nothing is answered for you",
  sendOther: "Send this answer",
};

const jaJP: ClarificationCopy = {
  waitsForYou: "選んで送信してください。自動では回答しません",
  sendOther: "この回答を送信",
};

const koKR: ClarificationCopy = {
  waitsForYou: "선택해서 보내 주세요. 대신 답하지 않습니다",
  sendOther: "이 답변 보내기",
};

export function clarificationCopy(locale: string): ClarificationCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
