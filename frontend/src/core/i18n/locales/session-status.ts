/**
 * Copy for the chat header's status menu: where this conversation runs, how
 * full the model context is, and what it has produced
 * (components/workspace/workspace-context-menu.tsx and
 * session-status-sections.tsx), plus the toasts of a manual compression
 * (use-thread-timeline.tsx).
 */

export interface SessionStatusCopy {
  /** The header trigger's name; the menu spans all of these sections. */
  menuTitle: string;
  environment: string;
  location: string;
  folder: string;
  engine: string;
  model: string;
  autoModel: string;
  context: string;
  compress: string;
  compressing: (seconds: number) => string;
  compressHint: string;
  /** The runtime always keeps the latest ``keep`` turns verbatim. */
  compressAfterTurns: (keep: number) => string;
  /** Context the engine reports beyond what Echo can itemize. */
  engineContext: string;
  /** How much room is left before the runtime compacts by itself. */
  untilAutoCompact: (tokens: string) => string;
  /** The total is a character estimate, not the measured request. */
  estimated: string;
  estimatedHint: string;
  viewAllOutputs: (count: number) => string;
  compressUnavailable: string;
  compressFailed: string;
  /** The runtime keeps the latest ``keep`` turns verbatim, so a short thread has nothing to fold. */
  tooFewTurns: (turns: number, keep: number) => string;
  nothingToCompress: string;
  /** Usage is close to the runtime's auto-compaction trigger. */
  autoCompactSoon: string;
  outputs: string;
  noOutputs: string;
  /** The composer ring's link to the header menu. */
  openInPanel: string;
}

const zhCN: SessionStatusCopy = {
  menuTitle: "会话状态",
  environment: "环境",
  location: "工作位置",
  folder: "文件夹",
  engine: "引擎",
  model: "模型",
  autoModel: "自动",
  context: "上下文",
  compress: "压缩上下文",
  compressing: (seconds) => `正在压缩… ${seconds}s`,
  compressHint:
    "把较早的对话折叠成摘要，最近几轮保持原样。压缩期间可以继续浏览对话。",
  untilAutoCompact: (tokens) => `约 ${tokens} 后自动压缩`,
  engineContext: "引擎指令与工具",
  compressAfterTurns: (keep) =>
    `超过 ${keep} 轮后可压缩，最近 ${keep} 轮始终保留原文`,
  estimated: "估算",
  estimatedHint: "当前引擎不回报实际请求大小，用量按对话字数估算。",
  viewAllOutputs: (count) => `查看全部 ${count} 个`,
  compressUnavailable: "这个对话暂不支持压缩上下文。",
  compressFailed: "压缩上下文失败",
  tooFewTurns: (turns, keep) =>
    `目前只有 ${turns} 轮对话，最近 ${keep} 轮会原样保留，暂时无需压缩。`,
  nothingToCompress: "暂时没有可压缩的内容。",
  autoCompactSoon: "接近上限：用量到约 90% 时会自动压缩较早的对话。",
  outputs: "产出",
  noOutputs: "这次对话还没有产出文件。",
  openInPanel: "在状态面板查看与压缩",
};

const enUS: SessionStatusCopy = {
  menuTitle: "Session status",
  environment: "Environment",
  location: "Work location",
  folder: "Folder",
  engine: "Engine",
  model: "Model",
  autoModel: "Auto",
  context: "Context",
  compress: "Compress context",
  compressing: (seconds) => `Compressing… ${seconds}s`,
  compressHint:
    "Folds older turns into a summary and keeps the latest ones as they are. You can keep reading while it runs.",
  untilAutoCompact: (tokens) => `Auto-compacts in about ${tokens}`,
  engineContext: "Engine instructions and tools",
  compressAfterTurns: (keep) =>
    `Available after ${keep} turns; the latest ${keep} always stay as they are.`,
  estimated: "est.",
  estimatedHint:
    "This engine does not report the real request size, so usage is estimated from the text.",
  viewAllOutputs: (count) => `View all ${count}`,
  compressUnavailable:
    "Context compression is not available for this conversation.",
  compressFailed: "Failed to compress context",
  tooFewTurns: (turns, keep) =>
    `Only ${turns} turns so far; the latest ${keep} are always kept, so there is nothing to fold yet.`,
  nothingToCompress: "Nothing to compress yet.",
  autoCompactSoon: "Close to the limit: older turns auto-compact at about 90%.",
  outputs: "Outputs",
  noOutputs: "No files produced in this conversation yet.",
  openInPanel: "View and compress in the status panel",
};

