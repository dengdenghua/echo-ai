import { useRef, useState, useEffect, type HTMLAttributes } from "react";
import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyTextToClipboard } from "@/core/clipboard";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import { horizontalScrollKey } from "@/components/ui/horizontal-scroll-region";

export function serializeTable(rows: string[][], format: "markdown" | "csv") {
  if (format === "csv")
    return rows
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n");
  const escape = (cell: string) =>
    cell
      .replaceAll("\\", "\\\\")
      .replaceAll("|", "\\|")
      .replace(/\r?\n/g, "<br>");
  const lines = rows.map((row) => `| ${row.map(escape).join(" | ")} |`);
  if (rows.length)
    lines.splice(1, 0, `| ${rows[0]!.map(() => "---").join(" | ")} |`);
  return lines.join("\n");
}

/** Keep table controls outside the scroller and use the app's native/browser
 * clipboard fallback, so copying also works in embedded desktop browsers. */
export function MarkdownTable({
  children,
  className,
  node: _node,
  isStreaming = false,
  ...props
}: HTMLAttributes<HTMLTableElement> & {
  node?: unknown;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const tableLabel = t.common.tableContents;
  const ref = useRef<HTMLTableElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const rows = () =>
    Array.from(ref.current?.rows ?? []).map((row) =>
      Array.from(row.cells).map((cell) => {
        const clone = cell.cloneNode(true);
        if (!(clone instanceof HTMLElement))
          return cell.textContent?.trim() ?? "";
        clone
          .querySelectorAll<HTMLElement>("[data-file-reference]")
          .forEach((reference) =>
            reference.replaceWith(
              reference.dataset.fileReference ?? reference.textContent ?? "",
            ),
          );
        clone
          .querySelectorAll("br")
          .forEach((lineBreak) => lineBreak.replaceWith("\n"));
        return clone.innerText?.trim() ?? clone.textContent?.trim() ?? "";
      }),
    );
  const copy = async () => {
    try {
      await copyTextToClipboard(serializeTable(rows(), "markdown"));
      setStatus("copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("failed");
    }
  };
  const download = (format: "markdown" | "csv") => {
    const url = URL.createObjectURL(
      new Blob([serializeTable(rows(), format)], {
        type:
          format === "csv"
            ? "text/csv;charset=utf-8"
            : "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = format === "csv" ? "table.csv" : "table.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const label =
    status === "copied"
      ? t.clipboard.copiedToClipboard
      : status === "failed"
        ? t.clipboard.failedToCopyToClipboard
        : `${t.clipboard.copyToClipboard} (Markdown)`;
  return (
    <div
      data-streamdown="table-wrapper"
      className="flex min-w-0 max-w-full flex-col gap-1"
    >
      <div className="flex min-h-8 items-center justify-end gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          disabled={isStreaming}
          aria-label={label}
          title={label}
          onClick={() => void copy()}
        >
          {status === "copied" ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              disabled={isStreaming}
              aria-label={t.common.download}
              title={t.common.download}
            >
              <DownloadIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => download("csv")}>
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => download("markdown")}>
              Markdown
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="sr-only" role="status" aria-live="polite">
          {status !== "idle" ? label : ""}
        </span>
      </div>
      <div
        role="region"
        aria-label={tableLabel}
        tabIndex={0}
        className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="markdown-table-scroll"
        onKeyDown={horizontalScrollKey}
      >
        <table
          {...props}
          ref={ref}
          data-streamdown="table"
          className={cn("w-max min-w-full", className)}
        >
          {children}
        </table>
      </div>
    </div>
  );
}
