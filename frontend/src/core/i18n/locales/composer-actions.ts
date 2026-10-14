/**
 * Copy for composer actions (ChatComposer.tsx, StreamingSendActions.tsx,
 * realtime-chat-input.tsx), kept out of the main locale tables.
 */

export interface ComposerActionsCopy {
  /** Shown instead of 发送 when an empty draft would continue the stopped task. */
  resume: string;
  resumeHint: string;
  /** Sent as the user's turn when 继续 is pressed; the agent reads it. */
  resumePrompt: string;
  /** The long-task chip; clicking it leaves the mode. */
  goalModeExit: string;
  milestoneModeExit: string;
  /** Fallback names for attachments without one. */
  imageAttachment: string;
  browserScreenshot: string;
  /** While a reply streams: queue after it, or add to it now. */
  queueLater: string;
  queueLaterHint: string;
  steerNow: string;
  steerNowHint: string;
  /** Design-canvas chat: link state of the canvas. */
  canvasConnecting: string;
  canvasConnected: string;
  canvasSelected: (count: number) => string;
  /** The mode switch failed and the previous mode is back. */
  modeSwitchFailed: string;
}

const zhCN: ComposerActionsCopy = {
  resume: "继续",
  resumeHint: "继续当前任务，保留已有上下文；不会恢复已结束的终端进程",
  resumePrompt:
    "继续当前任务：保留此前完成的工作，先检查中断位置和现有结果，从未完成部分继续，不要重复已成功的操作。",
  goalModeExit: "Goal 模式 · 点击退出",
  milestoneModeExit: "里程碑模式 · 点击退出",
  imageAttachment: "图片",
  browserScreenshot: "浏览器截图",
  queueLater: "稍后执行",
  queueLaterHint: "当前回复结束后执行；附件请在任务结束后发送",
  steerNow: "现在补充",
  steerNowHint: "现在补充，不中断当前操作",
  canvasConnecting: "正在连接画布…",
  canvasConnected: "已连接画布",
  canvasSelected: (count) => `已连接画布 · 已选 ${count}`,
  modeSwitchFailed: "切换模式失败，已还原",
};

const enUS: ComposerActionsCopy = {
  resume: "Continue",
  resumeHint:
    "Continue this task with its context. Finished terminal processes are not restored.",
  resumePrompt:
    "Continue the current task: keep the work already done, check where it stopped and what it produced, continue from the unfinished part, and do not repeat steps that already succeeded.",
  goalModeExit: "Goal mode · click to leave",
  milestoneModeExit: "Milestone mode · click to leave",
  imageAttachment: "Image",
  browserScreenshot: "Browser screenshot",
  queueLater: "Send later",
  queueLaterHint:
    "Runs after the current reply. Send attachments once the task has finished.",
  steerNow: "Add now",
  steerNowHint: "Add this now without stopping the current work",
  canvasConnecting: "Connecting to the canvas…",
  canvasConnected: "Canvas connected",
  canvasSelected: (count) => `Canvas connected · ${count} selected`,
  modeSwitchFailed: "Couldn't switch the mode; the previous one is back",
};

const jaJP: ComposerActionsCopy = {
  resume: "続行",
  resumeHint:
    "これまでのコンテキストを保ったままタスクを続行します。終了したターミナルプロセスは復元されません。",
  resumePrompt:
    "現在のタスクを続けてください。これまでの作業は残したまま、中断した位置と既存の結果を確認し、未完了の部分から続行し、成功した操作は繰り返さないでください。",
  goalModeExit: "Goal モード · クリックで終了",
  milestoneModeExit: "マイルストーンモード · クリックで終了",
  imageAttachment: "画像",
  browserScreenshot: "ブラウザのスクリーンショット",
  queueLater: "後で実行",
  queueLaterHint:
    "現在の応答が終わってから実行します。添付ファイルはタスク完了後に送信してください。",
  steerNow: "今すぐ追加",
  steerNowHint: "現在の作業を止めずに今すぐ追加",
  canvasConnecting: "キャンバスに接続中…",
  canvasConnected: "キャンバスに接続済み",
  canvasSelected: (count) => `キャンバスに接続済み · ${count} 件選択`,
  modeSwitchFailed: "モードを切り替えられませんでした。元のモードに戻しました",
};

const koKR: ComposerActionsCopy = {
  resume: "계속",
  resumeHint:
    "기존 컨텍스트를 유지한 채 작업을 이어갑니다. 끝난 터미널 프로세스는 복원되지 않습니다.",
  resumePrompt:
    "현재 작업을 이어서 하세요. 이미 끝난 작업은 그대로 두고, 멈춘 위치와 기존 결과를 먼저 확인한 뒤 끝나지 않은 부분부터 계속하고, 이미 성공한 단계는 반복하지 마세요.",
  goalModeExit: "Goal 모드 · 클릭해서 종료",
  milestoneModeExit: "마일스톤 모드 · 클릭해서 종료",
  imageAttachment: "이미지",
  browserScreenshot: "브라우저 스크린샷",
  queueLater: "나중에 실행",
  queueLaterHint:
    "현재 응답이 끝난 뒤 실행합니다. 첨부 파일은 작업이 끝난 뒤 보내세요.",
  steerNow: "지금 추가",
  steerNowHint: "현재 작업을 멈추지 않고 지금 추가",
  canvasConnecting: "캔버스 연결 중…",
  canvasConnected: "캔버스 연결됨",
  canvasSelected: (count) => `캔버스 연결됨 · ${count}개 선택`,
  modeSwitchFailed: "모드를 바꾸지 못해 이전 모드로 되돌렸습니다",
};

export function composerActionsCopy(locale: string): ComposerActionsCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
