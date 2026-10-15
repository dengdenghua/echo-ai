/**
 * Copy for file chips in answers and their read dialog
 * (components/workspace/messages/linked-file-reference.tsx).
 */

export interface LinkedFileReferenceCopy {
  /** Shown when the workspace read failed but the conversation produced a
   * file with the same name. */
  openInArtifacts: string;
}

const zhCN: LinkedFileReferenceCopy = {
  openInArtifacts: "在产物中打开",
};

const enUS: LinkedFileReferenceCopy = {
  openInArtifacts: "Open in Artifacts",
};

const jaJP: LinkedFileReferenceCopy = {
  openInArtifacts: "アーティファクトで開く",
};

const koKR: LinkedFileReferenceCopy = {
  openInArtifacts: "아티팩트에서 열기",
};

export function linkedFileReferenceCopy(
  locale: string,
): LinkedFileReferenceCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
