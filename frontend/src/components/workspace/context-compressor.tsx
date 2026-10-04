/** Compact context meter with details available throughout a task. */
import { useCallback, useState } from "react";
import {
  useContextCompression,
  type ContextCompressionState,
} from "./use-context-compression";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export interface ContextCompressorProps {
  sessionId?: string;
  estimated?: boolean;
  currentTokens: number;
  maxTokens: number;
  compressThreshold?: number;
  isCompressing?: boolean;
  onCompress?: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}

export function ContextCompressor(props: ContextCompressorProps) {
  const state = useContextCompression(props);
  return <ContextCompressorControl {...props} state={state} />;
}

export function ContextCompressorControl({
  estimated = false,
  maxTokens,
  compressThreshold = 0.9,
  onCompress,
  disabled = false,
  className,
  state,
}: ContextCompressorProps & { state: ContextCompressionState }) {
  const { t, locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const {
    known,
    used,
    progress,
    percentage,
    busy,
    canCompress,
    hasAutoCompressed,
    error,
    requestCompress,
  } = state;
  const contextLabel = `${t.contextCompressor?.contextUsage ?? "Context Usage"}: ${known ? `${percentage}%` : zh ? "容量未知" : "Unknown capacity"}`;
  const copy = {
    details: zh ? "查看上下文详情" : "View context details",
    remaining: zh ? "剩余容量" : "Remaining capacity",
    unknown: zh
      ? "当前模型未提供上下文容量"
      : "Context capacity is unavailable for this model",
    waiting: zh
      ? "任务结束后可压缩上下文"
      : "Compression is available after the task finishes",
    empty: zh ? "还没有可压缩的上下文" : "No context to compress yet",
    unsupported: zh
      ? "当前任务不支持手动压缩"
      : "Manual compression is unavailable for this task",
    compressing: zh ? "正在压缩…" : "Compressing…",
    failed: zh ? "压缩失败，请重试" : "Compression failed. Try again",
  };

  const color =
    progress >= 0.95
      ? "text-destructive"
      : progress >= 0.8
        ? "text-warning"
        : progress >= 0.6
          ? "text-primary"
          : "text-muted-foreground";
  const reason = busy
    ? copy.compressing
    : !known
      ? copy.unknown
      : used === 0
        ? copy.empty
        : disabled
          ? copy.waiting
          : !onCompress
            ? copy.unsupported
            : null;
  const details = (
    <div className="space-y-2 text-xs">
      <div className="font-medium">{contextLabel}</div>
      {estimated ? (
        <p className="text-muted-foreground">
          {zh
            ? "按当前对话估算，实际模型用量可能不同"
            : "Estimated from this conversation; actual model usage may differ"}
        </p>
      ) : null}
      {known ? (
        <>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Tokens</span>
            <span className="font-mono">
              {used.toLocaleString()} / {maxTokens.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{copy.remaining}</span>
            <span className="font-mono">
              {Math.max(0, maxTokens - used).toLocaleString()} ·{" "}
              {100 - percentage}%
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">
              {t.contextCompressor?.threshold ?? "Auto-compress at"}
            </span>
            <span className="font-mono">
              {Math.round(compressThreshold * 100)}%
            </span>
          </div>
        </>
      ) : null}
      {reason ? <p className="text-muted-foreground">{reason}</p> : null}
      {progress >= 0.95 ? (
        <p className="text-destructive">
          {t.contextCompressor?.contextFull ?? "Context nearly full!"}
        </p>
      ) : null}
      {hasAutoCompressed ? (
        <p className="text-primary">
          {t.contextCompressor?.autoCompressed ?? "Auto-compressed"}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        setTooltipOpen(false);
      }}
    >
      <Tooltip
        delayDuration={200}
        open={tooltipOpen && !menuOpen}
        onOpenChange={(open) => setTooltipOpen(open && !menuOpen)}
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="context-usage-trigger"
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                color,
                className,
              )}
              aria-label={`${contextLabel}. ${copy.details}`}
              aria-busy={busy}
            >
              <svg
                aria-hidden
                viewBox="0 0 18 18"
                className={cn("size-4 -rotate-90", busy && "animate-pulse")}
              >
                <circle
                  cx="9"
                  cy="9"
                  r="7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="opacity-20"
                  strokeDasharray={known ? undefined : "2 2"}
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
                    strokeDasharray={`${2 * Math.PI * 7 * progress} ${2 * Math.PI * 7}`}
                    className="transition-[stroke-dasharray] duration-slow"
                  />
                ) : null}
              </svg>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!menuOpen ? (
          <TooltipContent side="top">{details}</TooltipContent>
        ) : null}
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="end"
        className="w-64 max-w-[calc(100vw-2rem)] p-2"
      >
        <div className="px-1 py-1.5">{details}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canCompress}
          onSelect={(event) => {
            event.preventDefault();
            void requestCompress();
          }}
        >
          {busy
            ? copy.compressing
            : (t.contextCompressor?.compressContext ?? "Compress context")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function useContextCompressor(
  maxTokens: number,
  compressThreshold?: number,
) {
  const [currentTokens, setCurrentTokens] = useState(0);
  const [isCompressing, setIsCompressing] = useState(false);

  const compress = useCallback(async () => {
    if (isCompressing) return;
    setIsCompressing(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setCurrentTokens((prev) => Math.floor(prev * 0.6));
    } finally {
      setIsCompressing(false);
    }
  }, [isCompressing]);

  return {
    currentTokens,
    setCurrentTokens,
    isCompressing,
    compress,
    maxTokens,
    compressThreshold,
  };
}
