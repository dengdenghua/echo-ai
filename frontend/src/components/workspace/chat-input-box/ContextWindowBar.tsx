import { Loader2Icon } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ContextWindowSegment {
  label: string;
  tokens: number;
  color: string;
}

interface ContextWindowBarProps {
  contextTokens?: number;
  maxContextTokens?: number;
  isCompressingContext?: boolean;
  onCompressContext?: () => void | Promise<void>;
  segments?: ContextWindowSegment[];
}

function compactTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1))}K`;
  }
  return value.toLocaleString();
}

function ringColorClass(progress: number): string {
  if (progress >= 0.95) return "text-destructive";
  if (progress >= 0.8) return "text-warning";
  if (progress >= 0.5) return "text-primary";
  return "text-muted-foreground";
}

export function ContextWindowBar({
  contextTokens = 0,
  maxContextTokens = 128_000,
  isCompressingContext = false,
  onCompressContext,
  segments = [],
}: ContextWindowBarProps) {
  const { t } = useI18n();
  const progress =
    maxContextTokens > 0 && contextTokens > 0
      ? Math.min(contextTokens / maxContextTokens, 1)
      : 0;
  const percentage = Math.round(progress * 100);
  const remainingTokens = Math.max(0, maxContextTokens - contextTokens);
  const summary = `${compactTokenCount(contextTokens)} / ${compactTokenCount(
    maxContextTokens,
  )} (${percentage}%)`;
  const circumference = 2 * Math.PI * 7;
  const strokeLength = circumference * progress;
  const colorClass = ringColorClass(progress);
  const freeLabel = t.contextWindow.freeSpace ?? "Free space";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="chat-context-window-trigger"
          className={cn(
            "hover:bg-muted flex size-8 items-center justify-center rounded-lg border border-transparent text-xs transition-colors",
            "hover:text-foreground",
            colorClass,
          )}
          aria-label={`${t.contextWindow.title}: ${summary}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        >
          <svg aria-hidden viewBox="0 0 18 18" className="size-4 -rotate-90">
            <circle
              cx="9"
              cy="9"
              r="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="opacity-20"
            />
            {progress > 0 ? (
              <circle
                cx="9"
                cy="9"
                r="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${strokeLength} ${circumference}`}
                className={cn(
                  "transition-[stroke-dasharray] duration-slow",
                  isCompressingContext && "animate-pulse",
                )}
              />
            ) : null}
          </svg>
          <span className="sr-only">{summary}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[22rem] rounded-xl border-border-default p-3"
      >
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">
            {t.contextWindow.title}
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {summary}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground/25 transition-[width]"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="mt-3 space-y-1 text-xs">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    segment.color,
                  )}
                  aria-hidden="true"
                />
                <span className="truncate">{segment.label}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {compactTokenCount(segment.tokens)}
                {maxContextTokens > 0
                  ? ` (${Math.round((segment.tokens / maxContextTokens) * 1000) / 10}%)`
                  : ""}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 text-muted-foreground">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full bg-muted-foreground/30"
                aria-hidden="true"
              />
              <span className="truncate">{freeLabel}</span>
            </span>
            <span className="font-mono tabular-nums">
              {compactTokenCount(remainingTokens)}
              {maxContextTokens > 0
                ? ` (${Math.round((remainingTokens / maxContextTokens) * 1000) / 10}%)`
                : ""}
            </span>
          </div>
        </div>
        {onCompressContext ? (
          <button
            type="button"
            onClick={() => void onCompressContext()}
            disabled={isCompressingContext || contextTokens <= 0}
            className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-muted text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            {isCompressingContext ? (
              <Loader2Icon
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {isCompressingContext
              ? t.contextCompressor.compressing
              : t.agentWorkbenchPages.contextCompress}
          </button>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
