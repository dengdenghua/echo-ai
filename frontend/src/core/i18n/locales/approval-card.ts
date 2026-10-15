/**
 * Copy for the approval card above the composer
 * (components/workspace/realtime-approval-toasts.tsx).
 */

export interface ApprovalCardCopy {
  /** The host has no hard sandbox, so approving runs the command directly. */
  unconfined: string;
  /** A file write: how many lines it writes. */
  lineCount: (count: number) => string;
}

const zhCN: ApprovalCardCopy = {
  unconfined: "本机没有沙箱隔离，批准后将直接在本机运行",
  lineCount: (count) => `${count} 行`,
};

const enUS: ApprovalCardCopy = {
  unconfined: "No sandbox on this computer: approving runs it directly here",
  lineCount: (count) => (count === 1 ? "1 line" : `${count} lines`),
};

const jaJP: ApprovalCardCopy = {
  unconfined:
    "このコンピューターにはサンドボックスがありません。承認するとそのまま実行されます",
  lineCount: (count) => `${count} 行`,
};

const koKR: ApprovalCardCopy = {
  unconfined: "이 컴퓨터에는 샌드박스가 없어 승인하면 바로 실행됩니다",
  lineCount: (count) => `${count}줄`,
};

export function approvalCardCopy(locale: string): ApprovalCardCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
