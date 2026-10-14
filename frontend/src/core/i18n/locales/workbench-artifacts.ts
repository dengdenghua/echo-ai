/**
 * Copy for the workbench's artifacts tab
 * (agent-workbench-panel/artifact-inline-preview.tsx).
 */

export interface WorkbenchArtifactsCopy {
  /** Badge on files produced in the current turn. */
  currentTurn: string;
  previewUnsupported: string;
}

const zhCN: WorkbenchArtifactsCopy = {
  currentTurn: "本轮",
  previewUnsupported: "此文件类型暂不支持预览",
};

const enUS: WorkbenchArtifactsCopy = {
  currentTurn: "This turn",
  previewUnsupported: "Preview isn't available for this file type yet",
};

const jaJP: WorkbenchArtifactsCopy = {
  currentTurn: "今回",
  previewUnsupported: "このファイル形式はまだプレビューできません",
};

const koKR: WorkbenchArtifactsCopy = {
  currentTurn: "이번 턴",
  previewUnsupported: "이 파일 형식은 아직 미리 볼 수 없습니다",
};

export function workbenchArtifactsCopy(locale: string): WorkbenchArtifactsCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
