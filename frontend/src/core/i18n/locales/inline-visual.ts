/**
 * Copy for show_visual results rendered in chat
 * (components/workspace/messages/inline-visual.tsx). The save/fix requests
 * are sent to the current task as the user's own message, so they follow the
 * UI language too.
 */

export type InlineVisualStatus =
  | "waiting"
  | "streaming"
  | "rendered"
  | "error"
  | "noReceipt";

export interface InlineVisualCopy {
  status: Record<InlineVisualStatus, string>;
  receiptNotSynced: string;
  viewVisual: string;
  viewSource: string;
  saveAsArtifact: string;
  requestFix: string;
  submitted: string;
  inputUnavailable: string;
  defaultTitle: string;
  saveRequest: (
    visualId: string,
    title: string,
    includesSvg: boolean,
  ) => string;
  fixRequest: (visualId: string, title: string, error: string) => string;
}

const zhCN: InlineVisualCopy = {
  status: {
    waiting: "等待浏览器渲染",
    streaming: "生成中 · 静态预览",
    rendered: "浏览器已渲染",
    error: "渲染出错",
    noReceipt: "尚未收到浏览器回执",
  },
  receiptNotSynced: "本地显示状态未同步；智能体尚未收到回执。",
  viewVisual: "查看图形",
  viewSource: "查看源码",
  saveAsArtifact: "保存为产物",
  requestFix: "请求修复",
  submitted: "已提交到当前任务",
  inputUnavailable: "当前任务输入不可用，请复制源码保存。",
  defaultTitle: "可视化",
  saveRequest: (visualId, title, includesSvg) =>
    `请把可视化 ${visualId}（${title}）保存为当前任务工作区的 ${includesSvg ? "SVG 和 HTML" : "HTML"} 产物，沿用产物预览和版本管理，并给出文件链接。`,
  fixRequest: (visualId, title, error) =>
    `请修复可视化 ${visualId}（${title}）。浏览器报错：${error}。修正后重新 show_visual。`,
};

const enUS: InlineVisualCopy = {
  status: {
    waiting: "Waiting for the browser to render",
    streaming: "Generating · static preview",
    rendered: "Rendered in browser",
    error: "Render error",
    noReceipt: "No render receipt from the browser yet",
  },
  receiptNotSynced:
    "The display status wasn't synced, so the agent hasn't received the receipt.",
  viewVisual: "View visual",
  viewSource: "View source",
  saveAsArtifact: "Save as artifact",
  requestFix: "Request a fix",
  submitted: "Sent to the current task",
  inputUnavailable:
    "The current task can't take input right now. Copy the source to keep it.",
  defaultTitle: "Visual",
  saveRequest: (visualId, title, includesSvg) =>
    `Save visual ${visualId} (${title}) as ${includesSvg ? "SVG and HTML" : "HTML"} artifacts in this task's workspace, using artifact preview and versioning, and share the file links.`,
  fixRequest: (visualId, title, error) =>
    `Fix visual ${visualId} (${title}). Browser error: ${error}. Call show_visual again once it's fixed.`,
};

const jaJP: InlineVisualCopy = {
  status: {
    waiting: "ブラウザの描画を待っています",
    streaming: "生成中 · 静的プレビュー",
    rendered: "ブラウザで描画済み",
    error: "描画エラー",
    noReceipt: "ブラウザからの描画確認がまだありません",
  },
  receiptNotSynced:
    "表示状態を同期できなかったため、エージェントはまだ確認を受け取っていません。",
  viewVisual: "図を表示",
  viewSource: "ソースを表示",
  saveAsArtifact: "成果物として保存",
  requestFix: "修正を依頼",
  submitted: "現在のタスクに送信しました",
  inputUnavailable:
    "現在のタスクには入力できません。ソースをコピーして保存してください。",
  defaultTitle: "ビジュアル",
  saveRequest: (visualId, title, includesSvg) =>
    `ビジュアル ${visualId}（${title}）を、現在のタスクのワークスペースに ${includesSvg ? "SVG と HTML" : "HTML"} の成果物として保存してください。成果物のプレビューとバージョン管理を使い、ファイルのリンクを示してください。`,
  fixRequest: (visualId, title, error) =>
    `ビジュアル ${visualId}（${title}）を修正してください。ブラウザのエラー：${error}。修正後に show_visual をもう一度実行してください。`,
};

const koKR: InlineVisualCopy = {
  status: {
    waiting: "브라우저 렌더링 대기 중",
    streaming: "생성 중 · 정적 미리보기",
    rendered: "브라우저에서 렌더링됨",
    error: "렌더링 오류",
    noReceipt: "아직 브라우저 렌더링 확인을 받지 못했습니다",
  },
  receiptNotSynced:
    "표시 상태가 동기화되지 않아 에이전트가 아직 확인을 받지 못했습니다.",
  viewVisual: "그래픽 보기",
  viewSource: "소스 보기",
  saveAsArtifact: "아티팩트로 저장",
  requestFix: "수정 요청",
  submitted: "현재 작업에 보냈습니다",
  inputUnavailable: "현재 작업에 입력할 수 없습니다. 소스를 복사해 저장하세요.",
  defaultTitle: "시각화",
  saveRequest: (visualId, title, includesSvg) =>
    `시각화 ${visualId}(${title}) 항목을 현재 작업 공간에 ${includesSvg ? "SVG 및 HTML" : "HTML"} 아티팩트로 저장해 주세요. 아티팩트 미리보기와 버전 관리를 사용하고 파일 링크를 알려 주세요.`,
  fixRequest: (visualId, title, error) =>
    `시각화 ${visualId}(${title}) 항목을 수정해 주세요. 브라우저 오류: ${error}. 수정한 뒤 show_visual을 다시 호출하세요.`,
};

export function inlineVisualCopy(locale: string): InlineVisualCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
