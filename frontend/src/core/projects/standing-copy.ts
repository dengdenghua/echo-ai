import type { Locale } from "@/core/i18n/locale";

const en = {
  title: "Unattended progress",
  limit: "Total project AI ceiling (USD)",
  phases: "Select reviewed phases",
  review: "Review authorization",
  confirm: "Authorize progress",
  cancel: "Back",
  revoke: "Revoke authorization",
  revokeTitle: "Stop unattended progress?",
  revokeBody:
    "No new work will be admitted. An in-flight call may finish; existing deliverables remain available.",
  bounds:
    "This ceiling includes previous reported project spending. Phase budgets still apply. Calls already in flight may finish beyond the latest reported cost; missing costs stop further calls.",
  approvals:
    "Initiation, new phases and delivery acceptance still require your decision. The app must remain running. Closing this page does not stop authorized progress.",
  active: "Authorization recorded",
  inactive: "No standing authorization",
  saved: "Authorization saved",
  revoked: "Authorization revoked",
  invalid: "Select phases and enter a finite positive ceiling.",
  empty: "No unfinished phases with a finite positive AI budget are available.",
  changed:
    "The plan or review changed. Refresh and review the current phases again.",
  forbidden:
    "Only the authenticated project owner can manage this authorization.",
  failed: "Unable to update authorization. Try again.",
  loading: "Loading…",
  retry: "Retry",
};
export type StandingCopy = typeof en;
export const STANDING_COPY: Record<Locale, StandingCopy> = {
  "en-US": en,
  "zh-CN": {
    title: "无人值守推进",
    limit: "项目累计 AI 费用上限（美元）",
    phases: "选择已审阅的阶段",
    review: "审阅长期授权",
    confirm: "授权继续推进",
    cancel: "返回",
    revoke: "撤销授权",
    revokeTitle: "停止无人值守推进？",
    revokeBody:
      "撤销后不再开始新工作。已在执行的调用可能完成，现有交付产物会保留。",
    bounds:
      "上限包含项目此前已回报的费用，各阶段预算仍生效。已在执行的调用可能超过最新回报的费用上限；费用回报缺失时停止后续调用。",
    approvals:
      "立项、新阶段授权和交付验收仍需你决定。应用需要保持运行，关闭此页面不会停止已授权的推进。",
    active: "已记录长期授权",
    inactive: "尚未授权无人值守推进",
    saved: "授权已保存",
    revoked: "授权已撤销",
    invalid: "请选择阶段，并填写有限的正数费用上限。",
    empty: "没有具备有限正数 AI 预算的未完成阶段。",
    changed: "方案或审核凭据已变化，请刷新后重新审阅当前阶段。",
    forbidden: "只有登录的项目所有者可以管理此授权。",
    failed: "授权操作失败，请重试。",
    loading: "加载中…",
    retry: "重试",
  },
  "ja-JP": {
    title: "無人での進行",
    limit: "プロジェクトの累計 AI 費用上限（USD）",
    phases: "確認済みのフェーズを選択",
    review: "継続承認を確認",
    confirm: "進行を承認",
    cancel: "戻る",
    revoke: "承認を取り消す",
    revokeTitle: "無人での進行を停止しますか？",
    revokeBody:
      "新たな作業を開始しません。実行中の呼び出しは完了する場合があり、既存の成果物は保持されます。",
    bounds:
      "上限には過去に報告されたプロジェクト費用も含まれます。各フェーズの予算も適用されます。実行中の呼び出しは最新の報告額に基づく上限を超える場合があります。費用報告がない場合は次の呼び出しを停止します。",
    approvals:
      "開始、新しいフェーズ、成果物の受け入れには引き続き判断が必要です。アプリの起動が必要で、このページを閉じても承認済みの進行は続きます。",
    active: "継続承認を記録済み",
    inactive: "継続承認なし",
    saved: "承認を保存しました",
    revoked: "承認を取り消しました",
    invalid: "フェーズを選択し、有限の正数で費用上限を入力してください。",
    empty: "有限の正の AI 予算を持つ未完了フェーズがありません。",
    changed:
      "計画または確認情報が変更されました。更新して現在のフェーズを確認してください。",
    forbidden: "ログイン済みのプロジェクト所有者のみが承認を管理できます。",
    failed: "承認を更新できません。再試行してください。",
    loading: "読み込み中…",
    retry: "再試行",
  },
  "ko-KR": {
    title: "무인 진행",
    limit: "프로젝트 누적 AI 비용 한도 (USD)",
    phases: "검토한 단계 선택",
    review: "지속 권한 검토",
    confirm: "진행 허용",
    cancel: "돌아가기",
    revoke: "권한 취소",
    revokeTitle: "무인 진행을 중지할까요?",
    revokeBody:
      "새 작업을 시작하지 않습니다. 실행 중인 호출은 완료될 수 있으며 기존 결과물은 유지됩니다.",
    bounds:
      "한도에는 이전에 보고된 프로젝트 비용도 포함됩니다. 단계별 예산도 적용됩니다. 실행 중인 호출은 최신 보고 비용에 따른 한도를 초과할 수 있으며 비용 보고가 없으면 다음 호출을 중지합니다.",
    approvals:
      "착수, 새 단계 승인 및 결과물 수락은 계속 직접 결정해야 합니다. 앱이 실행 중이어야 하며 이 페이지를 닫아도 승인한 진행은 계속됩니다.",
    active: "지속 권한 기록됨",
    inactive: "지속 권한 없음",
    saved: "권한을 저장했습니다",
    revoked: "권한을 취소했습니다",
    invalid: "단계를 선택하고 유한한 양수 비용 한도를 입력하세요.",
    empty: "유한한 양수 AI 예산이 있는 미완료 단계가 없습니다.",
    changed:
      "계획 또는 검토 정보가 변경되었습니다. 새로 고침 후 현재 단계를 검토하세요.",
    forbidden: "로그인한 프로젝트 소유자만 이 권한을 관리할 수 있습니다.",
    failed: "권한을 변경할 수 없습니다. 다시 시도하세요.",
    loading: "불러오는 중…",
    retry: "다시 시도",
  },
};
