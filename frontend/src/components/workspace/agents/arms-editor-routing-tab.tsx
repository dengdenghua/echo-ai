import type { Dispatch, SetStateAction } from "react";
import { CoinsIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Agent } from "@/core/agents/types";
import type { Translations } from "@/core/i18n/locales/types";

interface ArmsEditorRoutingTabProps {
  t: Translations;
  agentId: string;
  affinity: string;
  setAffinity: Dispatch<SetStateAction<string>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  budget: NonNullable<Agent["budget"]>;
  hasBudgetOverride: boolean;
}

/** Body of the ArmsEditor "routing" tab (rendered inside its TabsContent). */
export function ArmsEditorRoutingTab({
  t,
  agentId,
  affinity,
  setAffinity,
  setDirty,
  budget,
  hasBudgetOverride,
}: ArmsEditorRoutingTabProps) {
  return (
    <>
      <div>
        <label className="text-sm font-medium">
          {t.armsEditor.extraAffinityLabel}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t.armsEditor.extraAffinityHint}
          </span>
        </label>
        <input
          type="text"
          value={affinity}
          onChange={(e) => {
            setAffinity(e.target.value);
            setDirty(true);
          }}
          placeholder={t.armsEditor.extraAffinityPlaceholder}
          className="mt-1 w-full rounded-sm border border-border bg-card/70 px-3 py-2 text-sm shadow-[var(--shadow-xs)] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div className="rounded-sm border border-border bg-card/70 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CoinsIcon className="h-4 w-4 text-muted-foreground" />
          {t.armsEditor.budgetLabel}
          {hasBudgetOverride ? (
            <Badge variant="outline" className="text-xs">
              {t.armsEditor.budgetOverride}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {t.armsEditor.budgetDefault}
            </Badge>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">max_iterations</div>
            <div className="mt-0.5 font-mono">
              {budget.max_iterations ?? "-"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">max_tokens</div>
            <div className="mt-0.5 font-mono">
              {budget.max_tokens != null
                ? `${(budget.max_tokens / 1000).toFixed(0)}k`
                : "-"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">max_usd</div>
            <div className="mt-0.5 font-mono">
              {budget.max_usd != null ? `$${budget.max_usd.toFixed(2)}` : "-"}
            </div>
          </div>
        </div>
        {!hasBudgetOverride && (
          <div className="mt-2 text-xs text-muted-foreground">
            {t.armsEditor.budgetEditHint(agentId)}
          </div>
        )}
      </div>
    </>
  );
}
