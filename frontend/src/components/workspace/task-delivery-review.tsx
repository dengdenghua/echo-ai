import { useContext, useMemo, useState } from "react";
import { ChevronRightIcon, FileDiffIcon } from "lucide-react";
import type { LiveToolEvent } from "./live-tool-timeline";
import { LinkedFileReference } from "./messages/linked-file-reference";
import { FileReferenceScope } from "@/core/navigation/file-reference";
import { quoteIntoTask } from "@/core/threads/task-interaction";
import { toolResources } from "@/core/automation/references";
import { parseUnifiedDiff } from "@/core/diff/unified-diff";
import { DiffView } from "./diff-view";
import { cn } from "@/lib/utils";

const DOC_EXT_RE = /\.(md|markdown|txt)$/i;

export function isDocumentationPath(path: string): boolean {
  return DOC_EXT_RE.test(path.trim());
}

export function createVirtualDiff(content: string): string {
  if (typeof content !== "string" || content.length === 0) {
    return "";
  }
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  const lines = normalized.split(/\r?\n/);
  return `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`;
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.charCodeAt(0) === 123) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
  }
  return null;
}

function extractContentFromInput(input: unknown): string | undefined {
  const rec = parseRecord(input);
  if (!rec) return undefined;
  if (typeof rec.content === "string") return rec.content;
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.code === "string") return rec.code;
  const args = parseRecord(rec.arguments);
  if (args) {
    if (typeof args.content === "string") return args.content;
    if (typeof args.text === "string") return args.text;
    if (typeof args.code === "string") return args.code;
  }
  return undefined;
}

function extractDiffFromEvent(event: LiveToolEvent): string | undefined {
  const out = parseRecord(event.output);
  if (out) {
    if (typeof out.diff === "string" && out.diff.trim()) return out.diff;
    if (typeof out.diff_preview === "string" && out.diff_preview.trim()) {
      return out.diff_preview;
    }
  }
  const inp = parseRecord(event.input);
  if (inp) {
    if (typeof inp.diff === "string" && inp.diff.trim()) return inp.diff;
    if (typeof inp.diff_preview === "string" && inp.diff_preview.trim()) {
      return inp.diff_preview;
    }
  }
  return undefined;
}

function isCreateOperation(
  operation: string,
  input: unknown,
  output: unknown,
): boolean {
  if (operation === "create_file") return true;
  const inp = parseRecord(input);
  if (inp) {
    if (
      inp.op === "create" ||
      inp.mode === "create" ||
      inp.is_new === true ||
      inp.create === true
    ) {
      return true;
    }
    const args = parseRecord(inp.arguments);
    if (
      args &&
      (args.op === "create" ||
        args.mode === "create" ||
        args.is_new === true ||
        args.create === true)
    ) {
      return true;
    }
  }
  const out = parseRecord(output);
  if (
    out &&
    (out.op === "create" || out.is_new === true || out.created === true)
  ) {
    return true;
  }
  return false;
}

export function deliveryEvidence(events: LiveToolEvent[]) {
  const changes: {
    id: string;
    path: string;
    op: string;
    diff?: string;
    truncated: boolean;
    status: string;
  }[] = [];
  const checks: {
    id: string;
    command: string;
    state: "passed" | "failed" | "unknown";
    summary: string;
  }[] = [];
  for (const event of events) {
    const operation = event.name.replace(/^mcp:/, "");
    if (
      [
        "write_file",
        "write_text_file",
        "create_file",
        "edit_code",
        "edit_text_file",
        "str_replace",
        "delete_file",
      ].includes(operation)
    ) {
      const isCreate = isCreateOperation(operation, event.input, event.output);
      let diff = extractDiffFromEvent(event);
      const content = extractContentFromInput(event.input);
      if (!diff && isCreate && content !== undefined) {
        diff = createVirtualDiff(content);
      }

      for (const ref of toolResources(event.input, event.input?.arguments)) {
        if (ref.kind !== "file") continue;
        changes.push({
          id: `${event.id}:${ref.path}`,
          path: ref.path,
          op:
            operation === "delete_file"
              ? "delete"
              : isCreate
                ? "create"
                : "update",
          diff,
          truncated: false,
          status: event.status,
        });
      }
    }
    if (event.name === "file_change" && Array.isArray(event.input?.changes)) {
      for (const [i, raw] of event.input.changes.entries()) {
        if (!raw || typeof raw !== "object" || typeof raw.path !== "string")
          continue;
        const op = String(raw.op ?? "update");
        let diff = typeof raw.diff === "string" ? raw.diff : undefined;
        if (
          !diff &&
          (op === "create" || raw.is_new === true) &&
          typeof raw.content === "string"
        ) {
          diff = createVirtualDiff(raw.content);
        }
        changes.push({
          id: `${event.id}:${i}`,
          path: raw.path,
          op,
          diff,
          truncated: raw.diffTruncated === true,
          status: event.status,
        });
      }
    }
    if (event.name.startsWith("verification:")) {
      const output = parseRecord(event.output) ?? {};
      checks.push({
        id: event.id,
        command: String(event.input?.command ?? "验证"),
        state:
          event.status === "error" ||
          (typeof output.exitCode === "number" && output.exitCode !== 0)
            ? "failed"
            : event.status === "done" && output.exitCode === 0
              ? "passed"
              : "unknown",
        summary: typeof output.summary === "string" ? output.summary : "",
      });
    }
  }
  return { changes, checks };
}

const OP_LABEL: Record<string, string> = {
  delete: "删除",
  create: "新增",
  update: "修改",
};

