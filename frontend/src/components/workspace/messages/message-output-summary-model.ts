import {
  isAIMessage,
  isToolMessage,
  type Message,
  type ToolCall,
  type ToolMessage,
} from "@/core/api/types";
import type { FileHunk } from "@/core/realtime";
import { artifactDisplayPath } from "@/core/artifacts/utils";
import {
  stripInternalToolProtocol,
  stripLeakedRendererMarkup,
  stripUploadedFilesTag,
} from "@/core/messages/utils";
import { isObjectLike } from "@/core/utils/guards";
import { getFileName } from "@/core/utils/files";

import { isInternalWorkingFilePath } from "../agent-workbench-utils";

export type OutputArtifact = {
  path: string;
  title?: string | null;
  kind?: string | null;
};

export type OutputChange = {
  created: boolean;
  diff?: string;
  diffTruncated: boolean;
  path: string;
  op?: string | null;
  added: number;
  removed: number;
  hunks: FileHunk[];
};

export type VerificationEntry = {
  id: string;
  toolName: string;
  passed: boolean;
  detail?: string;
};

const VERIFICATION_DETAIL_SECRET_RE =
  /\b(?:sk|pk|rk|ghp|gho|ghs|ghu|xox[baprs])[-_][A-Za-z0-9]{8,}\b|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}|\b(?:Bearer|Authorization:?)\s+[A-Za-z0-9._-]{10,}|(["']?(?:api[_-]?key|secret|password|passwd|token)["']?\s*[:=]\s*)["']?[^\s"',}]{4,}/gi;
const VERIFICATION_RAW_TOOL_RE =
  /\b(?:read_file|exec_shell|shell_command|run_command|todo_write|apply_patch|write_file|edit_file|str_replace)\b/gi;
const VERIFICATION_PROTOCOL_PREFIX_RE =
  /^\s*(?:Thought|Action|Observation|Final Answer|Tool|Tool Result)\s*:\s*/gim;

function sanitizeVerificationText(value: string): string {
  return stripLeakedRendererMarkup(stripInternalToolProtocol(value), {
    trim: true,
  })
    .replace(VERIFICATION_DETAIL_SECRET_RE, (_match, prefix?: string) =>
      prefix ? `${prefix}«redacted»` : "«redacted»",
    )
    .replace(VERIFICATION_RAW_TOOL_RE, "operation")
    .replace(VERIFICATION_PROTOCOL_PREFIX_RE, "")
    .trim();
}

export type OutputSummary = {
  artifacts: OutputArtifact[];
  changes: OutputChange[];
  verifications: VerificationEntry[];
};

export type FailurePresentation = {
  message: string;
  detail: string;
  /** A later user turn completed successfully, so this is historical audit. */
  resolved?: boolean;
  kind:
    | "error"
    | "auth"
    | "capability"
    | "network"
    | "rate-limit"
    | "verification"
    | "verification-failed"
    | "guard"
    | "lifecycle"
    | "backpressure"
    | "environment"
    | "blocked";
  code?: string;
  eventId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return isObjectLike(value) ? value : null;
}

function diffCounts(diff: unknown): { added: number; removed: number } {
  if (typeof diff !== "string" || diff.length === 0) {
    return { added: 0, removed: 0 };
  }
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

function isCreatedFileChange(
  op: string | null,
  diff: unknown,
  counts: { added: number; removed: number },
) {
  const normalizedOp = op?.toLowerCase() ?? null;
  if (
    normalizedOp &&
    [
      "add",
      "added",
      "create",
      "created",
      "generate",
      "generated",
      "new",
    ].includes(normalizedOp)
  ) {
    return true;
  }
  if (typeof diff === "string") {
    return (
      /^---\s+\/dev\/null/m.test(diff) ||
      /^new file mode\b/m.test(diff) ||
      /^@@\s+-0,0\s+\+\d+(?:,\d+)?\s+@@/m.test(diff)
    );
  }
  return !normalizedOp && counts.added > 0 && counts.removed === 0;
}

export function isFinalOutputArtifactPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return (
    !isInternalWorkingFilePath(path) &&
    (normalized.includes("/output/final/") ||
      normalized.startsWith("output/final/"))
  );
}

export function changeDisplayPath(path: string): string {
  const displayPath = artifactDisplayPath(path);
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const isOutputPath =
    normalized.includes("/output/final/") ||
    normalized.startsWith("output/final/");
  return isOutputPath ? getFileName(displayPath) : displayPath;
}

function artifactFromToolCall(toolCall: ToolCall): OutputArtifact | null {
  if (toolCall.name !== "artifact") return null;
  const path = toolCall.args.path;
  if (typeof path !== "string" || !path.trim()) return null;
  return {
    path,
    title: typeof toolCall.args.title === "string" ? toolCall.args.title : null,
    kind: typeof toolCall.args.kind === "string" ? toolCall.args.kind : null,
  };
}

function hunksFromChange(change: Record<string, unknown>): FileHunk[] {
  if (!Array.isArray(change.hunks)) return [];
  const out: FileHunk[] = [];
  for (const raw of change.hunks) {
    const hunk = asRecord(raw);
    if (!hunk) continue;
    if (typeof hunk.id !== "string" || typeof hunk.body !== "string") continue;
    out.push({
      id: hunk.id,
      oldStart: typeof hunk.oldStart === "number" ? hunk.oldStart : 0,
      oldLines: typeof hunk.oldLines === "number" ? hunk.oldLines : 0,
      newStart: typeof hunk.newStart === "number" ? hunk.newStart : 0,
      newLines: typeof hunk.newLines === "number" ? hunk.newLines : 0,
      body: hunk.body,
      decision:
        hunk.decision === "accepted" || hunk.decision === "rejected"
          ? hunk.decision
          : "pending",
    });
  }
  return out;
}

function changesFromToolCall(toolCall: ToolCall): OutputChange[] {
  if (
    toolCall.name !== "file_change" ||
    !Array.isArray(toolCall.args.changes)
  ) {
    return [];
  }
  const out: OutputChange[] = [];
  for (const raw of toolCall.args.changes) {
    const change = asRecord(raw);
    if (!change) continue;
    const path = change?.path;
    if (typeof path !== "string" || !path.trim()) continue;
    const op = typeof change.op === "string" ? change.op : null;
    const counts = diffCounts(change.diff);
    out.push({
      created: isCreatedFileChange(op, change.diff, counts),
      diff: typeof change.diff === "string" ? change.diff : undefined,
      diffTruncated: change.diffTruncated === true,
      path,
      op,
      added: counts.added,
      removed: counts.removed,
      hunks: hunksFromChange(change),
    });
  }
  return out;
}

const VERIFICATION_TOOL_NAMES = new Set([
  "run_tests",
  "lint_check",
  "test",
  "verify",
  "build",
  "format_code",
]);

function isVerificationToolName(name: string): boolean {
  return (
    VERIFICATION_TOOL_NAMES.has(name) ||
    /^(?:verify|verification|check|test|lint|build)[_-]/i.test(name)
  );
}

function verificationFromToolMessage(
  toolMessage: ToolMessage,
  toolCallMap: Map<string, ToolCall>,
): VerificationEntry | null {
  const toolCall = toolCallMap.get(toolMessage.tool_call_id);
  if (!toolCall || !isVerificationToolName(toolCall.name)) return null;

  // Try to parse structured result from content
  const content =
    typeof toolMessage.content === "string"
      ? toolMessage.content
      : Array.isArray(toolMessage.content)
        ? toolMessage.content
            .map((c) => (typeof c === "string" ? c : ""))
            .join("")
        : "";

  let result: Record<string, unknown> | null = null;
  try {
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      result = JSON.parse(trimmed);
    } else {
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Not JSON; fall back to status field
  }

  const passed =
    toolMessage.status === "success" ||
    result?.success === true ||
    result?.exit_code === 0;

  const rawDetail =
    typeof result?.error === "string"
      ? result.error
      : typeof result?.stdout === "string"
        ? result.stdout.slice(0, 200)
        : "";
  const detail = rawDetail ? sanitizeVerificationText(rawDetail) : undefined;

  return {
    id: toolMessage.tool_call_id,
    toolName: toolCall.name,
    passed,
    detail,
  };
}

// Per-message extraction caches. Message objects are immutable and keep
// reference identity across streaming frames (realtime-adapter), so the
// expensive parsing (diff splitting, hunk extraction, JSON.parse of tool
// results) runs once per message instead of once per summarizeOutputs call.
// The merge/accumulate step stays in summarizeOutputs, keeping ordering and
// accumulation semantics identical.
type ToolCallOutputs = {
  toolCalls: ToolCall[];
  artifacts: OutputArtifact[];
  changes: Array<{ fingerprint: string; value: OutputChange }>;
};

const toolCallOutputsCache = new WeakMap<Message, ToolCallOutputs>();

function toolCallOutputsFromMessage(message: Message): ToolCallOutputs {
  const cached = toolCallOutputsCache.get(message);
  if (cached) return cached;
  const extracted: ToolCallOutputs = {
    toolCalls: [],
    artifacts: [],
    changes: [],
  };
  if (isAIMessage(message)) {
    for (const toolCall of message.tool_calls ?? []) {
      extracted.toolCalls.push(toolCall);
      const artifact = artifactFromToolCall(toolCall);
      if (artifact) extracted.artifacts.push(artifact);
      for (const change of changesFromToolCall(toolCall)) {
        // Reconnect/replay can deliver the same file_change event more than
        // once, sometimes under a reconstructed message id.  The diff itself
        // is the authoritative identity for this summary; counting it twice
        // turns a one-line edit into misleading totals such as +133/-0.
        extracted.changes.push({
          fingerprint: [
            change.path,
            change.op ?? "",
            change.diff ?? "",
            change.added,
            change.removed,
          ].join("\u0000"),
          value: change,
        });
      }
    }
  }
  toolCallOutputsCache.set(message, extracted);
  return extracted;
}

type VerificationCacheEntry = {
  toolCall: ToolCall | undefined;
  entry: VerificationEntry | null;
};

const verificationEntryCache = new WeakMap<Message, VerificationCacheEntry>();

function verificationFromToolMessageCached(
  toolMessage: ToolMessage,
  toolCallMap: Map<string, ToolCall>,
): VerificationEntry | null {
  const toolCall = toolCallMap.get(toolMessage.tool_call_id);
  const cached = verificationEntryCache.get(toolMessage);
  if (cached && cached.toolCall === toolCall) return cached.entry;
  const entry = verificationFromToolMessage(toolMessage, toolCallMap);
  verificationEntryCache.set(toolMessage, { toolCall, entry });
  return entry;
}

export function summarizeOutputs(messages: Message[]): OutputSummary {
  const artifacts = new Map<string, OutputArtifact>();
  const changes = new Map<string, OutputChange>();
  const seenChanges = new Set<string>();
  const verifications = new Map<string, VerificationEntry>();
  const toolCallMap = new Map<string, ToolCall>();

  // First pass: collect tool calls by id so we can join with ToolMessage results
  for (const message of messages) {
    const extracted = toolCallOutputsFromMessage(message);
    for (const toolCall of extracted.toolCalls) {
      if (toolCall.id) toolCallMap.set(toolCall.id, toolCall);
    }
    for (const artifact of extracted.artifacts) {
      artifacts.set(artifact.path, artifact);
    }
    for (const extractedChange of extracted.changes) {
      if (seenChanges.has(extractedChange.fingerprint)) continue;
      seenChanges.add(extractedChange.fingerprint);
      const change = extractedChange.value;
      const existing = changes.get(change.path);
      const seen = new Set(change.hunks.map((h) => h.id));
      const carried = (existing?.hunks ?? []).filter((h) => !seen.has(h.id));
      changes.set(change.path, {
        ...change,
        added: (existing?.added ?? 0) + change.added,
        created: Boolean(existing?.created || change.created),
        removed: (existing?.removed ?? 0) + change.removed,
        diffTruncated: Boolean(existing?.diffTruncated || change.diffTruncated),
        hunks: [...carried, ...change.hunks],
      });
    }
  }

  // Second pass: collect verification results from tool messages
  for (const message of messages) {
    if (!isToolMessage(message)) continue;
    const entry = verificationFromToolMessageCached(message, toolCallMap);
    if (entry) verifications.set(entry.id, entry);
  }

  return {
    artifacts: [...artifacts.values()],
    changes: [...changes.values()],
    verifications: [...verifications.values()],
  };
}

export function hasMessageOutputSummary(messages: Message[]): boolean {
  const summary = summarizeOutputs(messages);
  return (
    summary.artifacts.length > 0 ||
    summary.changes.length > 0 ||
    summary.verifications.length > 0
  );
}

function messageText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
  }
  return "";
}

