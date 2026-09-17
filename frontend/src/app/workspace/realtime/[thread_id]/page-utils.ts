import type { Message } from "@/core/api/types";
import { isAIMessage, isHumanMessage } from "@/core/api/types";
import { extractTextFromMessage } from "@/core/messages/utils";
import type { AgentModeName } from "@/components/workspace/mode-selector";
import type { useI18n } from "@/core/i18n/hooks";
import type { ResearchJob } from "@/core/research/api";
import type { ReasoningEffort } from "@/core/threads";
import { swallow } from "@/core/utils/log";
import { isAbsolutePath } from "@/lib/path-utils";

export function normalizeReasoningEffortForUi(
  effort: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  return effort === "max" ? "xhigh" : effort;
}

// Collect the most recent human message texts (newest first, capped at 5) for
// intent-based mode auto-switching. Index 0 is the latest message so the
// intent classifier's time weights apply correctly.
export function recentHumanMessageTexts(messages: Message[]): string[] {
  const texts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && texts.length < 5; i -= 1) {
    const message = messages[i];
    if (!message || !isHumanMessage(message)) continue;
    const text = extractTextFromMessage(message).trim();
    if (text) texts.push(text);
  }
  return texts;
}

export function modeLabelFor(
  mode: AgentModeName,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (mode === "audit") return t.modes.audit;
  if (mode === "uxui") return t.modes.uxui;
  return t.modes.develop;
}

const CHAT_WORKDIR_KEY = "chat:workdir:lastUsed";
const CODE_WORKDIR_KEY = "code:workdir:lastUsed";
const RECENT_WORKDIRS_KEY = "echo:recentWorkdirs";
const GROUP_PERSPECTIVE_KEY_PREFIX = "echo:group-perspective:";
const MAX_RECENT_WORKDIRS = 6;

export type ThreadRouteState = {
  threadOwnerAgentId?: string;
  workspacePath?: string;
  /** Navigation from a project entry requests the contextual project tab,
   * while ordinary thread navigation keeps the user's workbench preference. */
  openProjectWorkbench?: boolean;
  /** A project was just created with the explicit "invite people next"
   * choice. The destination consumes this once after its canonical room is
   * ready, then removes it from history state. */
  openHumanInviteAfterCreate?: boolean;
};