export function TaskDeliveryReview({
  events,
  running,
}: {
  events: LiveToolEvent[];
  running: boolean;
}) {
  const evidence = useMemo(() => deliveryEvidence(events), [events]);
  const scope = useContext(FileReferenceScope);
  // Per-file +/- counts come from the same parser the renderer uses, so the
  // header total can never disagree with the rows shown underneath.
  const counted = useMemo(
    () =>
      evidence.changes.map((change) => ({
        ...change,
        ...parseUnifiedDiff(change.diff),
      })),
    [evidence.changes],
  );
  const totals = useMemo(
    () =>
      counted.reduce(
        (acc, change) => ({
          added: acc.added + change.added,
          removed: acc.removed + change.removed,
        }),
        { added: 0, removed: 0 },
      ),
    [counted],
  );

  if (running || (!evidence.changes.length && !evidence.checks.length))
    return null;
  const failures = evidence.checks.filter((c) => c.state === "failed").length;
  const isDocOnly =
    evidence.changes.length > 0 &&
    evidence.changes.every((change) => isDocumentationPath(change.path));

  return (
    <section
      // Matches the conversation column exactly. max-w-3xl (768px) used to
      // overhang the 720px text column, so the receipt visibly stepped out of
      // the reading axis it belongs to.
      className="mx-auto mb-3 w-full max-w-(--conversation-column) min-w-0"
      aria-label="本轮交付"
    >
      <div className="min-w-0 overflow-hidden rounded-xl border border-border-default bg-muted/[0.12]">
        <div className="flex min-w-0 items-center gap-3 border-b border-border-default bg-muted/25 px-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-[var(--shadow-xs)]">
            <FileDiffIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground/90">
              本轮交付
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {evidence.changes.length} 个文件
              {evidence.checks.length > 0 && ` · ${evidence.checks.length} 项验证`}
              {failures > 0 && ` · ${failures} 项未通过`}
            </span>
          </span>
          {(totals.added > 0 || totals.removed > 0) && (
            <span
              className="shrink-0 font-mono text-xs"
              aria-label={`+${totals.added} -${totals.removed}`}
            >
              <span className="text-success">+{totals.added}</span>
              <span className="mx-1 text-muted-foreground/40"> </span>
              <span className="text-destructive">-{totals.removed}</span>
            </span>
          )}
        </div>

        <ul className="max-h-[28rem] divide-y divide-border-default overflow-y-auto">
          {counted.map((change) => (
            <ChangeEntry
              key={change.id}
              change={change}
              onQuote={() =>
                quoteIntoTask(
                  scope.threadId,
                  `文件：${change.path}\n本轮变更记录：${change.id}\n${change.diff?.slice(0, 6000) ?? "未提供差异"}`,
                )
              }
            />
          ))}

          {evidence.checks.map((check) => (
            <li key={check.id} className="px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 font-medium",
                    check.state === "passed" && "bg-success/15 text-success",
                    check.state === "failed" &&
                      "bg-destructive/15 text-destructive",
                    check.state === "unknown" &&
                      "bg-muted text-muted-foreground",
                  )}
                >
                  {check.state === "passed"
                    ? "通过"
                    : check.state === "failed"
                      ? "未通过"
                      : "结果未确认"}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-foreground/75">
                  {check.command}
                </code>
              </div>
              {check.summary && (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {check.summary}
                </p>
              )}
            </li>
          ))}
        </ul>

        {!evidence.checks.length && (
          <p
            className={cn(
              "border-t border-border-default px-3 py-2 text-xs",
              isDocOnly ? "text-muted-foreground" : "text-warning",
            )}
          >
            {isDocOnly
              ? "文档/分析类交付，无测试项"
              : "本轮未收到结构化验证记录，不能据此确认测试通过。"}
          </p>
        )}
      </div>
    </section>
  );
}

function ChangeEntry({
  change,
  onQuote,
}: {
  change: {
    path: string;
    op: string;
    diff?: string;
    truncated: boolean;
    status: string;
    added: number;
    removed: number;
    empty: boolean;
  };
  onQuote: () => void;
}) {
  const hasDiff = !change.empty;
  // A single file's diff is the point of this receipt, so it starts open.
  // The old UI hid every diff behind two nested <details>, which meant two
  // clicks before a reviewer could see what actually changed.
  const [open, setOpen] = useState(true);

  return (
    <li className="min-w-0 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        {hasDiff ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "收起" : "展开"} ${change.path} 的差异`}
            onClick={() => setOpen((prev) => !prev)}
            className="shrink-0 rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-90",
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" aria-hidden="true" />
        )}

        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
          {OP_LABEL[change.op] ?? change.op}
        </span>

        <span className="min-w-0 flex-1 truncate" title={change.path}>
          <LinkedFileReference path={change.path} />
        </span>

        {change.status !== "done" && (
          <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-warning">
            未确认完成
          </span>
        )}

        {hasDiff && (
          <span className="shrink-0 font-mono">
            <span className="text-success">+{change.added}</span>
            <span className="mx-1 text-muted-foreground/40"> </span>
            <span className="text-destructive">-{change.removed}</span>
          </span>
        )}

        <button
          type="button"
          onClick={onQuote}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          引用
        </button>
      </div>

      {hasDiff && open && (
        <div className="mt-1.5 pl-[1.375rem]">
          <DiffView diff={change.diff} truncated={change.truncated} />
        </div>
      )}

      {!hasDiff && (
        <p className="mt-1 pl-[1.375rem] text-xs text-muted-foreground">
          此操作未提供差异记录。
        </p>
      )}
    </li>
  );
}
