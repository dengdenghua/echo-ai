/**
 * What a failed turn offers when the trouble is the model rather than the
 * task. With no model at all, 重试 can only fail again, so the card offers
 * the way to get one: add a model, or connect OpenCode Zen / Go when the
 * OpenCode engine is installed. Nothing here offers a free model: Zen's
 * free tier serves only OpenCode's own app, never ECHO AI. Other model
 * problems keep the single 打开模型设置 action.
 */
import { PlugIcon, PlusIcon, Settings2Icon } from "lucide-react";

import type { Message } from "@/core/api/types";
import { useEngines } from "@/core/engines/api";
import { emitOpenSettings } from "@/core/events/event-bus";
import { useI18n } from "@/core/i18n/hooks";
import { turnFailureCopy } from "@/core/i18n/locales/turn-failure";
import { openCustomModelSetup } from "@/core/models/setup";
import { isNoModelConfigured } from "@/core/threads/errors";
import { cn } from "@/lib/utils";

const PREPARATION_REASONS = new Set([
  "account_required",
  "account_unavailable",
  "model_incompatible",
  "configuration_unavailable",
  "executable_unavailable",
  "not_installed",
  "disabled",
  "unavailable",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/** A Codex/OpenCode turn that could not start until its engine is set up. */
export function hasModelPreparationIssue(messages: Message[]): boolean {
  return messages.some((message) => {
    const info = record(record(message.additional_kwargs?.error)?.info);
    return (
      info?.code === "execution_unavailable" &&
      (info.engine === "codex" || info.engine === "opencode") &&
      PREPARATION_REASONS.has(String(info.reason))
    );
  });
}

export function isNoModelFailure(
  failure: { detail?: string } | null | undefined,
): boolean {
  return isNoModelConfigured(failure?.detail ?? "");
}

/**
 * OpenCode answers only through a Zen or Go connection, and only once the
 * engine is installed; before that, "连接 OpenCode" would lead nowhere.
 */
export function useOpencodeInstalled(enabled = true): boolean {
  const engines = useEngines(enabled);
  return Boolean(
    engines.data?.engines.some(
      (engine) => engine.id === "opencode" && engine.state === "ready",
    ),
  );
}

const BUTTON =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
const PRIMARY =
  "border-transparent bg-foreground text-background hover:bg-foreground/90";
const SECONDARY =
  "border-border-default bg-background/80 text-foreground/85 hover:border-border hover:bg-muted/60 hover:text-foreground";

/** 添加模型, plus 连接 OpenCode when the engine is installed. */
export function ModelSetupButtons({
  quiet = false,
  className,
}: {
  /** Ghost buttons for the composer's first-run line. */
  quiet?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  const copy = turnFailureCopy(locale).setup;
  const opencodeInstalled = useOpencodeInstalled();
  const ghost =
    "border-transparent text-foreground/85 hover:bg-muted/60 hover:text-foreground";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <button
        type="button"
        data-testid="model-setup-add-model"
        onClick={openCustomModelSetup}
        className={cn(BUTTON, quiet ? ghost : PRIMARY)}
      >
        <PlusIcon className="size-3.5" aria-hidden="true" />
        {copy.addModel}
      </button>
      {opencodeInstalled ? (
        <button
          type="button"
          data-testid="model-setup-connect-opencode"
          onClick={() => emitOpenSettings("models")}
          className={cn(BUTTON, quiet ? ghost : SECONDARY)}
        >
          <PlugIcon className="size-3.5" aria-hidden="true" />
          {copy.connectOpencode}
        </button>
      ) : null}
    </span>
  );
}

export function ModelSetupActions({
  noModel,
  indent = false,
}: {
  noModel: boolean;
  /** Line the row up with the message text after the card's status icon. */
  indent?: boolean;
}) {
  const { t } = useI18n();
  if (!noModel) {
    return (
      <button
        type="button"
        onClick={() => emitOpenSettings("models")}
        title={t.streaming.openModelSettings}
        className={cn(
          BUTTON,
          "border-warning/35 bg-warning/[0.08] text-warning hover:border-warning/55 hover:bg-warning/15",
        )}
      >
        <Settings2Icon className="size-3" />
        {t.streaming.openModelSettings}
      </button>
    );
  }
  return (
    <div
      data-testid="model-setup-actions"
      // A row of its own: beside the message it squeezed the text to one
      // character per line.
      className={cn("flex w-full min-w-0 basis-full", indent && "pl-6")}
    >
      <ModelSetupButtons />
    </div>
  );
}
