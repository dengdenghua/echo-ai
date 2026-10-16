import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  UserRoundIcon,
  WifiIcon,
} from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ModelSettingsPageCopy } from "@/core/i18n/locales/model-settings";

export function ModelSettingsOverview({
  copy,
  modelPicker,
  customModelCount,
  modelCount,
  gatewayStatus,
  onAddModel,
  onScanLocal,
  onOpenZen,
  onOpenCodex,
}: {
  copy: ModelSettingsPageCopy;
  modelPicker: React.ReactNode;
  customModelCount: number;
  modelCount: number;
  gatewayStatus: "connected" | "disconnected" | "checking";
  onAddModel: () => void;
  onScanLocal: () => void;
  onOpenZen: () => void;
  onOpenCodex: () => void;
}) {
  const nextFocusSelector = useRef<string | null>(null);
  const gatewayLabel =
    gatewayStatus === "connected"
      ? copy.gatewayConnected
      : gatewayStatus === "checking"
        ? copy.gatewayChecking
        : copy.gatewayDisconnected;

  return (
    <section className="rounded-lg border border-border bg-card/45 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{copy.overviewTitle}</h2>
          <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">
            {copy.overviewSubtitle}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5">
              <PlusIcon className="size-3.5" />
              {copy.addConnection}
              <ChevronDownIcon className="size-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-52"
            onCloseAutoFocus={(event) => {
              const selector = nextFocusSelector.current;
              nextFocusSelector.current = null;
              if (!selector) return;
              // These actions open a section below the trigger. Restoring
              // focus to the trigger would undo the section's scroll.
              event.preventDefault();
              requestAnimationFrame(() => {
                document
                  .querySelector<HTMLElement>(selector)
                  ?.focus({ preventScroll: true });
              });
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                nextFocusSelector.current = "#add-model-provider";
                onAddModel();
              }}
            >
              <PlusIcon className="size-4" />
              {copy.addApiModel}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                nextFocusSelector.current = "#model-settings-codex > summary";
                onOpenCodex();
              }}
            >
              <UserRoundIcon className="size-4" />
              ChatGPT / Codex
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                nextFocusSelector.current =
                  "#model-settings-opencode > summary";
                onOpenZen();
              }}
            >
              <ChevronRightIcon className="size-4" />
              OpenCode · Zen / Go
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                nextFocusSelector.current = "#model-settings-local button";
                onScanLocal();
              }}
            >
              <WifiIcon className="size-4" />
              {copy.scanLocalModels}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-4">{modelPicker}</div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{copy.configuredSummary(customModelCount, modelCount)}</span>
        {gatewayStatus !== "connected" ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium",
              gatewayStatus === "checking" && "text-info",
              gatewayStatus === "disconnected" && "text-destructive",
            )}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {gatewayLabel}
          </div>
        ) : null}
      </div>
    </section>
  );
}
