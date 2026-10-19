import type { Locale } from "../locale";

const enStatus: Record<string, string> = {
    connecting: "Connecting…",
    running: "Running…",
    reconnecting: "Reconnecting; checking task state…",
    recovery_error: "Could not recover task state",
    awaiting_approval: "Waiting for your approval",
    completed: "Completed",
    completed_with_warning: "Completed with a warning",
    partial: "Partially completed",
    blocked_on_user: "Needs your input",
    paused: "Paused",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
    failed: "Failed",
    unknown: "Delivery uncertain; check the conversation before retrying",
};

const zhStatus: Record<string, string> = {
      connecting: "正在连接…",
      running: "正在执行…",
      reconnecting: "正在重连并核对任务状态…",
      recovery_error: "无法恢复任务状态",
      awaiting_approval: "等待你审批",
      completed: "已完成",
      completed_with_warning: "已完成，请留意结果中的提示",
      partial: "部分完成",
      blocked_on_user: "需要你补充信息",
      paused: "已暂停",
      cancelled: "已取消",
      interrupted: "已中断",
      failed: "执行失败",
      unknown: "发送状态不确定，请查看会话后再决定是否重试",
};

const jaStatus: Record<string, string> = {
      connecting: "接続中…",
      running: "実行中…",
      reconnecting: "再接続して状態を確認中…",
      recovery_error: "タスクの状態を復元できません",
      awaiting_approval: "承認待ち",
      completed: "完了",
      completed_with_warning: "注意事項付きで完了",
      partial: "一部完了",
      blocked_on_user: "追加情報が必要です",
      paused: "一時停止",
      cancelled: "キャンセル済み",
      interrupted: "中断",
      failed: "失敗",
      unknown: "送信状態が不明です。再実行する前に会話を確認してください",
};

const koStatus: Record<string, string> = {
      connecting: "연결 중…",
      running: "실행 중…",
      reconnecting: "다시 연결하여 상태 확인 중…",
      recovery_error: "작업 상태를 복원할 수 없습니다",
      awaiting_approval: "승인 대기 중",
      completed: "완료",
      completed_with_warning: "주의 사항과 함께 완료",
      partial: "일부 완료",
      blocked_on_user: "추가 정보 필요",
      paused: "일시 정지",
      cancelled: "취소됨",
      interrupted: "중단됨",
      failed: "실패",
      unknown: "전송 상태가 불확실합니다. 재시도 전에 대화를 확인하세요",
};

const en = {
  task: "Application task",
  run: "Run task",
  open: "Open task conversation",
  stop: "Stop",
  reconnect: "Reconnect",
  review:
    "Run this request using normal tool approvals. The final answer will be returned to this application. Model usage may incur charges.",
  closeHint:
    "Closing the app leaves the task in its conversation. You can continue there.",
  status: enStatus,
};
const copy = {
  "en-US": en,
  "zh-CN": {
    task: "应用任务",
    run: "开始执行",
    open: "查看任务会话",
    stop: "停止",
    reconnect: "重新连接",
    review:
      "确认后开始执行，工具操作沿用现有审批。最终回答会返回此应用，模型调用可能产生费用。",
    closeHint: "关闭应用后，任务保留在会话中，可前往会话继续查看。",
    status: zhStatus,
  },
  "ja-JP": {
    ...en,
    task: "アプリのタスク",
    run: "実行",
    open: "タスクの会話を開く",
    stop: "停止",
    reconnect: "再接続",
    review:
      "確認後、通常の承認手順で実行し、最終回答をアプリに返します。モデル利用料金が発生する場合があります。",
    closeHint: "アプリを閉じてもタスクは会話に残り、そこで確認できます。",
    status: jaStatus,
  },
  "ko-KR": {
    ...en,
    task: "앱 작업",
    run: "실행",
    open: "작업 대화 열기",
    stop: "중지",
    reconnect: "다시 연결",
    review:
      "확인 후 기존 승인 절차에 따라 실행하고 최종 답변을 앱에 반환합니다. 모델 사용 요금이 발생할 수 있습니다.",
    closeHint: "앱을 닫아도 작업은 대화에 남아 계속 확인할 수 있습니다.",
    status: koStatus,
  },
};
export function appTaskCopy(locale: Locale) {
  return copy[locale] ?? en;
}
