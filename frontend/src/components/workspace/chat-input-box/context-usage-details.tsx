/**
 * How full the model context is: the total, a bar split by what fills it
 * (messages, system prompt, tools, skills, memory …) and the space left.
 * Shared by the composer's context ring and the header status menu's 上下文
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
                style={{ width: `${Math.max(segPct, 0.6)}%` }}
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
