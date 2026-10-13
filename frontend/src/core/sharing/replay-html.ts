/**
 * Self-contained replay exporter — packages an agent run (a sequence of steps,
 * each with a title / detail / optional screenshot) into a single standalone
 * ``.html`` file with an embedded vanilla-JS player. No server, no login, no
 * network: double-click the file and it replays offline anywhere.
 *
 * The shape mirrors the in-app workbench replay, which steps through
 * ``WorkBlock``s (terminal / browser / file / search / …) rather than a screen
 * recording — so a step is primarily text (command + output), with an optional
 * inlined screenshot when one exists. That makes the export faithful for coding
 * runs, not just computer-use ones.
 *
 * This is the privacy-friendly answer to "shareable replay link": the artifact
 * is a file the user downloads (and can inspect) before sending, so redaction
 * happens at export time and nothing leaks beyond the steps handed in. Pure +
 * deterministic — given the same ReplayData, the same bytes — so it is fully
 * unit-testable without a browser. The caller (see ``replay-from-blocks``) maps
 * its ``WorkBlock``s into ``ReplayData`` and inlines any remote screenshots as
 * data-URLs first; this module never fetches.
 */

import {
  stripInternalToolProtocol,
  stripLeakedRendererMarkup,
} from "@/core/messages/utils";
import { escapeXml } from "./share-card";

export interface ReplayStep {
  /** One-line headline for the step (e.g. the tool/title). */
  title: string;
  /** Short secondary line (e.g. the target path / url). */
  subtitle?: string;
  /** Longer detail shown in a monospace block (command, output preview). */
  body?: string;
  /** Block kind — drives the glyph. One of terminal/browser/file/read/search/todo/agent/skill/swarm. */
  kind?: string;
  /** Status — drives the colour dot. done/error/warning/running/waiting_approval/pending. */
  status?: string;
  /** Optional inlined screenshot as a data-URL. Remote URLs must be inlined by the caller. */
  image?: string;
}

/** A durable, human-readable completion receipt. It deliberately contains
 * only user-facing facts; raw tool payloads stay in the individual steps. */
export interface ReplayReceiptItem {
  title: string;
  status: string;
  detail?: string;
}

export interface ReplayReceipt {
  summary?: string;
  items?: ReplayReceiptItem[];
  verification?: string[];
}

export interface ReplayData {
  title: string;
  steps: ReplayStep[];
  /** Brand line. Defaults to "ECHO". */
  brand?: string;
  /** Footer note (e.g. a date). */
  footer?: string;
  /** Per-step dwell time in ms when playing. Default 1400. */
  frameMs?: number;
  /** Completed-case handoff, rendered above the replay rather than hidden in
   * the event list. This is optional so partial/live exports remain honest. */
  receipt?: ReplayReceipt;
  /** UI locale (e.g. "zh-CN"); the page chrome follows it. Default English. */
  locale?: string;
}

type ReplayStatusKey = "done" | "error" | "running" | "waiting_approval";

/** Static page chrome of the exported replay, per UI language. */
export interface ReplayHtmlLabels {
  lang: string;
  kind: string;
  statusAttention: string;
  statusReady: string;
  steps: (n: number) => string;
  completed: (n: number) => string;
  needsAttention: (n: number) => string;
  receiptEyebrow: string;
  receiptTitle: string;
  receiptNeedsReview: string;
  receiptReady: string;
  verifyEyebrow: string;
  empty: string;
  prev: string;
  play: string;
  pause: string;
  next: string;
  loop: string;
  loopTitle: string;
  speedTitle: string;
  hint: string;
  dockAttention: string;
  dockReady: string;
  dockCompleted: (done: number, total: number) => string;
  dockPlay: string;
  dockPause: string;
  untitledStep: string;
  status: Record<ReplayStatusKey, string>;
}

