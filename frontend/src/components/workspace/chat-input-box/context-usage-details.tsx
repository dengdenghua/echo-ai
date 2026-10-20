/**
 * How full the model context is: the total, a bar split by what fills it
 * (messages, system prompt, tools, skills, memory …) and the space left.
 * Shared by the composer's context meter and the header status menu's 上下文
 * section, whose heading carries the total instead.
 */
import { useState } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export interface ContextWindowSegment {
  label: string;
  tokens: number;
  color: string;
}

export function compactTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1))}K`;
  }
  return value.toLocaleString();
}

export function contextUsage(contextTokens: number, maxContextTokens: number) {
  const progress =
    maxContextTokens > 0 && contextTokens > 0
      ? Math.min(contextTokens / maxContextTokens, 1)
      : 0;
  const percentage = Math.round(progress * 100);
  return {
    progress,
    percentage,
    remainingTokens: Math.max(0, maxContextTokens - contextTokens),
    summary: `${compactTokenCount(contextTokens)} / ${compactTokenCount(
      maxContextTokens,
    )} (${percentage}%)`,
  };
}

/** The meter tint: calm until the window fills up. */
export function ringColorClass(progress: number): string {
  if (progress >= 0.95) return "text-destructive";
  if (progress >= 0.8) return "text-warning";
  if (progress >= 0.5) return "text-primary";
  return "text-muted-foreground";
}

/**
 * A horizontal context meter in the current text colour.
 *
 * A ring was the wrong shape here: at a near-empty window the round line cap
 * rendered as a lone dark dot floating on the track, and a 30px circle is too
 * small to read a fill level from at all. The horizontal bar is what other
 * agent clients ship (a bar plus a percentage next to it), reads at a glance
 * in a narrow header button, and shows nothing but a clean track at 0%.
 */
export function ContextMeter({
  progress,
  compressing = false,
  className,
  trackClassName = "opacity-20",
}: {
  progress: number;
  compressing?: boolean;
  className?: string;
  /** A header button needs a firmer track to read as a control at 0%. */
  trackClassName?: string;
}) {
  const percent = Math.min(Math.max(progress, 0), 1) * 100;
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block h-1 w-6 overflow-hidden rounded-full bg-current align-middle",
        trackClassName,
        className,
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-full bg-current transition-[width] duration-slow",
          compressing && "animate-pulse",
        )}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

/**
 * The header's session-status mark: two rows of ring + line, the shape other
 * agent clients use for a "details of this run" affordance (a bulleted list,
 * not a dial). Drawn here rather than pulled from lucide because no icon in
 * the set is a ring paired with a rule — the nearest neighbours are
 * `list-todo`/`list-checks`, whose boxes or ticks read as task state, and
 * `list`, whose bullets are dots rather than rings.
 *
 * Deliberately static: the level lives in the tooltip and the popover, and a
 * glyph that grew and shrank with the window was the thing being replaced.
 */
export function SessionStatusGlyph({
  className,
  strokeWidth = 1.75,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={cn("size-4 shrink-0", className)}
    >
      <circle cx="4.5" cy="8" r="2" />
      <path d="M9.5 8h11" />
      <circle cx="4.5" cy="16" r="2" />
      <path d="M9.5 16h11" />
    </svg>
  );
}

/** Share of the window a segment or the free space takes. */
function share(tokens: number, maxContextTokens: number): string {
  return maxContextTokens > 0
    ? ` (${Math.round((tokens / maxContextTokens) * 1000) / 10}%)`
    : "";
}

export function ContextUsageDetails({
  contextTokens,
  maxContextTokens,
  segments,
  showHeader = true,
}: {
  contextTokens: number;
  maxContextTokens: number;
  segments: ContextWindowSegment[];
  /** The title and total row; off where the caller's heading shows them. */
  showHeader?: boolean;
}) {
  const { t } = useI18n();
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const { percentage, remainingTokens, summary } = contextUsage(
    contextTokens,
    maxContextTokens,
  );
  const freeLabel = t.contextWindow.freeSpace ?? "Free space";
  return (
    <>
      {showHeader ? (
        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">
            {t.contextWindow.title}
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {summary}
          </span>
        </div>
      ) : null}
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted/80 p-0.5">
        {segments.length > 0 ? (
          segments.map((segment) => {
            const segPct =
              maxContextTokens > 0
                ? (segment.tokens / maxContextTokens) * 100
                : 0;
            if (segPct <= 0) return null;
            const isHovered = hoveredLabel === segment.label;
            return (
              <div
                key={segment.label}
                className={cn(
                  "h-full rounded-full transition-all duration-200",
                  segment.color,
                  hoveredLabel && !isHovered
                    ? "scale-y-90 opacity-35"
                    : "opacity-100",
                  isHovered &&
                    "scale-y-110 shadow-xs ring-1 ring-foreground/40",
                )}
                // No minimum width: a floor of a fraction of a percent put a
                // lone 2px speck on the track for a segment holding a handful
                // of tokens, which read as a rendering smudge rather than a
                // share. The per-segment rows below carry the exact counts, so
                // a sliver that rounds away loses nothing.
                style={{ width: `${segPct}%` }}
                title={`${segment.label}: ${compactTokenCount(segment.tokens)}${share(segment.tokens, maxContextTokens)}`}
              />
            );
          })
        ) : (
          <div
            className="h-full rounded-full bg-foreground/25 transition-[width]"
            style={{ width: `${percentage}%` }}
          />
        )}
      </div>
      <div className="mt-3 space-y-1 text-xs">
        {segments.map((segment) => {
          const isHovered = hoveredLabel === segment.label;
          return (
            <div
              key={segment.label}
              onMouseEnter={() => setHoveredLabel(segment.label)}
              onMouseLeave={() => setHoveredLabel(null)}
              className={cn(
                "flex cursor-default items-center justify-between gap-3 rounded-md px-1.5 py-0.5 transition-colors",
                isHovered ? "bg-muted/70" : "hover:bg-muted/40",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full transition-transform",
                    segment.color,
                    isHovered && "scale-125 ring-1 ring-foreground/30",
                  )}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    "truncate transition-colors",
                    isHovered && "font-medium text-foreground",
                  )}
                >
                  {segment.label}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {compactTokenCount(segment.tokens)}
                {share(segment.tokens, maxContextTokens)}
              </span>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3 px-1.5 text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full bg-muted-foreground/30"
              aria-hidden="true"
            />
            <span className="truncate">{freeLabel}</span>
          </span>
          <span className="font-mono tabular-nums">
            {compactTokenCount(remainingTokens)}
            {share(remainingTokens, maxContextTokens)}
          </span>
        </div>
      </div>
    </>
  );
}
