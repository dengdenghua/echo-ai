import { useI18n } from "@/core/i18n/hooks";

export function ComputerScopeSwitch({
  subLabel,
  onOpenMain,
  trailingAction,
  mainLabel,
}: {
  subLabel: string;
  onOpenMain: () => void;
  trailingAction?: React.ReactNode;
  mainLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 shrink-0 border-b border-border-subtle bg-muted/20 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <span
            title={subLabel}
            className="min-w-0 flex-1 truncate px-1 py-1 font-medium text-foreground"
          >
            {subLabel}
          </span>
          <button
            type="button"
            onClick={onOpenMain}
            className="shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 font-medium text-muted-foreground transition-all hover:bg-card/60 hover:text-foreground active:scale-95"
            title={mainLabel ?? t.agentWorkbenchPanel.switchToMainComputer}
          >
            {mainLabel ?? t.agentWorkbenchPanel.mainComputer}
          </button>
        </div>
        {trailingAction && <div className="shrink-0">{trailingAction}</div>}
      </div>
    </div>
  );
}