const REPLAY_LABELS: Record<"en" | "zh" | "ja" | "ko", ReplayHtmlLabels> = {
  en: {
    lang: "en",
    kind: "replay",
    statusAttention: "Needs attention",
    statusReady: "Replay ready",
    steps: (n) => `${n} steps`,
    completed: (n) => `${n} completed`,
    needsAttention: (n) => `${n} needs attention`,
    receiptEyebrow: "RESULT RECEIPT",
    receiptTitle: "What was delivered",
    receiptNeedsReview: "Needs review",
    receiptReady: "Ready to verify",
    verifyEyebrow: "VERIFY IN YOUR BROWSER",
    empty: "No steps in this replay.",
    prev: "⟨ Prev",
    play: "▶ Play",
    pause: "❚❚ Pause",
    next: "Next ⟩",
    loop: "⟲ Loop",
    loopTitle: "Loop playback",
    speedTitle: "Playback speed",
    hint: "← → step · Space play/pause · Home/End first/last",
    dockAttention: "Replay needs attention",
    dockReady: "Replay ready",
    dockCompleted: (done, total) => `${done}/${total} completed`,
    dockPlay: "▶ Play replay",
    dockPause: "❚❚ Pause replay",
    untitledStep: "(step)",
    status: {
      done: "done",
      error: "error",
      running: "running",
      waiting_approval: "awaiting approval",
    },
  },
  zh: {
    lang: "zh-CN",
    kind: "回放",
    statusAttention: "需要处理",
    statusReady: "回放就绪",
    steps: (n) => `${n} 步`,
    completed: (n) => `完成 ${n}`,
    needsAttention: (n) => `${n} 项需要处理`,
    receiptEyebrow: "交付回执",
    receiptTitle: "交付了什么",
    receiptNeedsReview: "需要复核",
    receiptReady: "可以验证",
    verifyEyebrow: "在浏览器中验证",
    empty: "这次回放没有步骤。",
    prev: "⟨ 上一步",
    play: "▶ 播放",
    pause: "❚❚ 暂停",
    next: "下一步 ⟩",
    loop: "⟲ 循环",
    loopTitle: "循环播放",
    speedTitle: "播放速度",
    hint: "← → 切换 · 空格 播放/暂停 · Home/End 首尾",
    dockAttention: "回放需要处理",
    dockReady: "回放就绪",
    dockCompleted: (done, total) => `已完成 ${done}/${total}`,
    dockPlay: "▶ 播放回放",
    dockPause: "❚❚ 暂停回放",
    untitledStep: "（步骤）",
    status: {
      done: "完成",
      error: "出错",
      running: "进行中",
      waiting_approval: "待审批",
    },
  },
  ja: {
    lang: "ja",
    kind: "リプレイ",
    statusAttention: "要対応",
    statusReady: "再生準備完了",
    steps: (n) => `${n} ステップ`,
    completed: (n) => `完了 ${n}`,
    needsAttention: (n) => `要対応 ${n}`,
    receiptEyebrow: "成果の記録",
    receiptTitle: "納品した内容",
    receiptNeedsReview: "要確認",
    receiptReady: "検証できます",
    verifyEyebrow: "ブラウザーで検証",
    empty: "このリプレイにはステップがありません。",
    prev: "⟨ 前へ",
    play: "▶ 再生",
    pause: "❚❚ 一時停止",
    next: "次へ ⟩",
    loop: "⟲ ループ",
    loopTitle: "ループ再生",
    speedTitle: "再生速度",
    hint: "← → 移動 · Space 再生/一時停止 · Home/End 最初/最後",
    dockAttention: "リプレイ要対応",
    dockReady: "リプレイ準備完了",
    dockCompleted: (done, total) => `完了 ${done}/${total}`,
    dockPlay: "▶ リプレイを再生",
    dockPause: "❚❚ リプレイを一時停止",
    untitledStep: "（ステップ）",
    status: {
      done: "完了",
      error: "エラー",
      running: "実行中",
      waiting_approval: "承認待ち",
    },
  },
  ko: {
    lang: "ko",
    kind: "리플레이",
    statusAttention: "확인 필요",
    statusReady: "리플레이 준비됨",
    steps: (n) => `${n}단계`,
    completed: (n) => `완료 ${n}`,
    needsAttention: (n) => `확인 필요 ${n}`,
    receiptEyebrow: "결과 기록",
    receiptTitle: "전달된 내용",
    receiptNeedsReview: "검토 필요",
    receiptReady: "검증 준비됨",
    verifyEyebrow: "브라우저에서 검증",
    empty: "이 리플레이에는 단계가 없습니다.",
    prev: "⟨ 이전",
    play: "▶ 재생",
    pause: "❚❚ 일시정지",
    next: "다음 ⟩",
    loop: "⟲ 반복",
    loopTitle: "반복 재생",
    speedTitle: "재생 속도",
    hint: "← → 이동 · Space 재생/일시정지 · Home/End 처음/끝",
    dockAttention: "리플레이 확인 필요",
    dockReady: "리플레이 준비됨",
    dockCompleted: (done, total) => `완료 ${done}/${total}`,
    dockPlay: "▶ 리플레이 재생",
    dockPause: "❚❚ 리플레이 일시정지",
    untitledStep: "(단계)",
    status: {
      done: "완료",
      error: "오류",
      running: "진행 중",
      waiting_approval: "승인 대기",
    },
  },
};

