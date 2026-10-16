import {
  BrainCircuitIcon,
  FileTextIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  type LucideIcon,
} from "lucide-react";

import type { Translations } from "@/core/i18n/locales/types";

import { isAgentLifecycleBlock } from "./agent-workbench-block-helpers";
import { canonicalToolName } from "./tool-name-groups";
import {
  workBlockLabelsFromShape,
  workBlockTitle,
  type WorkBlock,
} from "./work-blocks";

export type ObservedReferenceTabId = "files" | "web" | "memory" | "other";

export interface ObservedReferenceItem {
  path?: string;
  faviconUrl?: string;
  host?: string;
  id: string;
  thumbnailUrl?: string;
  title: string;
  subtitle?: string;
  tag?: string;
  url?: string;
}

export interface ObservedReferenceTab {
  id: ObservedReferenceTabId;
  label: string;
  items: ObservedReferenceItem[];
}

const OBSERVED_REFERENCE_TABS: ObservedReferenceTabId[] = [
  "files",
  "web",
  "memory",
];

export const OBSERVED_REFERENCE_META: Record<
  ObservedReferenceTabId,
  {
    Icon: LucideIcon;
    barClassName: string;
    dotClassName: string;
    iconClassName: string;
  }
> = {
  files: {
    Icon: FileTextIcon,
    barClassName: "bg-info",
    dotClassName: "bg-info",
    iconClassName: "text-info",
  },
  web: {
    Icon: GlobeIcon,
    barClassName: "bg-info",
    dotClassName: "bg-info",
    iconClassName: "text-info",
  },
  memory: {
    Icon: BrainCircuitIcon,
    barClassName: "bg-warning",
    dotClassName: "bg-warning",
    iconClassName: "text-warning",
  },
  other: {
    Icon: MoreHorizontalIcon,
    barClassName: "bg-muted-foreground/50",
    dotClassName: "bg-muted-foreground/50",
    iconClassName: "text-muted-foreground",
  },
};

export function buildObservedReferenceTabs(
  blocks: WorkBlock[],
  t: Translations,
): ObservedReferenceTab[] {
  const buckets: Record<ObservedReferenceTabId, ObservedReferenceItem[]> = {
    files: [],
    web: [],
    memory: [],
    other: [],
  };

  for (const block of blocks) {
    if (isAgentLifecycleBlock(block)) continue;
    // todo_write is execution progress and writes/edits/deletes are outputs
    // of this run; neither is an observed input or evidence source.
    if (block.kind === "todo" || block.kind === "file") continue;
    const tabId = referenceTabForBlock(block);
    buckets[tabId].push(...referenceItemsForBlock(block, t));
  }

  return OBSERVED_REFERENCE_TABS.map((id) => ({
    id,
    label: t.agentWorkbenchPages.reference[id],
    items: dedupeReferenceItems(buckets[id]).slice(0, 50),
  })).filter((tab) => tab.items.length > 0);
}

function referenceTabForBlock(block: WorkBlock): ObservedReferenceTabId {
  const signature = [
    block.event.name,
    block.title,
    block.subtitle,
    block.event.agentName,
    block.event.subAgentRole,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /(^|[_\s-])(memory|remember|recall|profile_memory|user_preferences)([_\s-]|$)/i.test(
      signature,
    )
  ) {
    return "memory";
  }
  if (block.kind === "file" || block.kind === "read") return "files";
  if (isLocalFileSearchBlock(block)) return "files";
  if (
    (block.kind === "search" || block.kind === "browser") &&
    hasHttpReference(block)
  ) {
    return "web";
  }
  return "other";
}

