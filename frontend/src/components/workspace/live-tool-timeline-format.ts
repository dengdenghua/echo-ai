import { isRecord } from "@/core/utils/guards";
import { swallow } from "@/core/utils/log";

import type { LiveToolEvent } from "./live-tool-timeline-types";
import { stripToolEnvelope } from "./messages/trace-labels";

const SENSITIVE_DETAIL_KEY_RE =
  /^(?:token|secret|api[_-]?key|password|passwd|authorization|cookie|set-cookie|private[_-]?key)$/i;
const SENSITIVE_DETAIL_TEXT_RE =
  /(?:bearer\s+|\bsk-[a-z0-9_-]+\b|\b(?:ghp|github_pat|xox[baprs])-)[^\s,;)}\]]+/gi;

function sanitizePublicDetailText(value: string): string {
  return value
    .replace(SENSITIVE_DETAIL_TEXT_RE, "[redacted]")
    .replace(
      /((?:^|[\s,{[])['\"]?(?:token|secret|api[_-]?key|password|passwd|authorization|cookie|set-cookie|private[_-]?key)['\"]?\s*[:=]\s*)([^,;}\]\n]+)/gi,
      "$1[redacted]",
    );
}

function sanitizePublicDetailValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[redacted]";
  if (typeof value === "string") return sanitizePublicDetailText(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePublicDetailValue(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_DETAIL_KEY_RE.test(key)
          ? "[redacted]"
          : sanitizePublicDetailValue(item, depth + 1),
      ]),
    );
  }
  return value;
}

export function formatInputSummary(
  input?: Record<string, unknown>,
): string | undefined {
  if (!input) return undefined;
  const priority = [
    "command",
    "path",
    "file_path",
    "cwd",
    "pattern",
    "url",
    "query",
    "task",
    "prompt",
    "description",
  ] as const;
  for (const key of priority) {
    const v = input[key];
    if (v !== undefined && v !== null && `${v}`.trim() !== "") {
      const text = typeof v === "string" ? v : JSON.stringify(v);
      const normalized = text.replace(/\s+/g, " ").trim();
      return normalized.length > 120
        ? `${normalized.slice(0, 120)}…`
        : normalized;
    }
  }
  const entries = Object.entries(input).filter(
    ([, v]) => v !== undefined && v !== null,
  );
  if (entries.length === 0) return undefined;
  return entries
    .slice(0, 2)
    .map(([k, v]) => {
      const text = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${text.length > 60 ? text.slice(0, 60) + "…" : text}`;
    })
    .join(" · ");
}

export function formatOutputSummary(output: unknown): string | undefined {
  if (output === undefined || output === null) return undefined;
  if (typeof output === "string") {
    const normalized = stripToolEnvelope(output).replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > 140
      ? `${normalized.slice(0, 140)}…`
      : normalized;
  }
  if (isRecord(output)) {
    const record = output;
    for (const key of [
      "error",
      "stderr",
      "stdout",
      "result",
      "message",
      "path",
      "content",
    ]) {
      const v = record[key];
      if (v !== undefined && v !== null && `${v}`.trim() !== "") {
        const text = typeof v === "string" ? v : JSON.stringify(v);
        const normalized = text.replace(/\s+/g, " ").trim();
        return `${key}: ${normalized.length > 120 ? normalized.slice(0, 120) + "…" : normalized}`;
      }
    }
  }
  const text = JSON.stringify(output);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

export function formatDetailBlock(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const sanitized = sanitizePublicDetailValue(value);
  const text =
    typeof sanitized === "string"
      ? sanitized
      : JSON.stringify(sanitized, null, 2);
  const normalized = text.trim();
  if (!normalized) return undefined;
  return normalized.length > 4000
    ? `${normalized.slice(0, 4000)}\n...`
    : normalized;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    swallow(e);
    return value;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  const parsed = parseMaybeJson(value);
  if (isRecord(parsed)) {
    return parsed;
  }
  return null;
}

export function countItems(value: unknown, keys: string[]): number | null {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed.length;
  const record = asRecord(parsed);
  if (!record) return null;
  for (const key of keys) {
    const item = record[key];
    if (Array.isArray(item)) return item.length;
    const nested = asRecord(item);
    if (nested) {
      const nestedCount = countItems(nested, keys);
      if (nestedCount !== null) return nestedCount;
    }
  }
  return null;
}

export interface SearchResultItem {
  title: string;
  url?: string;
}

export function extractSearchResults(
  value: unknown,
  max = 8,
): SearchResultItem[] {
  const parsed = parseMaybeJson(value);
  const list = Array.isArray(parsed)
    ? parsed
    : (() => {
        const record = asRecord(parsed);
        if (!record) return [];
        for (const key of ["results", "items", "sources", "urls", "pages"]) {
          const candidate = record[key];
          if (Array.isArray(candidate)) return candidate;
        }
        return [record];
      })();
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const title =
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : typeof record.text === "string" && record.text.trim()
            ? record.text.trim()
            : "";
    const url =
      typeof record.url === "string" && record.url.trim()
        ? record.url.trim()
        : typeof record.link === "string" && record.link.trim()
          ? record.link.trim()
          : "";
    const label = title || url;
    if (!label) continue;
    const key = url || label;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ title: compactMiddle(label, 96), url: url || undefined });
    if (results.length >= max) break;
  }
  return results;
}

export function extractSourceLabels(value: unknown, max = 4): string[] {
  const parsed = parseMaybeJson(value);
  const out: string[] = [];
  const visit = (item: unknown) => {
    if (out.length >= max) return;
    const record = asRecord(item);
    if (!record) return;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const url =
      typeof record.url === "string"
        ? record.url.trim()
        : typeof record.link === "string"
          ? record.link.trim()
          : "";
    if (url) {
      try {
        out.push(new URL(url).hostname.replace(/^www\./, ""));
        return;
      } catch (e) {
        swallow(e);
        out.push(url.slice(0, 32));
        return;
      }
    }
    if (title) out.push(title.slice(0, 32));
  };
  if (Array.isArray(parsed)) {
    parsed.forEach(visit);
    return out;
  }
  const record = asRecord(parsed);
  if (!record) return out;
  for (const key of ["results", "items", "sources", "urls", "pages"]) {
    const list = record[key];
    if (Array.isArray(list)) {
      list.forEach(visit);
      if (out.length > 0) return out;
    }
  }
  visit(record);
  return out;
}

export function stringInput(
  input: Record<string, unknown> | undefined,
  keys: string[],
): string {
  if (!input) return "";
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

export function compactMiddle(text: string, max = 96): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const head = Math.floor((max - 1) * 0.62);
  const tail = max - 1 - head;
  return `${clean.slice(0, head)}…${clean.slice(-tail)}`;
}

export function actionStatusLabel(
  event: LiveToolEvent,
  verb: (running: boolean) => string,
  target?: string,
): string {
  const label = verb(event.status === "running");
  return target ? `${label} ${target}` : label;
}

function elapsedInputMs(input?: Record<string, unknown>): number | undefined {
  const value = input?.elapsed_ms ?? input?.elapsedMs;
  if (typeof value === "number" && Number.isFinite(value))
    return Math.max(0, value);
  if (
    typeof value === "string" &&
    value.trim() &&
    !Number.isNaN(Number(value))
  ) {
    return Math.max(0, Number(value));
  }
  return undefined;
}

export function elapsedSeconds(input?: Record<string, unknown>): number {
  return Math.max(0, Math.floor((elapsedInputMs(input) ?? 0) / 1000));
}

const CONTENT_PREVIEW_KEYS = [
  "content",
  "text",
  "code",
  "body",
  "patch",
  "diff",
] as const;

function normalizePreviewText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lines = trimmed.split(/\r?\n/);
  const preview = lines.slice(0, 8).join("\n");
  const tooLong = lines.length > 8 || preview.length > 900;
  return `${preview.slice(0, 900)}${tooLong ? "\n..." : ""}`;
}

function getContentPreviewFromRecord(
  record?: Record<string, unknown>,
): string | undefined {
  if (!record) return undefined;
  for (const key of CONTENT_PREVIEW_KEYS) {
    const preview = normalizePreviewText(record[key]);
    if (preview) return preview;
  }
  return undefined;
}

export function getContentPreview(event: LiveToolEvent): string | undefined {
  const inputPreview = getContentPreviewFromRecord(event.input);
  if (inputPreview) return inputPreview;
  if (isRecord(event.output)) {
    return getContentPreviewFromRecord(event.output);
  }
  return undefined;
}
