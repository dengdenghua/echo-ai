import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import {
  modelSettingsPageCopy,
  type ModelSettingsPageCopy,
} from "@/core/i18n/locales/model-settings";

import { SettingsSection } from "../settings-section";
import {
  collectCompatFields,
  collectCompatProfileText,
  countCompatRetries,
  summarizeCompatProfiles,
  summarizeCompatRetryReasons,
  summarizeCompatScoreRange,
  type CompatDiagnostic,
  type CompatDiagnosticState,
  type CompatProfileCatalogState,
} from "./compat-diagnostics";
import { customModelEntryId, type ModelConfig } from "./custom-models";

export function GatewayDiagnosticsSection({
  gatewayStatus,
  copy,
  onReconnect,
  onDiagnose,
}: {
  gatewayStatus: "connected" | "disconnected" | "checking";
  copy: ModelSettingsPageCopy;
  onReconnect: () => void;
  onDiagnose: () => void;
}) {
  const { t } = useI18n();
  const statusLabel =
    gatewayStatus === "connected"
      ? t.settings.model.connected
      : gatewayStatus === "checking"
        ? t.common.loading
        : t.settings.model.disconnected;

  return (
    <SettingsSection
      title={
        <span id="model-settings-gateway">{t.settings.model.gatewayUrl}</span>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">
              {t.settings.model.gatewayUrl}
            </span>
            <span
              role="status"
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium",
                gatewayStatus === "connected" &&
                  "bg-success/10 text-success dark:bg-success/20 dark:text-success",
                gatewayStatus === "disconnected" &&
                  "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive",
                gatewayStatus === "checking" && "bg-info/15 text-info",
              )}
            >
              {gatewayStatus === "checking" && (
                <Loader2Icon className="size-3 animate-spin" />
              )}
              {statusLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" size="sm" onClick={onReconnect}>
              <RefreshCwIcon className="mr-1 size-3" />
              {t.settings.model.reconnect}
            </Button>
            <Button variant="outline" size="sm" onClick={onDiagnose}>
              <SearchIcon className="mr-1 size-3" />
              {t.settings.model.diagnose}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t.settings.model.port}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t.settings.model.backendUrlHint}
            </div>
          </div>
          <Input
            aria-label={t.settings.model.port}
            className="w-full font-mono text-xs sm:w-56 sm:text-right"
            value={getBackendBaseURL() || copy.sameOriginProxy}
            readOnly
          />
        </div>

        <div className="rounded-lg border border-info/30 bg-info/10 p-4 text-sm">
          <div className="mb-2 font-medium text-info dark:text-info">
            {t.settings.model.connectionHelp}
          </div>
          <ul className="list-disc space-y-1 pl-4 text-xs text-info dark:text-info">
            <li>{t.settings.model.connectionHelpReconnect}</li>
            <li>{t.settings.model.setDefaultHint}</li>
            <li>{t.settings.model.connectionHelpDiagnose}</li>
          </ul>
        </div>
      </div>
    </SettingsSection>
  );
}

