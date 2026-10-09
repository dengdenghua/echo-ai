import * as Popover from "@radix-ui/react-popover";
import { SlidersHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/core/i18n/hooks";
import {
  ContextCompressorControl,
  type ContextCompressorProps,
} from "../context-compressor";
import { EvolutionIndicator } from "../evolution-indicator";
import { PreviewRefreshIndicator } from "../preview-refresh-indicator";
import type { ContextCompressionState } from "../use-context-compression";

export function ComposerOptions({
  responseModeControl,
  executionEngineControl,
  contextProps,
  contextState,
}: {
  responseModeControl?: ReactNode;
  executionEngineControl?: ReactNode;
  contextProps: ContextCompressorProps;
  contextState: ContextCompressionState;
}) {
  const { t } = useI18n();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="composer-options-trigger"
          aria-label={t.chatInputBox.conversationOptions}
          title={t.chatInputBox.conversationOptions}
          className="flex size-[42px] shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-8"
        >
          <SlidersHorizontalIcon className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-testid="composer-options-panel"
          aria-label={t.chatInputBox.conversationOptions}
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className="z-50 w-72 max-w-[calc(100vw-1.5rem)] space-y-1 rounded-xl border border-border-default bg-popover p-3 text-popover-foreground shadow-[var(--shadow-floating)]"
        >
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {t.chatInputBox.conversationOptions}
          </p>
          {responseModeControl ? (
            <div className="flex min-h-10 items-center justify-between gap-4 text-xs">
              <span className="shrink-0 text-muted-foreground">
                {t.chatInputBox.responseMode}
              </span>
              <div className="composer-footer__response min-w-0">
                {responseModeControl}
              </div>
            </div>
          ) : null}
          {executionEngineControl ? (
            <div className="flex min-h-10 items-center justify-between gap-4 text-xs">
              <span className="shrink-0 text-muted-foreground">
                {t.chatInputBox.executionMethod}
              </span>
              <div className="min-w-0">{executionEngineControl}</div>
            </div>
          ) : null}
          <div className="flex min-h-10 items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">
              {t.contextCompressor.contextUsage}
            </span>
            <div className="flex items-center gap-1">
              <span className="tabular-nums">
                {contextState.known ? `${contextState.percentage}%` : "—"}
              </span>
              <ContextCompressorControl
                {...contextProps}
                state={contextState}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1 empty:hidden">
            <EvolutionIndicator compact quiet />
            <PreviewRefreshIndicator />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