function referenceItemsForBlock(
  block: WorkBlock,
  t: Translations,
): ObservedReferenceItem[] {
  if (block.kind === "todo") return [];

  const blockTitle = workBlockTitle(
    block,
    workBlockLabelsFromShape(t.workBlocks),
  );
  if (block.kind === "file" || block.kind === "read") {
    const fileItems = fileReferenceItems(block, blockTitle);
    if (fileItems.length > 0) return fileItems;
  }
  if (isLocalFileSearchBlock(block)) {
    const fileItems = localFileSearchReferenceItems(block, blockTitle);
    if (fileItems.length > 0) return fileItems;
    // A pattern with no returned path is an attempted lookup, not confirmed
    // context. Do not inflate the evidence count with the query itself.
    return [];
  }
  if (block.kind === "search" || block.kind === "browser") {
    const webItems = webReferenceItems(block);
    if (webItems.length > 0) return webItems;
  }

  const target = referenceTarget(block);
  // No concrete target means no source; never fall back to the tool name.
  if (!target) return [];
  const detail =
    blockTitle !== target
      ? blockTitle
      : block.subtitle || compactReference(block.outputText, 96);
  return [
    {
      id: block.id,
      title: compactReference(target, 120),
      subtitle: detail ? compactReference(detail, 128) : undefined,
      tag: referenceStatusLabel(block.status, t),
    },
  ];
}

function isLocalFileSearchBlock(block: WorkBlock): boolean {
  if (block.kind !== "search" || hasHttpReference(block)) return false;
  return /(?:^|[_:\s-])(grep|glob|list|search)(?:_?(?:text|file|files|cwd|dir|directory))?(?:$|[_:\s-])/i.test(
    block.event.name,
  );
}

function localFileSearchReferenceItems(
  block: WorkBlock,
  blockTitle: string,
): ObservedReferenceItem[] {
  const paths = uniqueStrings([
    ...filePathsFromSearchOutput(block.event.output),
    ...filePathsFromSearchOutput(block.event.input?.output),
  ]);
  return paths.slice(0, 50).map((path, index) => {
    const name = basename(path);
    return {
      id: `${block.id}:local-search:${index}:${path}`,
      path,
      title: compactReference(name || path, 120),
      subtitle: path !== name ? compactReference(path, 140) : blockTitle,
      tag: fileKindLabel(path),
    };
  });
}

function filePathsFromSearchOutput(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      typeof entry === "string" && isConcreteLocalReference(entry)
        ? [entry.trim()]
        : filePathsFromSearchOutput(entry),
    );
  }
  if (isRecord(value)) {
    const direct = stringValuesFromInput(value, [
      "path",
      "file_path",
      "filepath",
      "filename",
    ]).filter(isConcreteLocalReference);
    return [
      ...direct,
      ...["results", "items", "files", "matches", "data"].flatMap((key) =>
        filePathsFromSearchOutput(value[key]),
      ),
    ];
  }
  if (typeof value !== "string" || !value.trim()) return [];

  const parsed = parsedJsonValuesFromText(value);
  // Never regex filenames out of arbitrary prose. CSS values, versions and
  // truncated words routinely resemble paths ("oklch(0.55", "globals.cs").
  // Legacy compatibility accepts JSON embedded in text; new runs use typed
  // workbench evidence and never enter this fallback.
  return parsed.flatMap(filePathsFromSearchOutput);
}

