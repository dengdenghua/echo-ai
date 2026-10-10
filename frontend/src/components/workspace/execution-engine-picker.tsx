import { CheckIcon, SparklesIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import {
  executionEngineCopy,
  verificationInChinese,
} from "@/core/i18n/locales/execution-engine";
import {
  engineVerificationLabel,
  type EngineCapabilityChecks,
} from "@/core/agents/engine-capability-checks";
import type { ExecutionEnginePreference } from "@/core/realtime/execution-policy";

/** Official OpenCode square mark.
 * Source: anomalyco/opencode packages/ui/src/assets/favicon/favicon.svg
 */
function OpenCodeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      data-testid="opencode-logo"
      aria-hidden="true"
    >
      <rect width="512" height="512" fill="#131010" />
      <path d="M320 224V352H192V224H320Z" fill="#5A5858" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/** Exact light/dark Blossom assets shipped with the official Codex desktop app. */
function CodexIcon({ className }: { className?: string }) {
  return (
    <span className={className} data-testid="codex-logo" aria-hidden="true">
      <img
        src="/brands/codex-blossom-on-light.png"
        alt=""
        className="size-full object-contain dark:hidden"
      />
      <img
        src="/brands/codex-blossom-on-dark.png"
        alt=""
        className="hidden size-full object-contain dark:block"
      />
    </span>
  );
}

export function ExecutionEnginePicker({
  value,
  resolvedEngine,
  onChange,
  codexAvailable,
  unavailableReason,
  opencodeAvailable = false,
  opencodeUnavailableReason,
  codexCapabilityChecks,
  opencodeCapabilityChecks,
  disabled,
}: {
  value: ExecutionEnginePreference;
  /** Engine selected by Auto for this turn. The picker remains on Auto, while
   * the trigger tells the user which native identity will actually run. */
  resolvedEngine?: Exclude<ExecutionEnginePreference, "auto">;
  onChange: (value: ExecutionEnginePreference) => void;
  codexAvailable: boolean;
  unavailableReason?: string | null;
  opencodeAvailable?: boolean;
  opencodeUnavailableReason?: string | null;
  codexCapabilityChecks?: EngineCapabilityChecks;
  opencodeCapabilityChecks?: EngineCapabilityChecks;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const copy = executionEngineCopy(locale);
  // Model readiness gates execution, not access to the engine's model picker.
  const codexSelectable =
    codexAvailable || unavailableReason === "model_incompatible";
  const title = copy.title;
  const labels = {
    auto: copy.auto,
    echo: copy.legacyNative,
    codex: "Codex",
    opencode: "OpenCode",
  };
  // Reason codes come from the backend; unknown ones read as unavailable.
  const reasonTexts: Partial<Record<string, string>> = copy.reasons;
  const unavailable = !codexAvailable
    ? (reasonTexts[unavailableReason ?? "configuration_unavailable"] ??
      copy.reasons.configuration_unavailable)
    : null;
  const selectedUnavailable =
    value === "codex"
      ? unavailable
      : value === "opencode" && !opencodeAvailable
        ? opencodeUnavailableReason || copy.opencodeCheckSetup
        : null;
  const visibleEngine = value === "auto" ? resolvedEngine : value;
  const triggerTitle =
    selectedUnavailable ||
    `${title}: ${labels[value]}${value === "auto" && resolvedEngine ? ` · ${labels[resolvedEngine]}` : ""}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${title}: ${labels[value]}${selectedUnavailable ? copy.unavailableSuffix(selectedUnavailable) : ""}`}
          title={triggerTitle}
          data-testid="execution-engine-trigger"
          className="relative flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
        >
          {visibleEngine === "opencode" ? (
            <OpenCodeIcon className="size-3.5 shrink-0" />
          ) : visibleEngine === "codex" ? (
            <CodexIcon className="size-3.5 shrink-0" />
          ) : (
            <SparklesIcon className="size-3.5 shrink-0" />
          )}
          {selectedUnavailable ? (
            <span
              className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive"
              aria-hidden="true"
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <p className="px-2 py-2 text-ui font-medium">{title}</p>
        {/* The red dot on the trigger means this; say it where it is read. */}
        {selectedUnavailable ? (
          <p
            role="status"
            className="mx-2 mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-ui leading-relaxed text-destructive"
          >
            {copy.selectedUnavailable(labels[value], selectedUnavailable)}
          </p>
        ) : null}
        {value === "echo" ? (
          <p className="px-2 pb-2 text-ui text-muted-foreground">
            {copy.legacyNotice}
          </p>
        ) : null}
        {(["auto", "opencode", "codex"] as const).map((engine) => (
          <DropdownMenuItem
            key={engine}
            disabled={
              (engine === "codex" && !codexSelectable) ||
              (engine === "opencode" && !opencodeAvailable)
            }
            onSelect={() => onChange(engine)}
            className={`items-start gap-2.5 py-2 ${value === engine ? "bg-accent" : ""}`}
          >
            {engine === "auto" ? (
              <SparklesIcon className="mt-0.5 size-4 shrink-0" />
            ) : engine === "opencode" ? (
              <OpenCodeIcon className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CodexIcon className="mt-0.5 size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{labels[engine]}</span>
              <span className="mt-0.5 block text-ui leading-relaxed text-muted-foreground">
                {engine === "auto"
                  ? copy.autoDescription(
                      resolvedEngine ? labels[resolvedEngine] : undefined,
                    )
                  : engine === "opencode"
                    ? !opencodeAvailable
                      ? opencodeUnavailableReason || copy.opencodeCheckSetup
                      : copy.opencodeDescription
                    : (unavailable ?? copy.codexDescription)}
              </span>
              {(engine === "codex" && codexAvailable) ||
              (engine === "opencode" && opencodeAvailable) ? (
                <span className="mt-0.5 block text-ui leading-relaxed text-muted-foreground">
                  {engineVerificationLabel(
                    engine === "codex"
                      ? codexCapabilityChecks
                      : opencodeCapabilityChecks,
                    verificationInChinese(locale),
                  )}
                </span>
              ) : null}
            </span>
            {value === engine ? (
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Historical evidence only. Never infer an engine from today's role or setting. */
export function ExecutionEngineBadge({ engine }: { engine: unknown }) {
  const { locale } = useI18n();
  if (engine !== "codex" && engine !== "echo" && engine !== "opencode")
    return null;
  const name =
    engine === "opencode" ? "OpenCode" : engine === "codex" ? "Codex" : "Echo";
  return (
    <span
      className="mb-1 inline-block rounded border border-border/60 px-1.5 text-[10px] leading-4 text-muted-foreground"
      title={executionEngineCopy(locale).executedBy(name)}
      data-execution-engine={engine}
    >
      {name}
    </span>
  );
}
