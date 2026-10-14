/**
 * Copy for rendered Mermaid diagrams in chat messages
 * (components/workspace/messages/mermaid-block.tsx).
 */

export interface MermaidCopy {
  zoomOut: string;
  zoomIn: string;
  fitWidth: string;
  /** Toggle label shown while the diagram is dark: switch to light. */
  lightTheme: string;
  /** Toggle label shown while the diagram is light: switch to dark. */
  darkTheme: string;
  pngExportFailed: string;
  renderFailed: string;
  copySource: string;
}

const zhCN: MermaidCopy = {
  zoomOut: "缩小",
  zoomIn: "放大",
  fitWidth: "适应宽度",
  lightTheme: "浅色",
  darkTheme: "深色",
  pngExportFailed: "PNG 导出失败，可下载 SVG。",
  renderFailed: "Mermaid 渲染失败",
  copySource: "复制 Mermaid 源码",
};

const enUS: MermaidCopy = {
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  fitWidth: "Fit width",
  lightTheme: "Light",
  darkTheme: "Dark",
  pngExportFailed: "PNG export failed. Download the SVG instead.",
  renderFailed: "Mermaid render failed",
  copySource: "Copy Mermaid source",
};

const jaJP: MermaidCopy = {
  zoomOut: "縮小",
  zoomIn: "拡大",
  fitWidth: "幅に合わせる",
  lightTheme: "ライト",
  darkTheme: "ダーク",
  pngExportFailed:
    "PNG を書き出せませんでした。SVG をダウンロードしてください。",
  renderFailed: "Mermaid の描画に失敗しました",
  copySource: "Mermaid ソースをコピー",
};

const koKR: MermaidCopy = {
  zoomOut: "축소",
  zoomIn: "확대",
  fitWidth: "너비에 맞춤",
  lightTheme: "라이트",
  darkTheme: "다크",
  pngExportFailed: "PNG로 내보내지 못했습니다. SVG를 다운로드하세요.",
  renderFailed: "Mermaid 렌더링 실패",
  copySource: "Mermaid 소스 복사",
};

export function mermaidCopy(locale: string): MermaidCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
