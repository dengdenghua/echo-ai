/**
 * Copy for actions and receipts on a single chat message
 * (components/workspace/messages/message-list-item.tsx): the opposite-engine
 * shadow review, the side-question menu item, the inline video player label
 * and the interrupted/paused receipts that carry a reason.
 */

export interface MessageActionsCopy {
  sideQuestion: string;
  videoPreview: string;
  interruptedWithReason: (message: string, reason: string) => string;
  pausedWithReason: (message: string, reason: string) => string;
  shadowReview: {
    request: string;
    running: string;
    completedView: string;
    failedView: string;
    completedToast: string;
    failedToast: string;
    notEnabled: string;
    queued: (engine: string) => string;
    submitFailed: string;
    dialogTitle: string;
    dialogDescription: (engine: string) => string;
    empty: string;
  };
}

const zhCN: MessageActionsCopy = {
  sideQuestion: "在旁路追问",
  videoPreview: "视频预览",
  interruptedWithReason: (message, reason) => `${message}（原因：${reason}）`,
  pausedWithReason: (message, reason) => `${message}（${reason}）`,
  shadowReview: {
    request: "让另一引擎复核本次任务",
    running: "另一引擎正在影子复核",
    completedView: "影子复核已完成，点击查看",
    failedView: "影子复核失败，点击查看",
    completedToast: "另一引擎已完成影子复核",
    failedToast: "影子复核未完成，可点击查看原因",
    notEnabled: "请先到“自进化”页面开启影子模式",
    queued: (engine) => `已交给 ${engine} 影子复核`,
    submitFailed: "影子复核提交失败",
    dialogTitle: "双引擎影子复核",
    dialogDescription: (engine) =>
      `${engine} 在隔离的只读副本中给出的复核结果。`,
    empty: "暂时没有可显示的结果。",
  },
};

const enUS: MessageActionsCopy = {
  sideQuestion: "Ask a side question",
  videoPreview: "Video preview",
  interruptedWithReason: (message, reason) => `${message} (Reason: ${reason})`,
  pausedWithReason: (message, reason) => `${message} (${reason})`,
  shadowReview: {
    request: "Have the other engine review this task",
    running: "The other engine is reviewing",
    completedView: "Shadow review finished. Click to view",
    failedView: "Shadow review failed. Click to view",
    completedToast: "The other engine finished its shadow review",
    failedToast: "Shadow review didn't finish. Click to see why",
    notEnabled: "Turn on shadow mode on the Evolution page first",
    queued: (engine) => `Sent to ${engine} for shadow review`,
    submitFailed: "Couldn't start the shadow review",
    dialogTitle: "Dual-engine shadow review",
    dialogDescription: (engine) =>
      `Review by ${engine}, run on an isolated read-only copy.`,
    empty: "No result to show yet.",
  },
};

const jaJP: MessageActionsCopy = {
  sideQuestion: "サイドで質問",
  videoPreview: "動画プレビュー",
  interruptedWithReason: (message, reason) => `${message}（理由：${reason}）`,
  pausedWithReason: (message, reason) => `${message}（${reason}）`,
  shadowReview: {
    request: "もう一方のエンジンにこのタスクをレビューさせる",
    running: "もう一方のエンジンがシャドウレビュー中",
    completedView: "シャドウレビューが完了しました。クリックして表示",
    failedView: "シャドウレビューに失敗しました。クリックして表示",
    completedToast: "もう一方のエンジンがシャドウレビューを完了しました",
    failedToast:
      "シャドウレビューが完了しませんでした。クリックすると理由を確認できます",
    notEnabled: "先に「自己進化」ページでシャドウモードをオンにしてください",
    queued: (engine) => `${engine} にシャドウレビューを依頼しました`,
    submitFailed: "シャドウレビューを開始できませんでした",
    dialogTitle: "デュアルエンジン シャドウレビュー",
    dialogDescription: (engine) =>
      `${engine} が隔離された読み取り専用コピーで行ったレビュー結果です。`,
    empty: "表示できる結果はまだありません。",
  },
};

const koKR: MessageActionsCopy = {
  sideQuestion: "사이드 질문하기",
  videoPreview: "동영상 미리보기",
  interruptedWithReason: (message, reason) => `${message} (사유: ${reason})`,
  pausedWithReason: (message, reason) => `${message} (${reason})`,
  shadowReview: {
    request: "다른 엔진에 이 작업 검토 요청",
    running: "다른 엔진이 섀도 검토 중",
    completedView: "섀도 검토 완료. 클릭하여 보기",
    failedView: "섀도 검토 실패. 클릭하여 보기",
    completedToast: "다른 엔진이 섀도 검토를 마쳤습니다",
    failedToast: "섀도 검토가 완료되지 않았습니다. 클릭하여 이유를 확인하세요",
    notEnabled: "먼저 '자기 진화' 페이지에서 섀도 모드를 켜 주세요",
    queued: (engine) => `${engine} 엔진에 섀도 검토를 요청했습니다`,
    submitFailed: "섀도 검토를 시작하지 못했습니다",
    dialogTitle: "듀얼 엔진 섀도 검토",
    dialogDescription: (engine) =>
      `${engine} 엔진이 격리된 읽기 전용 사본에서 수행한 검토 결과입니다.`,
    empty: "아직 표시할 결과가 없습니다.",
  },
};

export function messageActionsCopy(locale: string): MessageActionsCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
