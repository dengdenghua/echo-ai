import { useRef, useState } from "react";
import { ListFilterIcon, Loader2Icon } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { sessionStatusCopy } from "@/core/i18n/locales/session-status";
import { useSessionStatusMenuOpener } from "@/core/realtime/session-status-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  ContextUsageDetails,
  contextUsage,
  type ContextWindowSegment,
} from "./context-usage-details";

export type { ContextWindowSegment } from "./context-usage-details";

interface ContextWindowBarProps {
  contextTokens?: number;
  maxContextTokens?: number;
  isCompressingContext?: boolean;
  /** Used only where no header status menu is mounted; where one is, the
   * popover links there and the menu compresses. */
  onCompressContext?: () => void | Promise<void>;
  segments?: ContextWindowSegment[];
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
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const openStatusMenu = useSessionStatusMenuOpener();
  // Handing over to the status menu: keep focus from snapping back to the
  // ring, which would dismiss the menu as it opens.
  const handingOff = useRef(false);
  const { progress, percentage, summary } = contextUsage(
    contextTokens,
    maxContextTokens,
  );
  const circumference = 2 * Math.PI * 7;
  const strokeLength = circumference * progress;
  const colorClass = ringColorClass(progress);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
        onCloseAutoFocus={(event) => {
          if (!handingOff.current) return;
          handingOff.current = false;
          event.preventDefault();
        }}
      >
        <ContextUsageDetails
          contextTokens={contextTokens}
          maxContextTokens={maxContextTokens}
          segments={segments}
        />
        {openStatusMenu ? (
          <button
            type="button"
            onClick={() => {
              handingOff.current = true;
              setOpen(false);
              window.setTimeout(openStatusMenu, 0);
            }}
            className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-muted text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            {isCompressingContext ? (
              <Loader2Icon
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <ListFilterIcon className="size-3.5" aria-hidden="true" />
            )}
            {sessionStatusCopy(locale).openInPanel}
          </button>
        ) : onCompressContext ? (
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
