import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
} from "lucide-react";
import { useI18n } from "@/core/i18n/hooks";
import { executionStorageKey } from "@/core/execution-location";
import type { DiffEntry } from "./agent-workbench-utils";
import { cn } from "@/lib/utils";

export function diffLineCounts(text: string) {
  let added = 0,
    removed = 0,
    oldRemaining = 0,
    newRemaining = 0;
  for (const line of text.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldRemaining = Number(hunk[1] ?? 1);
      newRemaining = Number(hunk[2] ?? 1);
      continue;
    }
    if (oldRemaining <= 0 && newRemaining <= 0) continue;
    if (line.startsWith("+")) {
      added++;
      newRemaining--;
    } else if (line.startsWith("-")) {
      removed++;
      oldRemaining--;
    } else if (line.startsWith(" ")) {
      oldRemaining--;
      newRemaining--;
    }
  }
  return { added, removed };
}

function revision(entry: DiffEntry) {
  let hash = 2166136261;
  const content = `${entry.id}\0${entry.status}\0${entry.truncated}\0${entry.text}`;
  for (let index = 0; index < content.length; index++)
    hash = Math.imul(hash ^ content.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

export function DiffText({ text }: { text: string }) {
  return (
    <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-xs leading-5 text-foreground/80">
      {text.split(/\r?\n/).map((line, index) => (
        <span
          key={index}
          className={cn(
            "block min-h-5",
            line.startsWith("+") &&
              !line.startsWith("+++") &&
              "bg-success/10 text-success",
            line.startsWith("-") &&
              !line.startsWith("---") &&
              "bg-destructive/10 text-destructive",
            /^(diff --git|@@|---|\+\+\+)/.test(line) && "text-muted-foreground",
          )}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

export function AgentDiffPage({
  entries,
  historyEntries,
  threadId,
  onBackToSummary,
}: {
  entries: DiffEntry[];
  historyEntries?: DiffEntry[];
  threadId?: string;
  onBackToSummary?: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const scopeKey = threadId
    ? executionStorageKey(`echo:review-scope:${threadId}`)
    : null;
  const [scope, setScope] = useState<"turn" | "history">(() => {
    try {
      return scopeKey && sessionStorage.getItem(scopeKey) === "history"
        ? "history"
        : "turn";
    } catch {
      return "turn";
    }
  });
  useEffect(() => {
    if (!scopeKey) return;
    try {
      sessionStorage.setItem(scopeKey, scope);
    } catch {
      /* Scope switching remains available. */
    }
  }, [scope, scopeKey]);
  const [query, setQuery] = useState("");
  const storageKey = threadId
    ? executionStorageKey(`echo:review-viewed:${threadId}`)
    : null;
  const [viewed, setViewed] = useState<Record<string, string>>(() => {
    try {
      const saved: unknown = storageKey
        ? JSON.parse(sessionStorage.getItem(storageKey) ?? "{}")
        : {};
      if (!saved || typeof saved !== "object" || Array.isArray(saved))
        return {};
      return Object.fromEntries(
        Object.entries(saved).filter(([, value]) => typeof value === "string"),
      );
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(viewed));
    } catch {
      /* Reviewing still works without storage. */
    }
  }, [storageKey, viewed]);
  const source =
    scope === "history" && historyEntries ? historyEntries : entries;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? source.filter((entry) =>
          `${entry.path}\n${entry.title}`.toLocaleLowerCase().includes(needle),
        )
      : source;
  }, [query, source]);
  const totals = useMemo(
    () =>
      source.reduce(
        (counts, entry) => {
          const lines = diffLineCounts(entry.text);
          return {
            added: counts.added + lines.added,
            removed: counts.removed + lines.removed,
          };
        },
        { added: 0, removed: 0 },
      ),
    [source],
  );
  const reviewed = source.filter(
    (entry) => viewed[entry.path || entry.id] === revision(entry),
  ).length;
  return (
    <div
      data-testid="agent-diff-review"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background/70 p-3"
    >
      <div className="mx-auto w-full max-w-2xl space-y-3">
        {onBackToSummary ? (
          <button
            type="button"
            onClick={onBackToSummary}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60"
          >
            <ArrowLeftIcon className="size-3.5" />
            {zh ? "返回概览" : "Back to overview"}
          </button>
        ) : null}
        <div className="sticky top-0 z-10 space-y-2 rounded-xl border border-border/60 bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-lg bg-muted/60 p-0.5"
              aria-label={zh ? "审查范围" : "Review scope"}
            >
              <button
                type="button"
                aria-pressed={scope === "turn"}
                onClick={() => setScope("turn")}
                className={cn(
                  "rounded-md px-2 py-1 text-xs",
                  scope === "turn" && "bg-background shadow-sm",
                )}
              >
                {zh ? "本轮修改" : "Current turn"}
              </button>
              {historyEntries ? (
                <button
                  type="button"
                  aria-pressed={scope === "history"}
                  onClick={() => setScope("history")}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs",
                    scope === "history" && "bg-background shadow-sm",
                  )}
                >
                  {zh ? "会话记录" : "Conversation"}
                </button>
              ) : null}
            </div>
            <span className="ml-auto text-xs text-muted-foreground">
              {source.length} {zh ? "个文件" : "files"} · {reviewed}/
              {source.length} {zh ? "已查看" : "viewed"}
            </span>
            <span className="font-mono text-xs text-success">
              +{totals.added}
            </span>
            <span className="font-mono text-xs text-destructive">
              −{totals.removed}
            </span>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-border/70 px-2 py-1.5 text-muted-foreground">
            <SearchIcon className="size-3.5 shrink-0" />
            <input
              type="search"
              aria-label={zh ? "搜索改动文件" : "Search changed files"}
              placeholder={zh ? "搜索文件路径…" : "Search file paths…"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
            />
          </label>
          <p className="text-[11px] text-muted-foreground">
            {zh
              ? "来自任务的工具记录；会话范围展示每个文件最近一次记录。"
              : "Reported by task tools; conversation scope shows each file’s latest record."}
          </p>
        </div>
        {!visible.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query.trim()
              ? zh
                ? "没有匹配的文件"
                : "No matching files"
              : zh
                ? "此范围暂无改动记录"
                : "No changes recorded in this scope"}
          </p>
        ) : null}
        {visible.map((entry) => (
          <DiffReviewFile
            key={entry.path || entry.id}
            entry={entry}
            viewed={viewed[entry.path || entry.id] === revision(entry)}
            zh={zh}
            onViewed={(checked) =>
              setViewed((previous) => ({
                ...previous,
                [entry.path || entry.id]: checked ? revision(entry) : "",
              }))
            }
          />
        ))}
      </div>
    </div>
  );
}

function DiffReviewFile({
  entry,
  viewed,
  zh,
  onViewed,
}: {
  entry: DiffEntry;
  viewed: boolean;
  zh: boolean;
  onViewed: (checked: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const path = entry.path || entry.title;
  const lines = diffLineCounts(entry.text);
  return (
    <section className="overflow-hidden rounded-lg border border-border-default bg-background/85">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? (zh ? "展开" : "Expand") : zh ? "收起" : "Collapse"} ${path}`}
          onClick={() => setCollapsed((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3.5 shrink-0" />
          ) : (
            <ChevronDownIcon className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 break-all text-xs font-medium" title={path}>
            {path}
          </span>
        </button>
        <span className="shrink-0 font-mono text-[11px] text-success">
          +{lines.added}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-destructive">
          −{lines.removed}
        </span>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={viewed}
            onChange={(event) => onViewed(event.target.checked)}
            aria-label={`${zh ? "已查看" : "Viewed"} ${path}`}
            className="accent-primary"
          />
          {viewed ? <CheckIcon className="size-3" /> : null}
          {zh ? "已查看" : "Viewed"}
        </label>
      </div>
      {!collapsed ? (
        entry.text ? (
          <DiffText text={entry.text} />
        ) : (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {zh
              ? "工具未提供可预览的差异"
              : "The tool did not provide a diff preview"}
          </p>
        )
      ) : null}
      {entry.status === "error" ? (
        <p className="px-3 py-2 text-xs text-destructive">
          {zh
            ? "工具操作失败，请检查文件实际状态"
            : "The operation failed. Check the actual file state."}
        </p>
      ) : null}
      {entry.truncated ? (
        <p className="px-3 py-2 text-xs text-warning">
          {zh
            ? "差异已截断，行数仅统计已展示部分"
            : "Diff truncated; counts include only the displayed portion"}
        </p>
      ) : null}
    </section>
  );
}
