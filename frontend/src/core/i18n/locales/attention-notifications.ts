// Copy for long-task attention notifications: the system notifications sent
// when a task completes, fails, needs approval or pauses while the user is
// elsewhere, the matching sidebar markers, and their settings rows.
// Typed (not English-keyed): a missing translation is a type error.

export interface AttentionNotificationCopy {
  completedTitle: string;
  /** A background task left the active list; the outcome is not known. */
  finishedTitle: string;
  failedTitle: string;
  approvalTitle: string;
  approvalTimeoutTitle: string;
  blockedTitle: string;
  pausedTitle: string;
  pausedBudgetTitle: string;
  pausedIterationTitle: string;
  pausedWallClockTitle: string;
  pausedSpinningTitle: string;
  /** Second body line for a finished background task. */
  finishedHint: string;
  /** Second body line for anything that waits on the user. */
  actionHint: string;
  untitledThread: string;
  summaryTitle: (count: number) => string;
  summaryBody: string;

  settingsHeading: string;
  settingsHint: string;
  categoryCompleted: string;
  categoryCompletedHint: string;
  categoryFailed: string;
  categoryFailedHint: string;
  categoryApproval: string;
  categoryApprovalHint: string;
  categoryPaused: string;
  categoryPausedHint: string;
}

export const attentionNotificationsEnUS: AttentionNotificationCopy = {
  completedTitle: "Task completed",
  finishedTitle: "Task finished",
  failedTitle: "Task failed",
  approvalTitle: "Needs your approval",
  approvalTimeoutTitle: "Approval timed out — task paused",
  blockedTitle: "Waiting for your reply",
  pausedTitle: "Task paused",
  pausedBudgetTitle: "Task paused: budget limit reached",
  pausedIterationTitle: "Task paused: step limit reached",
  pausedWallClockTitle: "Task paused: time limit reached",
  pausedSpinningTitle: "Task paused: the model stopped making progress",
  finishedHint: "Finished in the background. Click to see the result.",
  actionHint: "Click to take a look.",
  untitledThread: "Untitled task",
  summaryTitle: (count) =>
    `${count} more task ${count === 1 ? "update" : "updates"}`,
  summaryBody: "Open Echo to see which tasks need you.",

  settingsHeading: "Notify me when",
  settingsHint:
    "Sent when Echo is in the background or the task is not the one on screen.",
  categoryCompleted: "A task completes",
  categoryCompletedHint: "Including tasks that finish in the background.",
  categoryFailed: "A task fails",
  categoryFailedHint: "The run stopped with an error.",
  categoryApproval: "A task needs approval or a reply",
  categoryApprovalHint:
    "A tool call waits for approval, an approval timed out, or the agent asks you something.",
  categoryPaused: "A task pauses",
  categoryPausedHint: "Paused at a budget, step or run-time limit.",
};

export const attentionNotificationsZhCN: AttentionNotificationCopy = {
  completedTitle: "任务已完成",
  finishedTitle: "任务已结束",
  failedTitle: "任务失败",
  approvalTitle: "需要你的审批",
  approvalTimeoutTitle: "审批超时，任务已暂停",
  blockedTitle: "等待你的回复",
  pausedTitle: "任务已暂停",
  pausedBudgetTitle: "任务已暂停：预算已达上限",
  pausedIterationTitle: "任务已暂停：迭代次数已达上限",
  pausedWallClockTitle: "任务已暂停：运行时长已达上限",
  pausedSpinningTitle: "任务已暂停：模型没有进展",
  finishedHint: "已在后台结束，点击查看结果。",
  actionHint: "点击前往处理。",
  untitledThread: "未命名任务",
  summaryTitle: (count) => `另有 ${count} 条任务提醒`,
  summaryBody: "打开 Echo 查看哪些任务需要你处理。",

  settingsHeading: "提醒类型",
  settingsHint: "Echo 在后台，或该任务不是当前正在查看的对话时发送。",
  categoryCompleted: "任务完成",
  categoryCompletedHint: "包括在后台结束的任务。",
  categoryFailed: "任务失败",
  categoryFailedHint: "任务因错误停止。",
  categoryApproval: "需要审批或回复",
  categoryApprovalHint: "工具调用等待审批、审批超时，或智能体在等你回复。",
  categoryPaused: "任务暂停",
  categoryPausedHint: "因预算、迭代次数或运行时长上限而暂停。",
};

