/**
 * What a failed turn offers when the trouble is the model rather than the
 * task. With no model at all, 重试 can only fail again, so the card offers
 * the ways to get one: install OpenCode (free), sign in to Echo, or add a
 * model. Other model problems keep the single 打开模型设置 action.
 */
import {
  CheckIcon,
  DownloadIcon,
  Loader2Icon,
  LogInIcon,
  PlusIcon,
  Settings2Icon,
} from "lucide-react";
import { toast } from "sonner";

import type { Message } from "@/core/api/types";
import { useEngineAction, useEngines } from "@/core/engines/api";
import {
  engineNeedsInstall,
  engineStatusLine,
} from "@/core/engines/status-line";
import { emitOpenSettings } from "@/core/events/event-bus";
import { useI18n } from "@/core/i18n/hooks";
import { engineStoreCopy } from "@/core/i18n/locales/engine-store";
import { turnFailureCopy } from "@/core/i18n/locales/turn-failure";
import { isNoModelConfigured } from "@/core/threads/errors";
import { workbenchActionErrorMessage } from "@/core/workbench/workbench-permissions";
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

const BUTTON =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-70";
const SECONDARY =
  "border-border-default bg-background/80 text-foreground/85 hover:border-border hover:bg-muted/60 hover:text-foreground";

function InstallOpencodeButton() {
  const { locale } = useI18n();
  const copy = turnFailureCopy(locale).setup;
  const store = engineStoreCopy(locale);
  const engines = useEngines(true);
  const install = useEngineAction();
  const opencode = engines.data?.engines.find(
    (engine) => engine.id === "opencode",
  );
  if (!opencode) return null;
  if (opencode.state === "ready") {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 px-1 text-xs font-medium text-success">
        <CheckIcon className="size-3.5" aria-hidden="true" />
        {copy.opencodeReady}
      </span>
    );
  }
  const installing = opencode.state === "installing" || install.isPending;
  if (!installing && !engineNeedsInstall(opencode)) return null;
  return (
    <button
      type="button"
      data-testid="model-setup-install-opencode"
      disabled={installing}
      aria-busy={installing}
      onClick={() =>
        install.mutate(
          { id: "opencode", action: "install" },
          {
            onError: (error) => toast.error(workbenchActionErrorMessage(error)),
          },
        )
      }
      className={cn(
        BUTTON,
        "border-transparent bg-foreground text-background hover:bg-foreground/90",
      )}
    >
      {installing ? (
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <DownloadIcon className="size-3.5" aria-hidden="true" />
      )}
      {installing
        ? engineStatusLine(opencode, store).text
        : copy.installOpencode}
    </button>
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
  const { t, locale } = useI18n();
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
  const copy = turnFailureCopy(locale).setup;
  return (
    <div
      data-testid="model-setup-actions"
      // A row of its own: beside the message it squeezed the text to one
      // character per line.
      className={cn(
        "flex w-full min-w-0 basis-full flex-wrap items-center gap-1.5",
        indent && "pl-6",
      )}
    >
      <InstallOpencodeButton />
      <button
        type="button"
        onClick={() => emitOpenSettings("account")}
        className={cn(BUTTON, SECONDARY)}
      >
        <LogInIcon className="size-3.5" aria-hidden="true" />
        {copy.signIn}
      </button>
      <button
        type="button"
        onClick={() => emitOpenSettings("models")}
        className={cn(BUTTON, SECONDARY)}
      >
        <PlusIcon className="size-3.5" aria-hidden="true" />
        {copy.addModel}
      </button>
    </div>
  );
}