function isConcreteLocalReference(value: string): boolean {
  const path = value.trim();
  if (!path || path === "." || path === "./" || path === "../") return false;
  if (/[*?{}\[\]]/.test(path) || /^https?:\/\//i.test(path)) return false;
  return /[\\/]/.test(path) || /\.[A-Za-z0-9]{1,12}$/.test(path);
}

function fileReferenceItems(
  block: WorkBlock,
  blockTitle: string,
): ObservedReferenceItem[] {
  return uniqueStrings([
    ...changePaths(block.event.input),
    ...stringArrayFromInput(block.event.input, [
      "paths",
      "files",
      "file_paths",
    ]),
    ...stringValuesFromInput(block.event.input, [
      "path",
      "file_path",
      "filepath",
      "filename",
    ]),
    ...(block.event.filesTouched ?? []),
  ]).map((path, index) => {
    const name = basename(path);
    return {
      id: `${block.id}:file:${index}:${path}`,
      path,
      title: compactReference(name || path, 120),
      subtitle: path !== name ? compactReference(path, 140) : blockTitle,
      tag: fileKindLabel(path),
    };
  });
}

function webReferenceItems(block: WorkBlock): ObservedReferenceItem[] {
  const pages = dedupeWebPages([
    ...webPagesFromValue(block.event.output),
    ...webPagesFromValue(block.event.input?.output),
  ]).filter((page) => isHttpUrl(page.url));
  if (pages.length === 0) {
    const url = firstInputString(block.event.input, ["url"]);
    if (isHttpUrl(url)) {
      const host = hostLabel(url);
      return [
        {
          faviconUrl: faviconUrlForUrl(url),
          host,
          id: `${block.id}:url:${url}`,
          title: compactReference(pageTitleFromUrl(url), 120),
          subtitle: compactReference(url, 140),
          tag: host,
          url,
        },
      ];
    }
    return [];
  }

  return pages.slice(0, 8).map((page, index) => {
    const host = page.url ? hostLabel(page.url) : undefined;
    return {
      faviconUrl: page.url ? faviconUrlForUrl(page.url) : undefined,
      host,
      id: `${block.id}:web:${index}:${page.url || page.title}`,
      thumbnailUrl: page.thumbnailUrl,
      title: compactReference(page.title || pageTitleFromUrl(page.url), 120),
      subtitle: page.url
        ? compactReference(page.url, 140)
        : page.snippet
          ? compactReference(page.snippet, 140)
          : undefined,
      tag: host,
      url: page.url || undefined,
    };
  });
}

function hasHttpReference(block: WorkBlock): boolean {
  if (isHttpUrl(firstInputString(block.event.input, ["url"]))) return true;
  return dedupeWebPages([
    ...webPagesFromValue(block.event.output),
    ...webPagesFromValue(block.event.input?.output),
  ]).some((page) => isHttpUrl(page.url));
}

type WebReferencePage = {
  title: string;
  url: string;
  snippet?: string;
  thumbnailUrl?: string;
};

function webPagesFromValue(value: unknown): WebReferencePage[] {
  if (typeof value === "string") {
    return dedupeWebPages([
      ...parsedJsonValuesFromText(value).flatMap(webPagesFromValue),
      ...webPagesFromText(value),
    ]);
  }

  const candidates = resultRecordsFromValue(value);
  return candidates.flatMap((record) => {
    const url = firstInputString(record, ["url", "link", "href"]);
    const title =
      firstInputString(record, ["title", "name", "text"]) ||
      pageTitleFromUrl(url);
    const snippet = firstInputString(record, [
      "snippet",
      "description",
      "summary",
      "content",
    ]);
    const thumbnailUrl = firstInputString(record, [
      "thumbnail",
      "thumbnail_url",
      "thumbnailUrl",
      "image",
      "image_url",
      "imageUrl",
      "og_image",
      "ogImage",
      "previewUrl",
    ]);
    if (!isHttpUrl(url)) return [];
    return [
      {
        title: cleanWebText(title),
        url: cleanWebText(url),
        snippet: snippet ? cleanWebText(snippet) : undefined,
        thumbnailUrl: thumbnailUrl ? cleanWebText(thumbnailUrl) : undefined,
      },
    ];
  });
}

function resultRecordsFromValue(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  for (const key of ["results", "items", "pages", "documents", "data"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [value];
}

function parsedJsonValuesFromText(text: string): unknown[] {
  const trimmed = text.trim();
  const startIndexes = [trimmed.indexOf("{"), trimmed.indexOf("[")]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  const parsed: unknown[] = [];
  for (const start of startIndexes) {
    try {
      parsed.push(JSON.parse(trimmed.slice(start)));
      break;
    } catch {
      // Aggregated command output is sometimes truncated. Fall back to the
      // conservative title/url extractor below.
    }
  }
  return parsed;
}

function webPagesFromText(text: string): WebReferencePage[] {
  const pages: WebReferencePage[] = [];
  const patterns = [
    /"title"\s*:\s*"([^"]+)"[\s\S]{0,800}?"url"\s*:\s*"([^"\r\n}]*)/g,
    /'title'\s*:\s*'([^']+)'[\s\S]{0,800}?'url'\s*:\s*'([^'\r\n}]*)/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const title = cleanWebText(match[1] ?? "");
      const url = cleanWebText(match[2] ?? "");
      if (!isHttpUrl(url)) continue;
      pages.push({ title: title || pageTitleFromUrl(url), url });
    }
  }
  return pages;
}

function dedupeWebPages(pages: WebReferencePage[]): WebReferencePage[] {
  const seen = new Set<string>();
  const result: WebReferencePage[] = [];
  for (const page of pages) {
    const key = `${page.url || page.title}`.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(page);
  }
  return result;
}

function cleanWebText(text: string): string {
  return text
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function referenceTarget(block: WorkBlock): string {
  const input = block.event.input;
  const own = canonicalToolName(block.event.name);
  const notOwn = (value: string) =>
    canonicalToolName(value) === own ? "" : value;
  return (
    changePaths(input)[0] ||
    firstInputString(input, ["path", "file_path", "filepath", "filename"]) ||
    firstInputString(input, ["url"]) ||
    firstInputString(input, ["query", "pattern"]) ||
    notOwn(firstInputString(input, ["command", "cmd"])) ||
    notOwn(firstInputString(input, ["key", "name", "title"]))
  );
}

function stringValuesFromInput(
  input: Record<string, unknown> | undefined,
  keys: string[],
): string[] {
  if (!input) return [];
  return keys.flatMap((key) => {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return [value.trim()];
    if (typeof value === "number") return [String(value)];
    return [];
  });
}

function stringArrayFromInput(
  input: Record<string, unknown> | undefined,
  keys: string[],
): string[] {
  if (!input) return [];
  return keys.flatMap((key) => {
    const value = input[key];
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (typeof item === "string" && item.trim()) return [item.trim()];
      if (isRecord(item)) {
        return stringValuesFromInput(item, ["path", "file_path", "filepath"]);
      }
      return [];
    });
  });
}

function firstInputString(
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

function changePaths(input: Record<string, unknown> | undefined): string[] {
  const changes = input?.changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    if (!isRecord(change)) return [];
    const path = change.path;
    return typeof path === "string" && path.trim() ? [path.trim()] : [];
  });
}

