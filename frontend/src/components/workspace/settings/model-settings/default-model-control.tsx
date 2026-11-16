import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { UnifiedModelControl } from "@/components/workspace/unified-model-control";
import {
  routeNativeModels,
  type ModelEngine,
} from "@/components/workspace/unified-model-catalog";
import type { PickerModel } from "@/components/workspace/model-picker";
import { readDefaultModelRoute } from "@/core/realtime/default-model-route";
import { useAuth } from "@/providers/AuthProvider";

export function DefaultModelControl({
  models,
  value,
  label,
  onChange,
}: {
  models: PickerModel[];
  value: string;
  label: string;
  onChange: (model: string) => void;
}) {
  const { user } = useAuth();
  const principal = user?.actor_id || user?.user_id || "local";
  const [, rerender] = useState(0);
  const saved = readDefaultModelRoute(principal, value);
  const native = routeNativeModels(models).find(
    (row) => row.wireModel === value,
  );
  let lastChoice: ModelEngine | null = null;
  try {
    const previous = localStorage.getItem(
      `echo:execution-engine-last:${principal}`,
    );
    if (
      previous === "echo" ||
      previous === "codex" ||
      previous === "opencode" ||
      previous === "codebuddy"
    )
      lastChoice = previous;
  } catch {
    /* Optional browser storage. */
  }
  const engine: ModelEngine =
    saved ||
    (value.startsWith("codebuddy/")
      ? "codebuddy"
      : native?.executionEngine || lastChoice || "echo");
  const engineLabel =
    engine === "codebuddy"
      ? "CodeBuddy"
      : engine === "codex"
        ? "Codex"
        : engine === "opencode"
          ? "OpenCode"
          : "Echo";
  return (
    <UnifiedModelControl
      models={models}
      engine={engine}
      value={value}
      lazy
      showManageLink={false}
      onEngineChange={() => {
        /* The shared picker persists the default route. */
      }}
      onChange={(model) => {
        onChange(model);
        rerender((count) => count + 1);
      }}
      renderTrigger={(selectedLabel, disabled) => (
        <button
          type="button"
          aria-label={`${label}：${engineLabel}${selectedLabel}`}
          disabled={disabled}
          className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 truncate">
            <span className="mr-2 text-xs font-normal text-muted-foreground">
              {engineLabel}
            </span>
            {selectedLabel}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      )}
    />
  );
}
