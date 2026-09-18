import { ChevronDownIcon, Loader2Icon } from "lucide-react";

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

export function ContextWindowBar({
  contextTokens = 0,
  maxContextTokens = 128_000,
  isCompressingContext = false,
  onCompressContext,
  segments = [],
}: ContextWindowBarProps) {
  const { t } = useI18n();
  const percentage =
    maxContextTokens > 0 && contextTokens > 0
      ? Math.min(Math.round((contextTokens / maxContextTokens) * 100), 100)
      : 0;
  const remainingTokens = Math.max(0, maxContextTokens - contextTokens);
  const summary = `${compactTokenCount(contextTokens)} / ${compactTokenCount(
    maxContextTokens,
  )} (${percentage}%)`;

  return (
    <div className="flex min-h-8 items-center px-2 pt-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="chat-context-window-trigger"
            className="flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-label={`${t.contextWindow.title}: ${summary}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">
                {t.contextWindow.title}
              </span>
              <span className="font-mono tabular-nums">{summary}</span>
            </span>
            <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
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
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 text-muted-foreground">
              <span>{t.contextCompressor?.tokens ?? "tokens"}</span>
              <span className="font-mono tabular-nums">
                {compactTokenCount(remainingTokens)}
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
    </div>
  );
}
