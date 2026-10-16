import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { swallow } from "@/core/utils/log";
import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { modelSettingsPageCopy } from "@/core/i18n/locales/model-settings";
import {
  clearThreadModelReferences,
  getLocalSettings,
  saveLocalSettings,
} from "@/core/settings/local";
import { useLocalSettings } from "@/core/settings/hooks";
import { useModels } from "@/core/models/hooks";
import { useModelSetupRequests } from "@/core/models/setup";
import { ModelPicker } from "@/components/workspace/model-picker";
import { ModelCookbook } from "@/components/workspace/model-cookbook";
import { CoderEngineSettings } from "@/components/workspace/coder-engine-settings";
import { OpenCodeConnections } from "./opencode-connections";
import { ModelSharingSettings } from "./model-sharing-settings";

import { MixSettingsSection } from "./mix-settings-section";
import { SettingsSection } from "./settings-section";
import { AddModelForm } from "./model-settings/add-model-form";
import { AdvancedDisclosure } from "./model-settings/advanced-disclosure";
import type {
  CompatDiagnostic,
  CompatDiagnosticState,
  CompatProfileCatalogState,
} from "./model-settings/compat-diagnostics";
import {
  customModelEntryId,
  customModelMatchesSelection,
  customModelPreferredSelection,
  customModelReferences,
  LOCAL_MODEL_SCAN_EVENT,
  type ModelConfig,
} from "./model-settings/custom-models";
import { DeleteModelDialog } from "./model-settings/delete-model-dialog";
import {
  BuiltInCompatProfilesCard,
  ConfiguredCompatDiagnosticsCard,
  GatewayDiagnosticsSection,
} from "./model-settings/diagnostics-sections";
import { EditModelForm } from "./model-settings/edit-model-form";
import { LocalModelsSection } from "./model-settings/local-models-section";
import { LocalVisionSection } from "./model-settings/local-vision-section";
import { ModelSettingsOverview } from "./model-settings/overview";
import { useCustomModelAgentCapabilities } from "./model-settings/use-custom-model-agent-capabilities";

export {
  customModelMatchesSelection,
  customModelPreferredSelection,
} from "./model-settings/custom-models";

