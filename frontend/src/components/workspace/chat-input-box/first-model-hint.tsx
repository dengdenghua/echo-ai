/**
 * A quiet line above the composer while no model can answer yet, so a new
 * user learns what to do before the first turn fails rather than after.
 * Typing stays open; the line points at 连接 OpenCode (Zen's free models,
 * which need an OpenCode Zen API Key) and 添加模型 (the user's own API).
 * It disappears as soon as the catalog lists a real model.
 */
import { ModelSetupButtons } from "@/components/workspace/messages/model-setup-actions";
import { useI18n } from "@/core/i18n/hooks";
import { turnFailureCopy } from "@/core/i18n/locales/turn-failure";
import { useModels } from "@/core/models/hooks";
import type { Model } from "@/core/models/types";
import { cn } from "@/lib/utils";

/** Catalog rows that route to other models rather than answering themselves. */
const ROUTING_ONLY = new Set(["auto", "echo-mix"]);

export function hasAnsweringModel(models: Model[]): boolean {
  return models.some((model) => !ROUTING_ONLY.has(model.id || model.name));
}

export function FirstModelHint({
  executionEngine,
  className,
}: {
  executionEngine?: "echo" | "codex" | "opencode";
  className?: string;
}) {
  const { locale } = useI18n();
  const { models, isLoading, error } = useModels();
  // Codex answers with its own signed-in account, outside this catalog.
  if (isLoading || error || executionEngine === "codex") return null;
  if (hasAnsweringModel(models)) return null;
  const copy = turnFailureCopy(locale);
  return (
    <div
      role="status"
      data-testid="first-model-hint"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
      />
      <span className="min-w-0">
        <span className="font-medium text-foreground/85">
          {copy.noModelTitle}
        </span>
        <span className="mx-1.5 text-border" aria-hidden="true">
          ·
        </span>
        {copy.noModelHint}
      </span>
      <ModelSetupButtons quiet className="ml-auto" />
    </div>
  );
}