/**
 * First human message text — used only to retry a failed task. Backend-injected
 * <uploaded_files> blocks are internal markup and must not leak into the
 * new prompt.
 */
function extractOriginalPrompt(messages: Message[]): string | null {
  for (const message of messages) {
    if (message.type !== "human") continue;
    const text = stripUploadedFilesTag(messageText(message.content)).trim();
    if (text) return text;
  }
  return null;
}

export function extractRetryPrompt(
  turnMessages: Message[],
  contextMessages: Message[],
): string | null {
  const turnPrompt = extractOriginalPrompt(turnMessages);
  // A punctuation-only nudge ("?", "？？", "...") carries no task intent.
  // Replaying it in a fresh task produces an empty-looking conversation and
  // loses the objective that was interrupted. Fall back to the first real
  // user prompt from the conversation in that case.
  if (turnPrompt && /[\p{L}\p{N}]/u.test(turnPrompt)) return turnPrompt;
  return extractOriginalPrompt(contextMessages) ?? turnPrompt;
}

// Cloudflare Pages deploys to <project>.pages.dev (no "cloudflare." label).
const DEPLOY_URL_PATTERN =
  /\bhttps?:\/\/(?:localhost:\d+|127\.0\.0\.1:\d+|(?:[a-z0-9-]+\.)+(?:vercel\.app|netlify\.app|onrender\.com|herokuapp\.com|pages\.dev|gitpod\.io|github\.io|preview\.app))\b[^\s)\]}>"'`，。；：！？、]*/i;

/**
 * Scans AI messages (latest first) for a URL that looks like a deployed
 * preview — used to surface a "结果链接" direct link in the receipt.
 */
export function extractResultUrl(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.type !== "ai") continue;
    const match = messageText(message.content).match(DEPLOY_URL_PATTERN);
    if (match) return match[0].replace(/[.,;:!?]+$/u, "");
  }
  return null;
}