// ── Main page ──────────────────────────────────────────────────
export default function ModelSettingsPage() {
  const { t, locale } = useI18n();
  const pageCopy = modelSettingsPageCopy(locale);
  const queryClient = useQueryClient();
  const { models: availableModels } = useModels();
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [compatDiagnostics, setCompatDiagnostics] =
    useState<CompatDiagnosticState>({
      status: "idle",
      byId: {},
    });
  const [compatProfileCatalog, setCompatProfileCatalog] =
    useState<CompatProfileCatalogState>({
      status: "idle",
      items: [],
    });
  const [loading, setLoading] = useState(true);
  const [modelsLoadError, setModelsLoadError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showLocalModels, setShowLocalModels] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const [openCodeOpen, setOpenCodeOpen] = useState(false);
  const [codexAccountSetupRequest, setCodexAccountSetupRequest] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [modelToDelete, setModelToDelete] = useState<string | null>(null);

  // Gateway connection state
  const [gatewayStatus, setGatewayStatus] = useState<
    "connected" | "disconnected" | "checking"
  >("checking");

  // List / CRUD all target the new hot-register dispatcher endpoints
  // (/api/config/custom-models/*). The legacy /api/models was the
  // OpenAI-compat gateway's *skills-as-models* listing and had no
  // writable CRUD on this backend — writing to it was silently no-op.
  const fetchCompatDiagnostics = useCallback(async () => {
    setCompatDiagnostics((prev) => ({
      status: "loading",
      byId: prev.byId,
    }));
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/custom-models/compat-diagnostics`,
        {
          headers: authHeaders(),
        },
      );
      if (!res.ok) {
        throw new Error(
          `Failed to fetch compatibility diagnostics: ${res.status}`,
        );
      }
      const data = await res.json();
      const diagnostics = Array.isArray(data?.diagnostics)
        ? (data.diagnostics as CompatDiagnostic[])
        : [];
      const byId: Record<string, CompatDiagnostic> = {};
      for (const row of diagnostics) {
        if (typeof row?.id === "string" && row.id.trim()) {
          byId[row.id] = row;
        }
      }
      setCompatDiagnostics({ status: "ready", byId });
    } catch (error) {
      swallow(error);
      setCompatDiagnostics((prev) => ({
        status: "error",
        byId: prev.byId,
        error:
          error instanceof Error
            ? error.message
            : t.settings.model.compatDiagnostics.loadFailed,
      }));
    }
  }, [t.settings.model.compatDiagnostics.loadFailed]);

  const fetchCompatProfileCatalog = useCallback(async () => {
    setCompatProfileCatalog((prev) => ({
      status: "loading",
      items: prev.items,
    }));
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/openai-compat-profiles`,
        {
          headers: authHeaders(),
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch profile catalog: ${res.status}`);
      }
      const data = await res.json();
      const items = Array.isArray(data?.diagnostics)
        ? (data.diagnostics as CompatDiagnostic[])
        : [];
      setCompatProfileCatalog({ status: "ready", items });
    } catch (error) {
      swallow(error);
      setCompatProfileCatalog((prev) => ({
        status: "error",
        items: prev.items,
        error:
          error instanceof Error
            ? error.message
            : t.settings.model.compatDiagnostics.loadFailed,
      }));
    }
  }, [t.settings.model.compatDiagnostics.loadFailed]);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/custom-models`,
        {
          headers: authHeaders(),
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch models: ${res.status}`);
      }
      const data = await res.json();
      const list = data.models || [];
      setModels(list);
      setModelsLoadError(false);
      setGatewayStatus("connected");
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    } catch (error) {
      console.error("[model-settings] load models failed:", error);
      setModelsLoadError(true);
      setGatewayStatus("disconnected");
      toast.error(t.settings.model.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [queryClient, t.settings.model.loadFailed]);

  const checkGateway = useCallback(async () => {
    setGatewayStatus("checking");
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/custom-models`,
        {
          headers: authHeaders(),
          signal: AbortSignal.timeout(5000),
        },
      );
      setGatewayStatus(res.ok ? "connected" : "disconnected");
    } catch (e) {
      swallow(e);
      setGatewayStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (!advancedOpen) return;
    void fetchCompatDiagnostics();
    void fetchCompatProfileCatalog();
  }, [advancedOpen, models, fetchCompatDiagnostics, fetchCompatProfileCatalog]);

  const handleSetDefault = async (name: string) => {
    try {
      // Implementation note.
      const settings = getLocalSettings();
      saveLocalSettings({
        ...settings,
        context: {
          ...settings.context,
          model_name: name,
        },
      });
      toast.success(t.settings.model.setDefaultSuccess);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t.settings.model.setDefaultFailed,
      );
    }
  };

  const handleRetryModels = () => {
    if (models.length === 0) setLoading(true);
    void fetchModels();
  };

  const [deletingModel, setDeletingModel] = useState(false);

  const reconcileDeletedModel = useCallback(
    (modelId: string) => {
      const deletedModel = models.find(
        (model) => customModelEntryId(model) === modelId,
      );
      const deletedReferences = deletedModel
        ? customModelReferences(deletedModel)
        : [modelId];
      deletedReferences.forEach((reference) =>
        clearThreadModelReferences(reference),
      );
      const settings = getLocalSettings();
      const deletedWasDefault = deletedModel
        ? customModelMatchesSelection(deletedModel, settings.context.model_name)
        : settings.context.model_name === modelId;
      if (!deletedWasDefault) {
        setModels((current) =>
          current.filter((model) => customModelEntryId(model) !== modelId),
        );
        return null;
      }

      const replacementModel = models.find(
        (model) => customModelEntryId(model) !== modelId,
      );
      const replacement = replacementModel
        ? customModelPreferredSelection(replacementModel)
        : "";
      saveLocalSettings({
        ...settings,
        context: {
          ...settings.context,
          model_name: replacement,
        },
      });
      setModels((current) =>
        current.filter((model) => customModelEntryId(model) !== modelId),
      );
      return replacement;
    },
    [models],
  );

  const doDeleteModel = async (modelId: string) => {
    setDeletingModel(true);
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/custom-models/${encodeURIComponent(modelId)}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Delete failed: ${res.status}`);
      }
      const replacement = reconcileDeletedModel(modelId);
      if (replacement === null) {
        toast.success(t.settings.model.deleteSuccess);
      } else if (replacement) {
        const replacementLabel =
          models.find((model) =>
            customModelMatchesSelection(model, replacement),
          )?.display_name || replacement;
        toast.success(pageCopy.deletedAndSwitched(replacementLabel));
      } else {
        toast.success(pageCopy.deletedAndReset);
      }
      await fetchModels();
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.settings.model.deleteFailed,
      );
      return false;
    } finally {
      setDeletingModel(false);
    }
  };

  const handleDelete = (modelId: string) => {
    setModelToDelete(modelId);
  };

  const handleReconnect = () => {
    void checkGateway();
  };

  const handleDiagnose = useCallback(async () => {
    const issues: string[] = [];
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/custom-models`,
        {
          headers: authHeaders(),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) issues.push(t.settings.model.gatewayReturned(res.status));
    } catch (e) {
      swallow(e);
      issues.push(t.settings.model.cannotReachGateway);
    }

    if (issues.length === 0) {
      toast.success(t.settings.model.diagnoseHealthy);
    } else {
      toast.error(
        t.settings.model.diagnoseIssues(issues.map((i) => `• ${i}`).join(" ")),
      );
    }
  }, [t.settings.model]);

  const scrollToSection = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const target = document.getElementById(id);
      const viewport = target?.closest<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      if (!target || !viewport) return;
      viewport.scrollTo({
        top:
          viewport.scrollTop +
          target.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          16,
        behavior: "smooth",
      });
    });
  }, []);

  const handleOverviewAddModel = useCallback(() => {
    setEditingModel(null);
    setShowLocalModels(false);
    setShowAdd(true);
    scrollToSection("model-settings-add");
  }, [scrollToSection]);

  const openOpenCodeSection = useCallback(() => {
    setOpenCodeOpen(true);
    scrollToSection("model-settings-opencode");
  }, [scrollToSection]);
  useModelSetupRequests(handleOverviewAddModel, openOpenCodeSection);

  const handleOverviewScanLocal = useCallback(() => {
    setShowAdd(false);
    setShowLocalModels(true);
    scrollToSection("model-settings-local");
    window.dispatchEvent(new Event(LOCAL_MODEL_SCAN_EVENT));
  }, [scrollToSection]);

  // Implementation note.
  const [localSettings] = useLocalSettings();
  const defaultModelName = localSettings.context.model_name;

  useCustomModelAgentCapabilities({
    gatewayStatus,
    defaultModelName,
    models,
    compatDiagnostics,
    compatProfileCatalog,
    setEditingModel,
    setShowAdd,
    checkGateway,
    fetchModels,
    reconcileDeletedModel,
  });

  const deleteModelConfig = modelToDelete
    ? models.find((model) => customModelEntryId(model) === modelToDelete)
    : undefined;
  const deletingCurrentDefault = deleteModelConfig
    ? customModelMatchesSelection(deleteModelConfig, defaultModelName)
    : modelToDelete !== null && modelToDelete === defaultModelName;
  const deleteReplacementModel = deletingCurrentDefault
    ? models.find((model) => customModelEntryId(model) !== modelToDelete)
    : undefined;
  const deleteReplacement =
    deleteReplacementModel?.display_name ??
    deleteReplacementModel?.name ??
    null;
  const configuredModelCount = models.reduce(
    (count, model) =>
      count + (Array.isArray(model.models) ? model.models.length : 0),
    0,
  );
  const visibleDefaultModel = useMemo(() => {
    const catalogModel =
      availableModels.find((model) =>
        [model.selection_id, model.name, model.id].includes(defaultModelName),
      ) ?? availableModels.find((model) => model.entry_id === defaultModelName);
    if (catalogModel)
      return (
        catalogModel.display_name || catalogModel.model || catalogModel.name
      );
    const matched = models.find((model) =>
      customModelMatchesSelection(model, defaultModelName),
    );
    if (matched) {
      const configured = Array.isArray(matched.models) ? matched.models : [];
      const selectedId = defaultModelName?.includes("::")
        ? defaultModelName.split("::").at(-1)
        : null;
      return (
        (selectedId && configured.includes(selectedId) ? selectedId : null) ||
        matched.display_name ||
        matched.name
      );
    }
    if (!defaultModelName) return "";
    if (defaultModelName.startsWith("echo-custom-model:v1:")) {
      return pageCopy.noDefault;
    }
    return defaultModelName;
  }, [defaultModelName, models, availableModels, pageCopy.noDefault]);

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <ModelSettingsOverview
        copy={pageCopy}
        modelPicker={
          <ModelPicker
            models={availableModels}
            value={defaultModelName || "auto"}
            showSettingsLink={false}
            onChange={(name) => void handleSetDefault(name)}
            renderTrigger={() => (
              <button
                type="button"
                aria-label={pageCopy.currentDefault}
                className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate">
                  {defaultModelName && defaultModelName !== "auto"
                    ? visibleDefaultModel
                    : t.modelPicker.autoModelLabel}
                </span>
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            )}
          />
        }
        customModelCount={models.length}
        modelCount={configuredModelCount}
        gatewayStatus={gatewayStatus}
        onAddModel={handleOverviewAddModel}
        onScanLocal={handleOverviewScanLocal}
        onOpenZen={openOpenCodeSection}
        onOpenCodex={() => {
          setCodexAccountSetupRequest((request) => request + 1);
          setCodexOpen(true);
          scrollToSection("model-settings-codex");
        }}
      />

      {/* ── Models Section ── */}
      <SettingsSection
        className="scroll-mt-6"
        title={
          <span id="model-settings-custom">{pageCopy.connectionsTitle}</span>
        }
        description={pageCopy.connectionsSubtitle}
      >
        {loading ? (
          <div role="status" className="text-muted-foreground text-sm">
            {t.common.loading}
          </div>
        ) : (
          <div className="flex w-full flex-col gap-3">
            {modelsLoadError ? (
              <div
                role="alert"
                className="flex flex-col items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-4 py-3 text-sm sm:flex-row sm:items-center"
              >
                <span className="flex items-center gap-2 text-destructive">
                  <AlertTriangleIcon className="size-4 shrink-0" />
                  {t.settings.model.loadFailed}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={handleRetryModels}
                >
                  <RefreshCwIcon className="mr-1.5 size-3.5" />
                  {pageCopy.retryLoad}
                </Button>
              </div>
            ) : null}
            {/* Model list */}
            {models.length > 0 || !modelsLoadError ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {models.map((m) => {
                  const modelId = customModelEntryId(m);
                  const editRegionId = `model-settings-edit-${encodeURIComponent(modelId)}`;
                  const list = Array.isArray(m.models) ? m.models : [];
                  const displayName = m.display_name || m.name;
                  const isDefault = customModelMatchesSelection(
                    m,
                    defaultModelName,
                  );
                  const modelSlots = (
                    <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-foreground/80">
                      {list.map((id, idx) => (
                        <li
                          key={`${modelId}:${idx}:${id}`}
                          className="flex min-w-0 items-center gap-2"
                        >
                          <span className="shrink-0 rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-sans text-xs font-medium text-muted-foreground">
                            {idx === 0 && idx === list.length - 1
                              ? t.settings.model.modelList
                                  .pickerDefaultAndPerformance
                              : idx === 0
                                ? t.settings.model.modelList.pickerDefault
                                : idx === list.length - 1
                                  ? t.settings.model.modelList.performanceTier
                                  : t.settings.model.modelList.fallback}
                          </span>
                          <code
                            className={cn(
                              "truncate rounded bg-muted/60 px-1.5 py-0.5",
                              (displayName.includes("免费") ||
                                /(?:^|[-_])free(?:$|[-_])/i.test(id)) &&
                                "text-success",
                            )}
                          >
                            {id}
                          </code>
                        </li>
                      ))}
                    </ul>
                  );
                  return (
                    <li
                      key={modelId}
                      className={cn(
                        "overflow-hidden",
                        isDefault && "bg-success/50/[0.035]",
                      )}
                    >
                      <div className="flex flex-col items-stretch justify-between gap-4 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-medium">
                              {displayName}
                            </div>
                            <span
                              className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground dark:border-muted-foreground/40 dark:bg-muted-foreground/10 dark:text-muted-foreground"
                              title={t.settings.model.modelList.hint}
                            >
                              {t.settings.model.modelCount(list.length)}
                            </span>
                          </div>
                          {m.name !== displayName && (
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {m.name}
                            </div>
                          )}
                          {list.length === 1 ? modelSlots : null}
                          {list.length > 1 ? (
                            <details className="group/models mt-1.5">
                              <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
                                查看 {list.length} 个模型
                              </summary>
                              {modelSlots}
                            </details>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-start gap-x-3 gap-y-2 sm:max-w-64 sm:justify-end">
                          {isDefault ? (
                            <span className="inline-flex items-center rounded-lg bg-success/10 px-3 py-1 text-xs font-medium text-success dark:bg-success/20 dark:text-success">
                              {t.settings.model.systemDefault}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="min-h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() =>
                                handleSetDefault(
                                  customModelPreferredSelection(m),
                                )
                              }
                              aria-label={`${t.settings.model.setAsDefault}: ${displayName}`}
                            >
                              {t.settings.model.setAsDefault}
                            </button>
                          )}
                          <button
                            type="button"
                            className="min-h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => {
                              setShowAdd(false);
                              setEditingModel((current) =>
                                current === modelId ? null : modelId,
                              );
                            }}
                            aria-label={`${t.common.edit}: ${displayName}`}
                            aria-expanded={editingModel === modelId}
                            aria-controls={editRegionId}
                          >
                            {t.common.edit}
                          </button>
                          <button
                            type="button"
                            className="min-h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => handleDelete(modelId)}
                            aria-label={`${t.common.delete}: ${displayName}`}
                          >
                            {t.common.delete}
                          </button>
                        </div>
                      </div>
                      {editingModel === modelId && (
                        <div
                          id={editRegionId}
                          className="border-t border-border bg-muted/15 px-4 py-4 sm:px-5"
                        >
                          <EditModelForm
                            key={modelId}
                            modelName={modelId}
                            onCancel={() => setEditingModel(null)}
                            onSaved={() => {
                              setEditingModel(null);
                              void fetchModels();
                            }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
                {models.length === 0 && (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                    {t.settings.model.emptyCustomModels}
                  </li>
                )}
              </ul>
            ) : null}

            {/* Add form */}
            {showAdd && (
              <div id="model-settings-add" className="mt-4 scroll-mt-6">
                <AddModelForm
                  onCancel={() => setShowAdd(false)}
                  onSaved={() => {
                    setShowAdd(false);
                    void fetchModels();
                  }}
                />
              </div>
            )}
          </div>
        )}
      </SettingsSection>

      {/* ── Local-model one-click import ──
          Sits between the custom-models list and the gateway config
          because it's the lowest-friction path *into* the
          custom-models list — a successful import re-runs
          ``fetchModels`` via ``onImported`` so the new row appears
          in the section above without a manual refresh. */}
      <div
        id="model-settings-local"
        className="scroll-mt-6"
        hidden={!showLocalModels}
      >
        <div className="mb-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLocalModels(false)}
          >
            {t.common.close}
          </Button>
        </div>
        <LocalModelsSection onImported={fetchModels} />
      </div>

      <ModelSharingSettings onConnected={fetchModels} />

      <AdvancedDisclosure
        id="model-settings-opencode"
        title="OpenCode"
        description="Zen / Go 连接与 API Key"
        open={openCodeOpen}
        onOpenChange={setOpenCodeOpen}
      >
        <OpenCodeConnections onConnected={fetchModels} />
      </AdvancedDisclosure>

      <AdvancedDisclosure
        id="model-settings-codex"
        title={pageCopy.codexTitle}
        description={pageCopy.codexSubtitle}
        open={codexOpen}
        onOpenChange={setCodexOpen}
      >
        <CoderEngineSettings
          authorizationOnly
          accountSetupRequest={codexAccountSetupRequest}
        />
      </AdvancedDisclosure>

      <details
        className="group rounded-lg border border-border bg-card/40 px-4 py-3"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary
          aria-label={pageCopy.advancedTitle}
          className="cursor-pointer list-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">
                {pageCopy.advancedTitle}
              </div>
              <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {pageCopy.advancedSubtitle}
              </div>
            </div>
            <ChevronRightIcon className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          </div>
        </summary>
        <div className="mt-5 space-y-3">
          <AdvancedDisclosure
            title={pageCopy.visionTitle}
            description={pageCopy.visionSubtitle}
          >
            <LocalVisionSection />
          </AdvancedDisclosure>
          <AdvancedDisclosure
            title={pageCopy.connectionToolsTitle}
            description={pageCopy.connectionToolsSubtitle}
          >
            <div className="space-y-8">
              <GatewayDiagnosticsSection
                gatewayStatus={gatewayStatus}
                copy={pageCopy}
                onReconnect={handleReconnect}
                onDiagnose={handleDiagnose}
              />
              <ConfiguredCompatDiagnosticsCard
                models={models}
                diagnostics={compatDiagnostics}
                copy={pageCopy}
              />
            </div>
          </AdvancedDisclosure>

          <AdvancedDisclosure
            title={pageCopy.localToolsTitle}
            description={pageCopy.localToolsSubtitle}
          >
            <ModelCookbook />
          </AdvancedDisclosure>

          <AdvancedDisclosure
            title={pageCopy.mixToolsTitle}
            description={pageCopy.mixToolsSubtitle}
          >
            <MixSettingsSection />
          </AdvancedDisclosure>

          <AdvancedDisclosure
            title={pageCopy.providerToolsTitle}
            description={pageCopy.providerToolsSubtitle}
          >
            <BuiltInCompatProfilesCard
              catalog={compatProfileCatalog}
              copy={pageCopy}
            />
          </AdvancedDisclosure>
        </div>
      </details>

      <DeleteModelDialog
        t={t}
        pageCopy={pageCopy}
        modelToDelete={modelToDelete}
        setModelToDelete={setModelToDelete}
        deletingModel={deletingModel}
        deleteModelConfig={deleteModelConfig}
        deletingCurrentDefault={deletingCurrentDefault}
        deleteReplacement={deleteReplacement}
        doDeleteModel={doDeleteModel}
      />
    </div>
  );
}
