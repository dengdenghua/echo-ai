/**
 * A quiet line above the composer while no model can answer yet, so a new
 * user learns what to do before the first turn fails rather than after.
 * Typing stays open; the line points at 连接 OpenCode (Zen's free models,
 * which need an OpenCode Zen API Key) and 添加模型 (the user's own API).
 * It disappears as soon as the catalog lists a real model, and never shows
 * while the conversation's engine can answer (a signed-in Codex) or while
 * that is still being checked.
 */
import { ModelSetupButtons } from "@/components/workspace/messages/model-setup-actions";
import { useI18n } from "@/core/i18n/hooks";
import { turnFailureCopy } from "@/core/i18n/locales/turn-failure";
import { useModels } from "@/core/models/hooks";
import { hasAnsweringModel } from "@/core/models/readiness";
import { cn } from "@/lib/utils";

export function FirstModelHint({
  executionEngine,
  engineReady,
  className,
}: {
  executionEngine?: "echo" | "codex" | "opencode";
  /** The selected engine can answer; null while its readiness loads. */
  engineReady?: boolean | null;
  className?: string;
}) {
  const { locale } = useI18n();
  const { models, isLoading, error } = useModels();
  // Codex answers with its own signed-in account, outside this catalog.
  if (isLoading || error || executionEngine === "codex") return null;
  if (engineReady === true || engineReady === null) return null;
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
