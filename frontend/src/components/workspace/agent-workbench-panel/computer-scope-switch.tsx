import { useI18n } from "@/core/i18n/hooks";

export function ComputerScopeSwitch({
  subLabel,
  onOpenMain,
  trailingAction,
}: {
  subLabel: string;
  onOpenMain: () => void;
  trailingAction?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 shrink-0 border-b border-border-subtle px-3 pt-2">
      <div className="flex min-w-0 items-center gap-3 text-xs font-medium">
        <span
          title={subLabel}
          className="min-w-0 flex-1 truncate border-b-2 border-foreground pb-2 text-foreground"
        >
          {subLabel}
        </span>
        <button
          type="button"
          onClick={onOpenMain}
          className="shrink-0 whitespace-nowrap border-b-2 border-transparent pb-2 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          title={t.agentWorkbenchPanel.switchToMainComputer}
        >
          {t.agentWorkbenchPanel.mainComputer}
        </button>
      </div>
      {trailingAction && <div className="min-w-0 py-2">{trailingAction}</div>}
    </div>
  );
}
