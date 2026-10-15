/**
 * Copy for the workbench's artifacts tab
 * (agent-workbench-panel/artifact-inline-preview.tsx).
 */

export interface WorkbenchArtifactsCopy {
  /** Badge on files produced in the current turn. */
  currentTurn: string;
  previewUnsupported: string;
  /** Above a code/text preview cut to its first 200 KB. */
  previewTruncated: string;
}

const zhCN: WorkbenchArtifactsCopy = {
  currentTurn: "本轮",
  previewUnsupported: "此文件类型暂不支持预览",
  previewTruncated: "文件较大，仅显示前 200 KB，完整内容请下载。",
};

const enUS: WorkbenchArtifactsCopy = {
  currentTurn: "This turn",
  previewUnsupported: "Preview isn't available for this file type yet",
  previewTruncated:
    "Large file: showing the first 200 KB. Download it for the full content.",
};

const jaJP: WorkbenchArtifactsCopy = {
  currentTurn: "今回",
  previewUnsupported: "このファイル形式はまだプレビューできません",
  previewTruncated:
    "大きなファイルのため先頭 200 KB のみ表示しています。全体はダウンロードしてください。",
};

const koKR: WorkbenchArtifactsCopy = {
  currentTurn: "이번 턴",
  previewUnsupported: "이 파일 형식은 아직 미리 볼 수 없습니다",
  previewTruncated:
    "파일이 커서 처음 200KB만 표시합니다. 전체 내용은 다운로드하세요.",
};

export function workbenchArtifactsCopy(locale: string): WorkbenchArtifactsCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