export function dedupeReferenceItems(
  items: ObservedReferenceItem[],
): ObservedReferenceItem[] {
  const seen = new Set<string>();
  const result: ObservedReferenceItem[] = [];
  for (const item of items) {
    const pathLike = item.subtitle || item.url || item.title;
    const normalizedPath = pathLike
      .trim()
      .replace(/\\/g, "/")
      .replace(/:\d+(?::\d+)?$/, "")
      .replace(/^\.\//, "")
      .toLocaleLowerCase();
    // The compact list only displays the basename. Showing several visually
    // identical rows is not actionable; detailed paths remain available in
    // typed evidence and file/diff views.
    const key = item.tag
      ? `file:${item.title.trim().toLocaleLowerCase()}`
      : normalizedPath;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function referenceStatusLabel(
  status: WorkBlock["status"],
  t: Translations,
): string {
  if (status === "running") return t.agentWorkbenchPages.statusRunning;
  if (status === "waiting_approval")
    return t.agentWorkbenchPages.statusWaitingApproval;
  if (status === "warning") return "已恢复";
  if (status === "error") return t.agentWorkbenchPages.statusError;
  return t.agentWorkbenchPages.statusDone;
}

export function fileKindLabel(path: string): string | undefined {
  const name = basename(path);
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match?.[1]?.toUpperCase();
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function pageTitleFromUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function isHttpUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hostLabel(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function faviconUrlForUrl(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname;
    if (!hostname) return undefined;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
      hostname,
    )}&sz=64`;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

export function compactReference(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
