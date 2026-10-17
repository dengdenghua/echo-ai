import { ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";

import { getSettingsUxCopy } from "../settings-ux-copy";

/** Collapsed "alternative unlock paths" explainer under the advanced block. */
export function UnlockPathsDetails() {
  const { locale } = useI18n();
  const copy = getSettingsUxCopy(locale).privacy;

  return (
    <details className="group rounded-lg border border-border-subtle bg-muted/20 p-4">
      <summary className="cursor-pointer list-none rounded text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <span className="flex items-center justify-between gap-3">
          <span>
            <span className="block font-semibold">{copy.advancedTitle}</span>
            <span className="mt-0.5 block font-normal text-muted-foreground">
              {copy.advancedSummary}
            </span>
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          />
        </span>
      </summary>
      <div className="mt-3 border-t border-border-subtle pt-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {copy.advancedDescription}
        </p>
        <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground/90">
          <li>{copy.advancedEnvironment}</li>
          <li>{copy.advancedTurn}</li>
          <li>{copy.advancedApi}</li>
        </ul>
      </div>
    </details>
  );
}

/** Collapsed danger-zone block whose button opens the factory reset dialog. */
export function FactoryResetSection({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();

  return (
    <details className="group rounded-lg border border-destructive/20 bg-destructive/5">
      <summary className="cursor-pointer list-none rounded-lg px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-destructive/35">
        <span className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold text-destructive">
              {t.accountSettings.factoryResetTitle}
            </span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              {t.accountSettings.factoryResetDescription}
            </span>
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-destructive/70 transition-transform group-open:rotate-90"
          />
        </span>
      </summary>
      <div className="border-t border-destructive/15 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-destructive">
              {t.accountSettings.factoryResetTitle}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.accountSettings.factoryResetDescription}
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="h-8 text-xs"
            onClick={onOpen}
          >
            {t.accountSettings.factoryResetTitle}
          </Button>
        </div>
      </div>
    </details>
  );
}