export function ConfiguredCompatDiagnosticsCard({
  models,
  diagnostics,
  copy,
}: {
  models: ModelConfig[];
  diagnostics: CompatDiagnosticState;
  copy: ModelSettingsPageCopy;
}) {
  const relevantModels =
    diagnostics.status === "ready"
      ? models.filter((model) =>
          Boolean(diagnostics.byId[customModelEntryId(model)]),
        )
      : models;
  if (relevantModels.length === 0) return null;

  return (
    <SettingsSection
      title={copy.configuredDiagnosticsTitle}
      description={copy.configuredDiagnosticsSubtitle}
    >
      <div className="divide-y divide-border rounded-lg border border-border">
        {relevantModels.map((model) => {
          const modelId = customModelEntryId(model);
          return (
            <div
              key={modelId}
              role="group"
              aria-label={model.display_name || model.name}
              className="min-w-0 px-4 py-3"
            >
              <CompatDiagnosticSummary
                diagnostic={diagnostics.byId[modelId]}
                status={diagnostics.status}
              />
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
}

export function BuiltInCompatProfilesCard({
  catalog,
  copy,
}: {
  catalog: CompatProfileCatalogState;
  copy: ModelSettingsPageCopy;
}) {
  const { locale } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? catalog.items : catalog.items.slice(0, 8);
  const remaining = Math.max(0, catalog.items.length - visible.length);
  const loaded = catalog.status === "ready" || catalog.items.length > 0;

  return (
    <SettingsSection
      title={
        <div className="flex w-full items-center justify-between gap-3">
          <span>{copy.compatMatrixTitle}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {loaded
              ? copy.compatProfileCount(catalog.items.length)
              : copy.compatProfilesLoading}
          </span>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="text-sm leading-6 text-muted-foreground">
          {copy.compatMatrixDescription}
        </div>
        {catalog.status === "loading" && catalog.items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {copy.compatProfilesLoading}
          </div>
        ) : catalog.status === "error" && catalog.items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangleIcon className="size-4 text-warning" />
            {copy.compatProfilesUnavailable}
          </div>
        ) : (
          <div className="grid gap-2 xl:grid-cols-2">
            {visible.map((item) => {
              const upstream = item.upstreams?.[0];
              const score = summarizeCompatScoreRange(item);
              const removed = collectCompatFields(item, "removed_fields");
              const retryReasons = summarizeCompatRetryReasons(item);
              const hints = collectCompatProfileText(
                item,
                "normalization_hints",
              );
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-border-default bg-background/50 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {upstream?.profile_display_name || item.id}
                        </span>
                        {score && (
                          <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                            {copy.compatScore(
                              score.min === score.max
                                ? `${score.min}`
                                : `${score.min}-${score.max}`,
                            )}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {upstream?.model || item.id}
                      </div>
                    </div>
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                      {copy.compatFallbacks(countCompatRetries(item))}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {hints.length > 0 && (
                      <div title={hints.join(", ")}>
                        {copy.compatNormalize(
                          `${hints.slice(0, 4).join(", ")}${hints.length > 4 ? "…" : ""}`,
                        )}
                      </div>
                    )}
                    {removed.length > 0 && (
                      <div title={removed.join(", ")}>
                        {copy.compatDrops(
                          `${removed.slice(0, 5).join(", ")}${removed.length > 5 ? "…" : ""}`,
                        )}
                      </div>
                    )}
                    {retryReasons.length > 0 && (
                      <div title={retryReasons.join(", ")}>
                        {copy.compatRetries(
                          `${retryReasons.slice(0, 4).join(", ")}${retryReasons.length > 4 ? "…" : ""}`,
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {remaining > 0 && (
          <div className="text-xs text-muted-foreground">
            {copy.compatRemaining(remaining)}
            <Button
              className="ml-2"
              variant="outline"
              size="sm"
              onClick={() => setShowAll(true)}
            >
              {modelSettingsPageCopy(locale).showAll}
            </Button>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

function CompatDiagnosticSummary({
  diagnostic,
  status,
}: {
  diagnostic?: CompatDiagnostic;
  status: CompatDiagnosticState["status"];
}) {
  const { t, locale } = useI18n();
  const pageCopy = modelSettingsPageCopy(locale);

  if (status === "loading" && !diagnostic) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" />
        {t.settings.model.compatDiagnostics.loading}
      </div>
    );
  }

  if (!diagnostic) {
    return status === "error" ? (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <AlertTriangleIcon className="size-3.5 text-warning" />
        {t.settings.model.compatDiagnostics.unavailable}
      </div>
    ) : null;
  }

  if (!diagnostic.applicable) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <InfoIcon className="size-3.5" />
        <span>
          {diagnostic.reason ||
            t.settings.model.compatDiagnostics.notApplicable}
        </span>
      </div>
    );
  }

  const profiles = summarizeCompatProfiles(diagnostic);
  const removed = collectCompatFields(diagnostic, "removed_fields");
  const changed = collectCompatFields(diagnostic, "changed_fields");
  const added = collectCompatFields(diagnostic, "added_fields");
  const fallbackCount = countCompatRetries(diagnostic);
  const retryReasons = summarizeCompatRetryReasons(diagnostic);
  const scoreRange = summarizeCompatScoreRange(diagnostic);
  const normalizationHints = collectCompatProfileText(
    diagnostic,
    "normalization_hints",
  );
  const compatibilityNotes = collectCompatProfileText(
    diagnostic,
    "compatibility_notes",
  );
  const headerNames = diagnostic.default_header_names ?? [];
  const scoreLabel = scoreRange
    ? scoreRange.min === scoreRange.max
      ? `${scoreRange.min}`
      : `${scoreRange.min}-${scoreRange.max}`
    : null;
  const hasDetails =
    removed.length > 0 ||
    changed.length > 0 ||
    added.length > 0 ||
    normalizationHints.length > 0 ||
    compatibilityNotes.length > 0 ||
    retryReasons.length > 0;

  return (
    <div className="mt-3 min-w-0 max-w-full space-y-2 overflow-hidden border-l border-border pl-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
          <CheckCircle2Icon className="size-3.5 text-success" />
          {t.settings.model.compatDiagnostics.title}
        </span>
        {profiles.length > 0 && (
          <span className="max-w-full truncate rounded border border-border px-1.5 py-0.5">
            {profiles.join(", ")}
          </span>
        )}
        <span className="rounded border border-border px-1.5 py-0.5">
          {t.settings.model.compatDiagnostics.fallbacks(fallbackCount)}
        </span>
        {scoreLabel && (
          <span className="rounded border border-border px-1.5 py-0.5">
            {t.settings.model.compatDiagnostics.compatScore(scoreLabel)}
          </span>
        )}
        {headerNames.length > 0 && (
          <span className="rounded border border-border px-1.5 py-0.5">
            {t.settings.model.compatDiagnostics.headers(headerNames.join(", "))}
          </span>
        )}
      </div>
      {hasDetails && (
        <details className="group/compat">
          <summary className="w-fit cursor-pointer select-none rounded px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {pageCopy.compatDetails}
          </summary>
          <div className="mt-2 space-y-1.5 rounded-md bg-muted/35 p-2.5">
            {(removed.length > 0 || changed.length > 0 || added.length > 0) && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {removed.length > 0 && (
                  <span title={removed.join(", ")}>
                    {t.settings.model.compatDiagnostics.removedFields(
                      removed.slice(0, 5).join(", "),
                      removed.length,
                    )}
                  </span>
                )}
                {changed.length > 0 && (
                  <span title={changed.join(", ")}>
                    {t.settings.model.compatDiagnostics.changedFields(
                      changed.slice(0, 5).join(", "),
                      changed.length,
                    )}
                  </span>
                )}
                {added.length > 0 && (
                  <span title={added.join(", ")}>
                    {t.settings.model.compatDiagnostics.addedFields(
                      added.slice(0, 5).join(", "),
                      added.length,
                    )}
                  </span>
                )}
              </div>
            )}
            {normalizationHints.length > 0 && (
              <div title={normalizationHints.join(", ")}>
                {t.settings.model.compatDiagnostics.normalizationHints(
                  normalizationHints.slice(0, 5).join(", "),
                  normalizationHints.length,
                )}
              </div>
            )}
            {compatibilityNotes.length > 0 && (
              <div title={compatibilityNotes.join("; ")}>
                {t.settings.model.compatDiagnostics.compatibilityNotes(
                  compatibilityNotes.slice(0, 2).join("; "),
                  compatibilityNotes.length,
                )}
              </div>
            )}
            {retryReasons.length > 0 && (
              <div title={retryReasons.join(", ")}>
                {t.settings.model.compatDiagnostics.retryReasons(
                  retryReasons.slice(0, 4).join(", "),
                  retryReasons.length,
                )}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
