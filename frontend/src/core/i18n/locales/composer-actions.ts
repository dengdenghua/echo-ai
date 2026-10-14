/**
 * Copy for composer actions that live in ChatComposer.tsx, kept out of the
 * main locale tables.
 */

export interface ComposerActionsCopy {
  /** Shown instead of 发送 when an empty draft would continue the stopped task. */
  resume: string;
  resumeHint: string;
}

const zhCN: ComposerActionsCopy = {
  resume: "继续",
  resumeHint: "继续当前任务，保留已有上下文；不会恢复已结束的终端进程",
};

const enUS: ComposerActionsCopy = {
  resume: "Continue",
  resumeHint:
    "Continue this task with its context. Finished terminal processes are not restored.",
};

const jaJP: ComposerActionsCopy = {
  resume: "続行",
  resumeHint:
    "これまでのコンテキストを保ったままタスクを続行します。終了したターミナルプロセスは復元されません。",
};

const koKR: ComposerActionsCopy = {
  resume: "계속",
  resumeHint:
    "기존 컨텍스트를 유지한 채 작업을 이어갑니다. 끝난 터미널 프로세스는 복원되지 않습니다.",
};

export function composerActionsCopy(locale: string): ComposerActionsCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