export const attentionNotificationsJaJP: AttentionNotificationCopy = {
  completedTitle: "タスクが完了しました",
  finishedTitle: "タスクが終了しました",
  failedTitle: "タスクが失敗しました",
  approvalTitle: "承認が必要です",
  approvalTimeoutTitle: "承認がタイムアウトし、タスクを一時停止しました",
  blockedTitle: "返信を待っています",
  pausedTitle: "タスクを一時停止しました",
  pausedBudgetTitle: "一時停止：予算の上限に達しました",
  pausedIterationTitle: "一時停止：ステップ数の上限に達しました",
  pausedWallClockTitle: "一時停止：実行時間の上限に達しました",
  pausedSpinningTitle: "一時停止：モデルの処理が進んでいません",
  finishedHint: "バックグラウンドで終了しました。クリックして結果を確認。",
  actionHint: "クリックして確認してください。",
  untitledThread: "無題のタスク",
  summaryTitle: (count) => `ほかに ${count} 件のタスク通知`,
  summaryBody: "Echo を開いて対応が必要なタスクを確認してください。",

  settingsHeading: "通知するタイミング",
  settingsHint:
    "Echo がバックグラウンドにあるとき、または表示中ではないタスクで送信します。",
  categoryCompleted: "タスクの完了",
  categoryCompletedHint: "バックグラウンドで終了したタスクを含みます。",
  categoryFailed: "タスクの失敗",
  categoryFailedHint: "エラーで停止したとき。",
  categoryApproval: "承認または返信が必要",
  categoryApprovalHint:
    "ツール呼び出しの承認待ち、承認のタイムアウト、またはエージェントからの質問。",
  categoryPaused: "タスクの一時停止",
  categoryPausedHint: "予算・ステップ数・実行時間の上限で一時停止したとき。",
};

export const attentionNotificationsKoKR: AttentionNotificationCopy = {
  completedTitle: "작업이 완료되었습니다",
  finishedTitle: "작업이 종료되었습니다",
  failedTitle: "작업이 실패했습니다",
  approvalTitle: "승인이 필요합니다",
  approvalTimeoutTitle: "승인 시간이 초과되어 작업이 일시 중지되었습니다",
  blockedTitle: "답장을 기다리고 있습니다",
  pausedTitle: "작업이 일시 중지되었습니다",
  pausedBudgetTitle: "일시 중지: 예산 한도에 도달했습니다",
  pausedIterationTitle: "일시 중지: 단계 한도에 도달했습니다",
  pausedWallClockTitle: "일시 중지: 실행 시간 한도에 도달했습니다",
  pausedSpinningTitle: "일시 중지: 모델이 진행하지 못하고 있습니다",
  finishedHint: "백그라운드에서 종료되었습니다. 클릭하여 결과를 확인하세요.",
  actionHint: "클릭하여 확인하세요.",
  untitledThread: "제목 없는 작업",
  summaryTitle: (count) => `작업 알림 ${count}건 더 있음`,
  summaryBody: "Echo를 열어 처리가 필요한 작업을 확인하세요.",

  settingsHeading: "알림 받을 상황",
  settingsHint:
    "Echo가 백그라운드에 있거나 현재 보고 있지 않은 작업일 때 보냅니다.",
  categoryCompleted: "작업 완료",
  categoryCompletedHint: "백그라운드에서 종료된 작업을 포함합니다.",
  categoryFailed: "작업 실패",
  categoryFailedHint: "오류로 중단된 경우.",
  categoryApproval: "승인 또는 답장이 필요할 때",
  categoryApprovalHint:
    "도구 호출이 승인을 기다리거나, 승인 시간이 초과되었거나, 에이전트가 질문할 때.",
  categoryPaused: "작업 일시 중지",
  categoryPausedHint: "예산, 단계 수 또는 실행 시간 한도로 일시 중지된 경우.",
};