/** Labels for a UI locale ("zh-CN", "ja-JP"…); unknown locales get English. */
export function replayLabelsFor(locale: string | undefined): ReplayHtmlLabels {
  const language = (locale || "en").toLowerCase().split(/[-_]/)[0];
  return language === "zh" || language === "ja" || language === "ko"
    ? REPLAY_LABELS[language]
    : REPLAY_LABELS.en;
}

function isReplayStatusKey(value: string): value is ReplayStatusKey {
  return (
    value === "done" ||
    value === "error" ||
    value === "running" ||
    value === "waiting_approval"
  );
}

function statusLabel(L: ReplayHtmlLabels, status: string | undefined): string {
  const key = status || "done";
  return isReplayStatusKey(key) ? L.status[key] : key;
}

/**
 * Embed a JS value safely inside a ``<script>`` tag: JSON-encode, then break up
 * any ``</`` and ``<!--`` so hostile content can't close the script element or
 * open a comment early.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--");
}

const INTERNAL_REPLAY_BLOCK_RE =
  /`?<(?:(?:Reasoning|ToolCall|ToolResult|Thinking|Execution)Block)\b[^<>`]*>[\s\S]*?<\/(?:(?:Reasoning|ToolCall|ToolResult|Thinking|Execution)Block)>`?/g;
const RAW_REPLAY_TOOL_NAME_RE =
  /\b(?:read_file|exec_shell|shell_command|run_command|todo_write|apply_patch|write_file|edit_file|str_replace)\b/gi;
const REPLAY_SECRET_RE =
  /\b(?:sk|pk|rk|ghp|gho|ghs|ghu|xox[baprs])[-_][A-Za-z0-9]{8,}\b|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}|\b(?:Bearer|Authorization:?)\s+[A-Za-z0-9._-]{10,}|(["']?(?:api[_-]?key|secret|password|passwd|token)["']?\s*[:=]\s*)["']?[^\s"',}]{4,}/gi;

function cleanText(value: unknown): string {
  if (value == null) return "";
  const withoutInternalBlocks = String(value).replace(
    INTERNAL_REPLAY_BLOCK_RE,
    "",
  );
  return stripLeakedRendererMarkup(
    stripInternalToolProtocol(withoutInternalBlocks),
  )
    .replace(REPLAY_SECRET_RE, (_match, prefix?: string) =>
      prefix ? `${prefix}«redacted»` : "«redacted»",
    )
    .replace(RAW_REPLAY_TOOL_NAME_RE, "operation")
    .trim();
}

function cleanStep(step: ReplayStep): ReplayStep {
  return {
    title: cleanText(step.title),
    subtitle: cleanText(step.subtitle),
    body: cleanText(step.body),
    kind: cleanText(step.kind),
    status: cleanText(step.status),
    image: typeof step.image === "string" && step.image ? step.image : "",
  };
}

function cleanReceipt(
  receipt: ReplayReceipt | undefined,
): ReplayReceipt | undefined {
  if (!receipt) return undefined;
  const items = (receipt.items ?? [])
    .map((item) => ({
      title: cleanText(item.title),
      status: cleanText(item.status),
      detail: cleanText(item.detail),
    }))
    .filter((item) => item.title || item.detail);
  const verification = (receipt.verification ?? [])
    .map(cleanText)
    .filter(Boolean);
  const summary = cleanText(receipt.summary);
  return summary || items.length > 0 || verification.length > 0
    ? { summary, items, verification }
    : undefined;
}

export function buildReplayHtml(replay: ReplayData): string {
  const title = cleanText(replay.title || "ECHO AI replay") || "ECHO AI replay";
  const brand = cleanText(replay.brand || "ECHO") || "ECHO";
  const footer = cleanText(replay.footer || "");
  const frameMs = Number.isFinite(replay.frameMs)
    ? Math.max(200, replay.frameMs as number)
    : 1400;
  const steps = (replay.steps || [])
    .filter((s) => s && (s.title || s.body || s.image))
    .map(cleanStep);
  const doneCount = steps.filter((step) => step.status === "done").length;
  const attentionCount = steps.filter(
    (step) => step.status === "error" || step.status === "waiting_approval",
  ).length;
  const L = replayLabelsFor(replay.locale);
  const replayStatus = attentionCount > 0 ? L.statusAttention : L.statusReady;
  const receipt = cleanReceipt(replay.receipt);
  const receiptHtml = receipt
    ? `<section class="receipt" aria-label="${escapeXml(L.receiptEyebrow)}">
<div class="receipt-head"><div><div class="eyebrow">${escapeXml(L.receiptEyebrow)}</div><h2>${escapeXml(L.receiptTitle)}</h2></div><span class="receipt-status">${escapeXml(attentionCount > 0 ? L.receiptNeedsReview : L.receiptReady)}</span></div>
${receipt.summary ? `<p class="receipt-summary">${escapeXml(receipt.summary)}</p>` : ""}
${receipt.items && receipt.items.length > 0 ? `<div class="receipt-items">${receipt.items.map((item) => `<div class="receipt-item"><span class="receipt-dot ${escapeXml(item.status)}"></span><div><strong>${escapeXml(item.title)}</strong>${item.detail ? `<p>${escapeXml(item.detail)}</p>` : ""}</div><span class="receipt-item-status">${escapeXml(statusLabel(L, item.status))}</span></div>`).join("")}</div>` : ""}
${receipt.verification && receipt.verification.length > 0 ? `<div class="verification"><div class="eyebrow">${escapeXml(L.verifyEyebrow)}</div><ol>${receipt.verification.map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ol></div>` : ""}
</section>`
    : "";

  const stepData = embedJson(steps);
  const empty = steps.length === 0;

  // Every dynamic value (titles, bodies, captions) is written into the DOM via
  // textContent / img.src by the player — never innerHTML — so step content can
  // never inject markup. Only the static page chrome is XML-escaped here.
  return `<!doctype html>
<html lang="${L.lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeXml(title)} · ${escapeXml(brand)}</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
:root { --ink:#111317; --muted:#59616c; --line:#e6e9ed; --panel:#fff; --soft:#f4f5f7; --accent:#111317; }
body { margin:0; background:var(--soft); color:var(--ink); font:14px/1.5 Inter,"PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 24px 18px 92px; }
.mark { display:block; width:30px; height:30px; margin-bottom:12px; }
.brand { color:#59616c; font:600 12px/1.4 ui-monospace,"Cascadia Code",Consolas,monospace; letter-spacing:.14em; text-transform:uppercase; }
h1 { font-size:24px; line-height:1.25; margin:5px 0 10px; color:var(--ink); word-break:break-word; }
.meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px; color:var(--muted); font-size:12px; margin-bottom:18px; }
.meta .pill { border:1px solid var(--line); border-radius:999px; padding:3px 9px; background:#fff; }
.meta .status { color:#08788a; border-color:rgba(8,120,138,.28); background:rgba(8,120,138,.08); }
.meta .attention { color:#8a5600; border-color:rgba(138,86,0,.28); background:rgba(138,86,0,.08); }
.receipt { margin:0 0 18px; border:1px solid var(--line); border-radius:14px; padding:18px 20px; background:var(--panel); box-shadow:0 1px 2px rgba(17,19,23,.03); }
.receipt-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.eyebrow { color:#59616c; font-size:12px; font-weight:700; letter-spacing:.12em; }
.brand-kind { letter-spacing:0; text-transform:none; }
/* ECHO: Chinese, Japanese and Korean are never letter-spaced. */
html:lang(zh) .eyebrow, html:lang(ja) .eyebrow, html:lang(ko) .eyebrow { letter-spacing:0; }
.receipt h2 { margin:3px 0 0; font-size:16px; line-height:1.3; }
.receipt-status { flex:none; border-radius:999px; padding:3px 9px; background:rgba(8,120,138,.08); color:#08788a; font-size:11px; font-weight:600; }
.receipt-summary { margin:12px 0 0; color:#59616c; }
.receipt-items { margin-top:14px; border-top:1px solid #eef0f3; }
.receipt-item { display:flex; align-items:flex-start; gap:9px; padding:10px 0; border-bottom:1px solid #eef0f3; }
.receipt-item > div { min-width:0; flex:1; }
.receipt-item strong { font-size:13px; }
.receipt-item p { margin:2px 0 0; color:var(--muted); font-size:12px; }
.receipt-dot { width:8px; height:8px; margin-top:5px; border-radius:50%; background:#7d8590; }
.receipt-dot.done { background:#08788a; }.receipt-dot.running { background:#2f5db8; }.receipt-dot.error { background:#c42638; }.receipt-dot.waiting_approval { background:#8a5600; }
.receipt-item-status { flex:none; color:var(--muted); font-size:11px; text-transform:capitalize; }
.verification { margin-top:16px; padding:12px; border-radius:10px; background:#f8f9fa; }
.verification ol { margin:7px 0 0 18px; padding:0; color:#59616c; font-size:12px; }.verification li + li { margin-top:4px; }
.layout { display:grid; grid-template-columns: 330px 1fr; gap:18px; align-items:start; }
@media (max-width:760px){ .layout { grid-template-columns:1fr; } }
.steps { border:1px solid var(--line); border-radius:14px; overflow:hidden; max-height:64vh; overflow-y:auto; background:var(--panel); box-shadow:0 1px 2px rgba(17,19,23,.03); }
.row { display:flex; align-items:center; gap:9px; width:100%; padding:11px 12px; border:0; background:transparent; color:inherit; cursor:pointer; text-align:left; font:inherit; border-bottom:1px solid #eef0f3; }
.row:hover { background:#f8f9fa; }
.row.active { background:#eef0f3; }
.row .n { color:#7d8590; font-variant-numeric:tabular-nums; font-size:11px; min-width:24px; }
.row .glyph { width:18px; display:inline-grid; place-items:center; color:#59616c; }
.row .t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
.dot { width:7px; height:7px; border-radius:50%; flex:none; background:#7d8590; }
.detail { border:1px solid var(--line); border-radius:14px; padding:20px; background:var(--panel); min-height:230px; box-shadow:0 1px 2px rgba(17,19,23,.03); }
.detail .dtitle { font-size:18px; font-weight:650; color:var(--ink); word-break:break-word; }
.detail .dsub { color:var(--muted); font-size:12px; margin-top:3px; word-break:break-word; }
.detail img { max-width:100%; max-height:48vh; display:block; margin:14px 0; border-radius:10px; border:1px solid var(--line); }
.detail pre { white-space:pre-wrap; word-break:break-word; background:#f8f9fa; border:1px solid var(--line); border-radius:9px; padding:12px; font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; color:#2b3038; margin:14px 0 0; max-height:40vh; overflow:auto; }
.controls { display:flex; align-items:center; gap:8px; margin-top:14px; padding:10px 0 0; border-top:1px solid #eef0f3; position:sticky; bottom:0; background:linear-gradient(transparent,var(--soft) 22%); }
button { background:#fff; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:6px 11px; cursor:pointer; font:inherit; }
button:hover { background:#eef0f3; }
input[type=range] { flex:1; accent-color:#111317; }
.counter { color:var(--muted); font-variant-numeric:tabular-nums; min-width:52px; text-align:right; }
.hint { margin-top:8px; color:#7d8590; font-size:11px; }
button[aria-pressed="true"] { background:#111317; border-color:#111317; color:#fff; }
.dock { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); width:min(720px,calc(100% - 32px)); display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--line); border-radius:14px; background:rgba(255,255,255,.94); box-shadow:0 8px 30px rgba(17,19,23,.12); backdrop-filter:blur(12px); }
.dock .live { width:8px; height:8px; border-radius:50%; background:#08788a; }
.dock .dock-label { font-weight:600; font-size:12px; }
.dock .dock-meta { color:var(--muted); font-size:12px; }
.dock .spacer { flex:1; }
.empty { color:#59616c; padding:48px; text-align:center; }
footer { margin-top:20px; color:#7d8590; font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M50 17H24a7 7 0 0 0-7 7v16a7 7 0 0 0 7 7h26" fill="none" stroke="#111317" stroke-width="6"/><circle cx="38" cy="32" r="5" fill="#08788a"/></svg>
<div class="brand">${escapeXml(brand)} · <span class="brand-kind">${escapeXml(L.kind)}</span></div>
<h1>${escapeXml(title)}</h1>
<div class="meta">
<span class="pill ${attentionCount > 0 ? "attention" : "status"}">${escapeXml(replayStatus)}</span>
<span class="pill">${escapeXml(L.steps(steps.length))}</span>
<span class="pill">${escapeXml(L.completed(doneCount))}</span>
${attentionCount > 0 ? `<span class="pill attention">${escapeXml(L.needsAttention(attentionCount))}</span>` : ""}
</div>
${receiptHtml}
${
  empty
    ? `<div class="detail"><div class="empty">${escapeXml(L.empty)}</div></div>`
    : `<div class="layout">
<div class="steps" id="steps"></div>
<div>
<div class="detail">
<div class="dtitle" id="dtitle"></div>
<div class="dsub" id="dsub"></div>
<img id="dimg" alt="" hidden/>
<pre id="dbody" hidden></pre>
</div>
<div class="controls">
<button id="prev" type="button">${escapeXml(L.prev)}</button>
<button id="play" type="button">${escapeXml(L.play)}</button>
<button id="next" type="button">${escapeXml(L.next)}</button>
<button id="loop" type="button" aria-pressed="false" title="${escapeXml(L.loopTitle)}">${escapeXml(L.loop)}</button>
<button id="speed" type="button" title="${escapeXml(L.speedTitle)}">1×</button>
<input id="seek" type="range" min="0" value="0"/>
<span class="counter" id="counter"></span>
</div>
<div class="hint">${escapeXml(L.hint)}</div>
</div>
</div>`
}
${
  empty
    ? ""
    : `<div class="dock" role="status" aria-live="polite">
<span class="live"></span>
<span class="dock-label">${escapeXml(attentionCount > 0 ? L.dockAttention : L.dockReady)}</span>
<span class="dock-meta">${escapeXml(L.dockCompleted(doneCount, steps.length))}</span>
<span class="spacer"></span>
<button id="dock-play" type="button">${escapeXml(L.dockPlay)}</button>
</div>`
}
<footer>${escapeXml(footer)}</footer>
</div>
${
  empty
    ? ""
    : `<script>
(function(){
  var STEPS = ${stepData};
  var MS = ${frameMs};
  var LABEL = ${embedJson({
    play: L.play,
    pause: L.pause,
    dockPlay: L.dockPlay,
    dockPause: L.dockPause,
    untitledStep: L.untitledStep,
  })};
  // Line icons (lucide geometry), not emoji: ECHO chrome never uses emoji.
  var ICON = {
    terminal: ['m4 17 6-6-6-6', 'M12 19h8'],
    browser: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
    file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4'],
    read: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
    search: ['M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0', 'm21 21-4.3-4.3'],
    todo: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'm9 12 2 2 4-4'],
    agent: ['M12 8V4H8', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'],
    skill: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
    swarm: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75']
  };
  var SVGNS = 'http://www.w3.org/2000/svg';
  function glyph(kind){
    var paths = ICON[kind];
    if (!paths) return null;
    var svg = document.createElementNS(SVGNS, 'svg');
    var attrs = { viewBox:'0 0 24 24', width:'16', height:'16', fill:'none', stroke:'currentColor', 'stroke-width':'1.5', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true' };
    Object.keys(attrs).forEach(function(k){ svg.setAttribute(k, attrs[k]); });
    paths.forEach(function(d){ var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); svg.appendChild(p); });
    return svg;
  }
  var DOT = { done:'#08788a', error:'#c42638', running:'#2f5db8', waiting_approval:'#8a5600' };
  var i = 0, timer = null, loop = false, speedIdx = 1;
  var SPEEDS = [0.5, 1, 2];
  var stepsEl = document.getElementById('steps');
  var dtitle = document.getElementById('dtitle');
  var dsub = document.getElementById('dsub');
  var dimg = document.getElementById('dimg');
  var dbody = document.getElementById('dbody');
  var counter = document.getElementById('counter');
  var seek = document.getElementById('seek');
  var play = document.getElementById('play');
  var dockPlay = document.getElementById('dock-play');
  var loopBtn = document.getElementById('loop');
  var speedBtn = document.getElementById('speed');
  var rows = [];
  seek.max = String(STEPS.length - 1);
  STEPS.forEach(function(s, idx){
    var row = document.createElement('button');
    row.type = 'button'; row.className = 'row';
    var n = document.createElement('span'); n.className = 'n'; n.textContent = String(idx + 1);
    var g = document.createElement('span'); g.className = 'glyph';
    var icon = glyph(s.kind); if (icon) g.appendChild(icon); else g.textContent = '•';
    var t = document.createElement('span'); t.className = 't'; t.textContent = s.title || LABEL.untitledStep;
    var d = document.createElement('span'); d.className = 'dot'; d.style.background = DOT[s.status] || '#59616c';
    row.appendChild(n); row.appendChild(g); row.appendChild(t); row.appendChild(d);
    row.onclick = function(){ stop(); i = idx; render(); };
    stepsEl.appendChild(row); rows.push(row);
  });
  function render(){
    var s = STEPS[i] || {};
    rows.forEach(function(r, idx){ r.classList.toggle('active', idx === i); });
    if (rows[i]) rows[i].scrollIntoView({ block: 'nearest' });
    dtitle.textContent = s.title || '';
    dsub.textContent = s.subtitle || '';
    if (s.image){ dimg.src = s.image; dimg.hidden = false; } else { dimg.removeAttribute('src'); dimg.hidden = true; }
    if (s.body){ dbody.textContent = s.body; dbody.hidden = false; } else { dbody.textContent = ''; dbody.hidden = true; }
    counter.textContent = (i + 1) + ' / ' + STEPS.length;
    seek.value = String(i);
  }
  function stop(){ if (timer){ clearInterval(timer); timer = null; } play.textContent = LABEL.play; if (dockPlay) dockPlay.textContent = LABEL.dockPlay; }
  function tick(){
    if (i >= STEPS.length - 1){ if (loop){ i = 0; render(); return; } stop(); return; }
    i++; render();
  }
  function start(){
    if (i >= STEPS.length - 1 && !loop) i = 0;
    play.textContent = LABEL.pause;
    if (dockPlay) dockPlay.textContent = LABEL.dockPause;
    timer = setInterval(tick, Math.round(MS / SPEEDS[speedIdx]));
  }
  function go(n){ stop(); i = Math.max(0, Math.min(STEPS.length - 1, n)); render(); }
  play.onclick = function(){ timer ? stop() : start(); };
  if (dockPlay) dockPlay.onclick = function(){ timer ? stop() : start(); };
  loopBtn.onclick = function(){ loop = !loop; loopBtn.setAttribute('aria-pressed', loop ? 'true' : 'false'); };
  speedBtn.onclick = function(){
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    speedBtn.textContent = SPEEDS[speedIdx] + '×';
    if (timer){ clearInterval(timer); timer = setInterval(tick, Math.round(MS / SPEEDS[speedIdx])); }
  };
  document.getElementById('prev').onclick = function(){ go(i - 1); };
  document.getElementById('next').onclick = function(){ go(i + 1); };
  seek.oninput = function(){ go(Number(seek.value) || 0); };
  document.addEventListener('keydown', function(e){
    if (e.key === 'ArrowLeft'){ go(i - 1); }
    else if (e.key === 'ArrowRight'){ go(i + 1); }
    else if (e.key === 'Home'){ go(0); }
    else if (e.key === 'End'){ go(STEPS.length - 1); }
    else if (e.key === ' ' || e.key === 'Spacebar'){ e.preventDefault(); timer ? stop() : start(); }
  });
  render();
})();
</script>`
}
</body>
</html>`;
}