const jaJP: SessionStatusCopy = {
  menuTitle: "セッションの状態",
  environment: "環境",
  location: "作業場所",
  folder: "フォルダ",
  engine: "エンジン",
  model: "モデル",
  autoModel: "自動",
  context: "コンテキスト",
  compress: "コンテキストを圧縮",
  compressing: (seconds) => `圧縮中… ${seconds}s`,
  compressHint:
    "古いやり取りを要約にまとめ、直近の数ターンはそのまま残します。圧縮中も会話を閲覧できます。",
  untilAutoCompact: (tokens) => `あと約 ${tokens} で自動圧縮`,
  engineContext: "エンジンの指示とツール",
  compressAfterTurns: (keep) =>
    `${keep} ターンを超えると圧縮できます。直近 ${keep} ターンは常にそのまま残ります。`,
  estimated: "推定",
  estimatedHint:
    "このエンジンは実際のリクエストサイズを報告しないため、使用量はテキスト量から推定しています。",
  viewAllOutputs: (count) => `すべて表示（${count}）`,
  compressUnavailable: "この会話ではコンテキストを圧縮できません。",
  compressFailed: "コンテキストの圧縮に失敗しました",
  tooFewTurns: (turns, keep) =>
    `まだ ${turns} ターンです。直近 ${keep} ターンはそのまま残すため、圧縮するものはありません。`,
  nothingToCompress: "まだ圧縮できる内容はありません。",
  autoCompactSoon:
    "上限が近づいています：約 90% で古いやり取りを自動圧縮します。",
  outputs: "成果物",
  noOutputs: "この会話ではまだファイルが作成されていません。",
  openInPanel: "ステータスパネルで確認・圧縮",
};

const koKR: SessionStatusCopy = {
  menuTitle: "세션 상태",
  environment: "환경",
  location: "작업 위치",
  folder: "폴더",
  engine: "엔진",
  model: "모델",
  autoModel: "자동",
  context: "컨텍스트",
  compress: "컨텍스트 압축",
  compressing: (seconds) => `압축 중… ${seconds}s`,
  compressHint:
    "이전 대화를 요약으로 접고 최근 몇 턴은 그대로 둡니다. 압축 중에도 대화를 볼 수 있습니다.",
  untilAutoCompact: (tokens) => `약 ${tokens} 후 자동 압축`,
  engineContext: "엔진 지시와 도구",
  compressAfterTurns: (keep) =>
    `${keep}턴을 넘으면 압축할 수 있습니다. 최근 ${keep}턴은 항상 그대로 둡니다.`,
  estimated: "추정",
  estimatedHint:
    "이 엔진은 실제 요청 크기를 알려 주지 않아 사용량을 텍스트 양으로 추정합니다.",
  viewAllOutputs: (count) => `모두 보기 (${count})`,
  compressUnavailable: "이 대화에서는 컨텍스트를 압축할 수 없습니다.",
  compressFailed: "컨텍스트 압축에 실패했습니다",
  tooFewTurns: (turns, keep) =>
    `아직 ${turns}턴뿐입니다. 최근 ${keep}턴은 그대로 두므로 압축할 내용이 없습니다.`,
  nothingToCompress: "아직 압축할 내용이 없습니다.",
  autoCompactSoon:
    "한도에 가까워졌습니다: 약 90%에서 이전 대화를 자동 압축합니다.",
  outputs: "산출물",
  noOutputs: "이 대화에서 아직 만든 파일이 없습니다.",
  openInPanel: "상태 패널에서 보기·압축",
};

export function sessionStatusCopy(locale: string): SessionStatusCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
