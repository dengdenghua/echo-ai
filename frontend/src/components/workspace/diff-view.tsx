import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { parseUnifiedDiff, type DiffRow } from "@/core/diff/unified-diff";

/**
 * Codex-style unified diff: gutter line numbers, a single marker column, and
 * tinted add/remove rows. Long lines scroll horizontally rather than wrapping —
 * a wrapped diff row loses its alignment with the gutter, which is the one
 * thing that makes a diff scannable.
 */
export function DiffView({
  diff,
  truncated = false,
  className,
  maxHeightClassName = "max-h-80",
}: {
  diff: string | null | undefined;
  truncated?: boolean;
  className?: string;
  maxHeightClassName?: string;
}) {
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff]);
  if (parsed.empty) return null;

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-border-default bg-card",
        className,
      )}
      data-testid="diff-view"
    >
      <div className={cn("overflow-auto", maxHeightClassName)}>
        <table className="w-full border-collapse font-mono text-xs leading-[1.55]">
          <tbody>
            {parsed.rows.map((row, index) => (
              <DiffLine key={index} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="border-t border-border-default bg-warning/10 px-2.5 py-1 text-xs text-warning">
          差异记录已截断，未显示完整内容
        </p>
      )}
    </div>
  );
}

const GUTTER_CELL =
  "w-[1%] min-w-[2.75rem] select-none border-r border-border-subtle px-2 text-right align-top text-muted-foreground tabular-nums";

function DiffLine({ row }: { row: DiffRow }) {
  if (row.kind === "hunk") {
    return (
      <tr className="bg-muted/40">
        <td colSpan={3} className="px-2.5 py-0.5 text-muted-foreground">
          {row.text}
        </td>
      </tr>
    );
  }

  const isAdd = row.kind === "add";
  const isDel = row.kind === "del";

  return (
    <tr
      className={cn(
        isAdd && "bg-success/10",
        isDel && "bg-destructive/10",
      )}
      data-diff-row={row.kind}
    >
      <td className={GUTTER_CELL}>{row.oldLine ?? ""}</td>
      <td className={GUTTER_CELL}>{row.newLine ?? ""}</td>
      <td
        className={cn(
          "whitespace-pre px-2.5 align-top",
          isAdd && "text-success",
          isDel && "text-destructive",
          !isAdd && !isDel && "text-foreground/80",
        )}
      >
        <span
          aria-hidden="true"
          className="mr-1.5 inline-block w-2 select-none text-muted-foreground"
        >
          {isAdd ? "+" : isDel ? "-" : " "}
        </span>
        {row.text || "\u00A0"}
      </td>
    </tr>
  );
}
