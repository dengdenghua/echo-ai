const copy = {
  "zh-CN": {
    label: "下轮权限",
    prefix: "下轮 · ",
    hint: "此设置用于后续新任务。当前任务和补充说明沿用已有权限；等待中的审批仍需单独处理。",
  },
  "en-US": {
    label: "Next task permissions",
    prefix: "Next · ",
    hint: "This setting applies to future tasks. The running task and follow-up instructions keep their existing permissions; pending approvals still need a separate decision.",
  },
  "ja-JP": {
    label: "次のタスクの権限",
    prefix: "次回 · ",
    hint: "この設定は次の新規タスクに適用されます。実行中のタスクと追加指示の権限は変わりません。保留中の承認は別途判断してください。",
  },
  "ko-KR": {
    label: "다음 작업 권한",
    prefix: "다음 · ",
    hint: "이 설정은 이후 새 작업에 적용됩니다. 실행 중인 작업과 추가 지시는 기존 권한을 유지하며, 대기 중인 승인은 별도로 결정해야 합니다.",
  },
};

export function permissionScopeCopy(locale: string) {
  if (locale === "zh-CN" || locale === "ja-JP" || locale === "ko-KR")
    return copy[locale];
  return copy["en-US"];
}
