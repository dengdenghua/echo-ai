import { useI18n } from "@/core/i18n/hooks";
import { conversationNoticesCopy } from "@/core/i18n/locales/conversation-notices";
import { cn } from "@/lib/utils";

export function ModelSwitchTimelineEntry({
  modelName,
  className,
}: {
  modelName: string;
  className?: string;
}) {
  const { locale } = useI18n();
  const label = conversationNoticesCopy(locale).modelSwitched(modelName);
  return (
    <div
      className={cn(
        "my-2 flex w-full items-center gap-3 px-1",
        "animate-[message-entrance_180ms_cubic-bezier(0.33,1,0.68,1)]",
        className,
      )}
      role="status"
      aria-label={label}
      data-testid="model-switch-timeline-entry"
    >
      <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-border/45" />
      <span className="max-w-[70%] truncate text-xs font-normal text-muted-foreground">
        {label}
      </span>
      <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-border/45" />
    </div>
  );
}