export function normalizeWorkDirKey(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function readGroupPerspective(threadId: string): string | null {
  if (typeof window === "undefined" || !threadId || threadId === "new") {
    return null;
  }
  try {
    return (
      window.localStorage
        .getItem(`${GROUP_PERSPECTIVE_KEY_PREFIX}${threadId}`)
        ?.trim() || null
    );
  } catch (error) {
    swallow(error, "read-group-perspective");
    return null;
  }
}

export function rememberGroupPerspective(threadId: string, agentId: string | null) {
  if (typeof window === "undefined" || !threadId || threadId === "new") {
    return;
  }
  try {
    const key = `${GROUP_PERSPECTIVE_KEY_PREFIX}${threadId}`;
    if (agentId) window.localStorage.setItem(key, agentId);
    else window.localStorage.removeItem(key);
  } catch (error) {
    swallow(error, "remember-group-perspective");
  }
}

/** Keep role folders readable while preventing display names from escaping the root. */
export function personalRoleFolderName(
  agent: { name?: string; display_name?: string | null } | null,
  fallback: string,
): string {
  const raw =
    agent?.display_name?.trim() ||
    agent?.name?.trim() ||
    fallback.trim() ||
    "角色";
  const safe = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return safe || "角色";
}

export function rememberChatWorkDir(dir: string) {
  if (typeof window === "undefined") return;
  try {
    if (!dir || !isAbsolutePath(dir)) {
      window.localStorage.removeItem(CHAT_WORKDIR_KEY);
      return;
    }
    window.localStorage.setItem(CHAT_WORKDIR_KEY, dir);
    window.localStorage.setItem(CODE_WORKDIR_KEY, dir);

    const raw = window.localStorage.getItem(RECENT_WORKDIRS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const current = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
    const next = [
      dir,
      ...current.filter(
        (item) => normalizeWorkDirKey(item) !== normalizeWorkDirKey(dir),
      ),
    ].slice(0, MAX_RECENT_WORKDIRS);
    window.localStorage.setItem(RECENT_WORKDIRS_KEY, JSON.stringify(next));
  } catch (e) {
    swallow(e, "storage");
  }
}

export function readRememberedChatWorkDir(): string {
  if (typeof window === "undefined") return "";
  try {
    const remembered =
      window.localStorage.getItem(CHAT_WORKDIR_KEY)?.trim() ?? "";
    return isAbsolutePath(remembered) ? remembered : "";
  } catch (e) {
    swallow(e, "storage");
    return "";
  }
}

export type CompactResult = {
  compacted: boolean;
  reason?: string;
  turnCount?: number;
  keepRecent?: number;
};

export type CompactableThread = {
  compact?: () => Promise<CompactResult>;
};

const URL_PATTERN = /https?:\/\/[^\s，,]+/gi;

export function extractResearchUrls(text: string): { topic: string; urls: string[] } {
  const urls = Array.from(new Set(text.match(URL_PATTERN) ?? []));
  const topic = text.replace(URL_PATTERN, " ").replace(/\s+/g, " ").trim();
  return { topic: topic || text.trim(), urls };
}

export function latestModelContextTokens(messages: Message[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || !isAIMessage(message)) continue;
    const usage = message.usage_metadata;
    if (!usage) continue;
    const input = Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0;
    const output = Number.isFinite(usage.output_tokens)
      ? usage.output_tokens
      : 0;
    const total = Number.isFinite(usage.total_tokens)
      ? usage.total_tokens
      : input + output;
    return Math.max(0, total);
  }
  return null;
}

// Text extraction is the expensive part of the estimate and the realtime
// adapter keeps Message identity stable for unchanged items, so cache the
// per-message text length by reference: during streaming only the message
// objects a delta actually rebuilt get re-extracted.
const messageTextLengthCache = new WeakMap<Message, number>();

function retainedMessageTextLength(message: Message): number {
  const cached = messageTextLengthCache.get(message);
  if (cached !== undefined) return cached;
  const length = extractTextFromMessage(message).length;
  messageTextLengthCache.set(message, length);
  return length;
}

function estimateRetainedContextTokens(messages: Message[]): number {
  const chars = messages.reduce(
    (total, message) => total + retainedMessageTextLength(message),
    0,
  );
  return Math.ceil(chars / 4);
}

export function estimateCurrentContextTokens(messages: Message[]): number {
  const latestUsage = latestModelContextTokens(messages);
  const retainedEstimate = estimateRetainedContextTokens(messages);
  return Math.max(latestUsage ?? 0, retainedEstimate);
}

export function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function threadOwnerAgentFromMetadata(
  metadata?: Record<string, unknown> | null,
  values?: Record<string, unknown> | null,
): string {
  return firstString(
    metadata?.agent,
    metadata?.agent_name,
    metadata?.agent_id,
    metadata?.lead_agent_name,
    metadata?.current_agent,
    values?.current_speaker,
    values?.agent_name,
  );
}

export function latestArtifactFocusPathFromEvents(
  events: Array<{ input?: unknown }>,
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const input = recordFromUnknown(events[index]?.input);
    const focus = recordFromUnknown(input?.workspaceFocus);
    const view = focus?.view;
    if (view !== "artifact" && view !== "image") continue;
    const path = input?.path;
    if (typeof path === "string" && path.trim().length > 0) return path;
  }
  return null;
}

export interface ThreadResearchViewState {
  threadId: string;
  job: ResearchJob | null;
  loading: boolean;
  error: string | null;
  visible: boolean;
}

export function emptyThreadResearchViewState(
  threadId: string,
): ThreadResearchViewState {
  return {
    threadId,
    job: null,
    loading: false,
    error: null,
    visible: false,
  };
}
