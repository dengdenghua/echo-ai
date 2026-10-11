import { useContext } from "react";
import { I18nContext } from "@/core/i18n/context";
import type { Locale } from "@/core/i18n";

type Copy = {
  filter: string;
  filterPlaceholder: string;
  comparison: string;
  noMatches: string;
  planCompleted: string;
  planHint: string;
  noTasks: string;
  planProgress: string;
  done: string;
  working: string;
  pending: string;
  required: string;
  select: string;
  received: string;
  failed: string;
  waiting: string;
  send: string;
  retry: string;
  receivedHint: string;
  failedHint: string;
  waitingHint: string;
  preparingForm: string;
  replyHint: string;
  preparing: string;
  unavailable: string;
  retrying: string;
  replyPrefix: string;
  emptyField: string;
};
const copies: Record<Locale, Copy> = {
  "zh-CN": {
    filter: "筛选",
    filterPlaceholder: "筛选方案…",
    comparison: "对比表",
    noMatches: "没有匹配的方案",
    planCompleted: "计划完成",
    planHint: "来自当前对话的任务清单；计划状态不代表执行验收。",
    noTasks: "暂无任务记录",
    planProgress: "计划进度",
    done: "已完成",
    working: "进行中",
    pending: "待处理",
    required: "（必填）",
    select: "请选择",
    received: "已收到",
    failed: "发送失败",
    waiting: "等待回执",
    send: "发送到当前对话",
    retry: "重试发送",
    receivedHint: "你的填写已保存到对话。",
    failedHint: "发送失败，请在对话中的失败消息上重试。",
    waitingHint: "正在确认是否收到，请勿重复发送。刷新后会继续核对。",
    preparingForm: "正在准备表单…",
    replyHint: "填写内容将作为你的消息发送。",
    preparing: "正在准备…",
    unavailable:
      "暂时无法发送，请等待当前回复结束，并确认你可以在此对话发言。填写内容已保留。",
    retrying: "正在重新确认发送结果。",
    replyPrefix: "表单回复",
    emptyField: "未填写",
  },
  "en-US": {
    filter: "Filter ",
    filterPlaceholder: "Filter options…",
    comparison: " comparison",
    noMatches: "No matching options",
    planCompleted: "Plan completed",
    planHint:
      "From this conversation's task list; plan status does not verify execution.",
    noTasks: "No tasks yet",
    planProgress: "Plan progress",
    done: "Done",
    working: "In progress",
    pending: "Pending",
    required: " (required)",
    select: "Select an option",
    received: "Received",
    failed: "Send failed",
    waiting: "Awaiting receipt",
    send: "Send to this conversation",
    retry: "Retry sending",
    receivedHint: "Your response is saved in the conversation.",
    failedHint: "Sending failed. Retry the failed message in the conversation.",
    waitingHint:
      "Confirming receipt. Do not send again; confirmation continues after refresh.",
    preparingForm: "Preparing form…",
    replyHint: "These fields will be sent as your message.",
    preparing: "Preparing…",
    unavailable:
      "Cannot send yet. Wait for the current response and confirm you can write in this conversation. Your entries are saved.",
    retrying: "Checking the send result again.",
    replyPrefix: "Form response",
    emptyField: "Not filled in",
  },
  "ja-JP": {
    filter: "絞り込み：",
    filterPlaceholder: "選択肢を絞り込む…",
    comparison: "比較表",
    noMatches: "一致する選択肢はありません",
    planCompleted: "計画完了",
    planHint:
      "この会話のタスク一覧です。計画の状態は実行の検証結果ではありません。",
    noTasks: "タスクはまだありません",
    planProgress: "計画の進捗",
    done: "完了",
    working: "進行中",
    pending: "未対応",
    required: "（必須）",
    select: "選択してください",
    received: "受信済み",
    failed: "送信失敗",
    waiting: "受信確認待ち",
    send: "この会話に送信",
    retry: "再送信",
    receivedHint: "回答を会話に保存しました。",
    failedHint:
      "送信に失敗しました。会話内の失敗したメッセージから再試行してください。",
    waitingHint:
      "受信を確認中です。再送信せずお待ちください。再読み込み後も確認を続けます。",
    preparingForm: "フォームを準備中…",
    replyHint: "入力内容はあなたのメッセージとして送信されます。",
    preparing: "準備中…",
    unavailable:
      "まだ送信できません。現在の応答が終わるまで待ち、この会話に投稿できることを確認してください。入力内容は保存済みです。",
    retrying: "送信結果を再確認しています。",
    replyPrefix: "フォーム回答",
    emptyField: "未入力",
  },
  "ko-KR": {
    filter: "필터: ",
    filterPlaceholder: "옵션 필터링…",
    comparison: " 비교표",
    noMatches: "일치하는 옵션이 없습니다",
    planCompleted: "계획 완료",
    planHint:
      "현재 대화의 작업 목록입니다. 계획 상태는 실행 검증 결과가 아닙니다.",
    noTasks: "아직 작업이 없습니다",
    planProgress: "계획 진행률",
    done: "완료",
    working: "진행 중",
    pending: "대기",
    required: " (필수)",
    select: "선택하세요",
    received: "수신 완료",
    failed: "전송 실패",
    waiting: "수신 확인 대기",
    send: "현재 대화로 보내기",
    retry: "전송 재시도",
    receivedHint: "응답을 대화에 저장했습니다.",
    failedHint: "전송에 실패했습니다. 대화에서 실패한 메시지를 재시도하세요.",
    waitingHint:
      "수신을 확인 중입니다. 다시 보내지 마세요. 새로 고침 후에도 확인을 계속합니다.",
    preparingForm: "양식 준비 중…",
    replyHint: "입력 내용이 내 메시지로 전송됩니다.",
    preparing: "준비 중…",
    unavailable:
      "아직 보낼 수 없습니다. 현재 응답이 끝날 때까지 기다리고 이 대화에 글을 쓸 수 있는지 확인하세요. 입력 내용은 저장되었습니다.",
    retrying: "전송 결과를 다시 확인하고 있습니다.",
    replyPrefix: "양식 응답",
    emptyField: "미입력",
  },
};
export function useNativeUICopy(): Copy {
  return copies[useContext(I18nContext)?.locale ?? "zh-CN"];
}
