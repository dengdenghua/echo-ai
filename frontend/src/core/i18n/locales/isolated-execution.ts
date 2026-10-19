const copy = {
  "zh-CN": {
    label: "自动执行（隔离）",
    description:
      "在本机隔离工作区内自动执行，不逐项审批；越界操作直接拒绝，隔离不可用时停止。",
  },
  "en-US": {
    label: "Automatic (isolated)",
    description:
      "Run automatically in the local isolated workspace without per-action approval. Reject boundary crossings and stop if isolation is unavailable.",
  },
  "ja-JP": {
    label: "自動実行（分離）",
    description:
      "ローカルの分離された作業領域で承認なしに実行します。範囲外の操作は拒否し、分離できない場合は停止します。",
  },
  "ko-KR": {
    label: "자동 실행 (격리)",
    description:
      "로컬 격리 작업 공간에서 개별 승인 없이 실행합니다. 범위 밖 작업은 거부하며 격리가 불가능하면 중지합니다.",
  },
};
export function isolatedExecutionCopy(locale: string) {
  if (locale === "zh-CN" || locale === "ja-JP" || locale === "ko-KR") return copy[locale];
  return copy["en-US"];
}
