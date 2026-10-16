import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { swallow } from "@/core/utils/log";
import { authHeaders, jsonAuthHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";

import { SettingsSection } from "../settings-section";
import { LOCAL_MODEL_SCAN_EVENT } from "./custom-models";

// ─── Local-model one-click import ─────────────────────────────
//
// Backs the "本地模型" SettingsSection. Sits next to the custom-
// models list so the operator's path from "I have Ollama running
// on my box" to "Echo is routing to it" is one click: scan →
// import. The scan probes a small set of well-known ports in
// parallel; the import writes directly into ``custom_models_state``
// (same on-disk shape as the manual add form), and re-runs the
// parent's ``fetchModels`` so the new row appears in the list
// above without a manual refresh.
//
// The header row carries a live status badge so the operator can
// see whether a scan has run and what it found without expanding
// the results list. Hard-cut borders (not fade / height
// animation) read as "real section boundary" rather than "fancy
// dropdown" — the section is short enough that animation would
// just be visual noise.
interface DiscoveredService {
  provider: string;
  base_url: string;
  probe_path: string;
  models: string[];
  status: "ok" | "empty" | "error";
  error?: string;
}

export function LocalModelsSection({
  onImported,
}: {
  onImported?: () => void;
}) {
  const { t } = useI18n();
  const [services, setServices] = useState<DiscoveredService[]>([]);
  const [scanStatus, setScanStatus] = useState<
    "idle" | "scanning" | "done" | "error"
  >("idle");
  // Per-row import-in-flight flag, keyed by base_url so a slow
  // import on one service doesn't lock out importing the others.
  const [importing, setImporting] = useState<Record<string, boolean>>({});

  const handleScan = useCallback(async () => {
    setScanStatus("scanning");
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/local-models/scan`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServices(Array.isArray(data.services) ? data.services : []);
      setScanStatus("done");
    } catch (e) {
      swallow(e);
      setScanStatus("error");
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      void handleScan();
    };
    window.addEventListener(LOCAL_MODEL_SCAN_EVENT, handler);
    return () => window.removeEventListener(LOCAL_MODEL_SCAN_EVENT, handler);
  }, [handleScan]);

  const handleImport = useCallback(
    async (svc: DiscoveredService) => {
      if (svc.status !== "ok" || svc.models.length === 0) return;
      setImporting((prev) => ({ ...prev, [svc.base_url]: true }));
      try {
        const res = await fetch(
          `${getBackendBaseURL()}/api/config/local-models/import`,
          {
            method: "POST",
            headers: jsonAuthHeaders(),
            body: JSON.stringify({
              base_url: svc.base_url,
              models: svc.models,
              // Display name falls back to the first model id; the
              // operator can rename in the edit form afterwards.
              display_name: svc.models[0] ?? svc.base_url,
            }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          toast.error(
            `${t.settings.model.localModels.importFailed}: ${
              data.error || `HTTP ${res.status}`
            }`,
          );
          return;
        }
        toast.success(t.settings.model.localModels.imported);
        onImported?.();
      } catch (e) {
        swallow(e);
        toast.error(t.settings.model.localModels.importFailed);
      } finally {
        setImporting((prev) => {
          const next = { ...prev };
          delete next[svc.base_url];
          return next;
        });
      }
    },
    [
      onImported,
      t.settings.model.localModels.importFailed,
      t.settings.model.localModels.imported,
    ],
  );

  return (
    <SettingsSection
      title={t.settings.model.localModels.title}
      description={t.settings.model.localModels.subtitle}
    >
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Header bar · scan button + live status badge. Lives
            outside the collapsible so the operator can see whether
            a scan has run at a glance, even when the results list
            is collapsed. */}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t.settings.model.localModels.providerHint}
            </span>
            {scanStatus === "scanning" && (
              <Loader2Icon className="size-3.5 animate-spin text-info" />
            )}
            {scanStatus === "done" && services.length > 0 && (
              <span className="inline-flex items-center rounded-md border border-success/30 bg-success/5 px-1.5 py-0.5 text-xs font-medium text-success dark:border-success/40 dark:bg-success/10 dark:text-success">
                {t.settings.model.localModels.modelsCount(services.length)}
              </span>
            )}
            {scanStatus === "done" && services.length === 0 && (
              <span className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground dark:border-muted-foreground/40 dark:bg-muted-foreground/10 dark:text-muted-foreground">
                {t.settings.model.localModels.empty}
              </span>
            )}
            {scanStatus === "error" && (
              <span className="inline-flex items-center rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                {t.settings.model.localModels.serviceStatus.error}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={scanStatus === "scanning"}
          >
            {scanStatus === "scanning" ? (
              <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="mr-1.5 size-3.5" />
            )}
            {scanStatus === "scanning"
              ? t.settings.model.localModels.scanButtonScanning
              : t.settings.model.localModels.scanButton}
          </Button>
        </div>

        {/* Results list · only renders after a scan has been run.
            Empty state is inline rather than a separate screen so
            the operator's eye doesn't have to leave the section. */}
        {scanStatus !== "idle" && (
          <div className="border-t border-border divide-y divide-border">
            {services.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                {t.settings.model.localModels.emptyHint}
              </div>
            ) : (
              services.map((svc) => {
                const busy = !!importing[svc.base_url];
                const canImport =
                  svc.status === "ok" && svc.models.length > 0 && !busy;
                return (
                  <div
                    key={svc.base_url}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="truncate font-mono text-sm">
                          {svc.base_url}
                        </code>
                        {svc.status === "ok" && (
                          <span className="inline-flex shrink-0 items-center rounded-md border border-success/30 bg-success/5 px-1.5 py-0.5 text-xs font-medium text-success dark:border-success/40 dark:bg-success/10 dark:text-success">
                            {t.settings.model.localModels.serviceStatus.ok}
                          </span>
                        )}
                        {svc.status === "empty" && (
                          <span className="inline-flex shrink-0 items-center rounded-md border border-warning/30 bg-warning/5 px-1.5 py-0.5 text-xs font-medium text-warning dark:border-warning/40 dark:bg-warning/10 dark:text-warning">
                            {t.settings.model.localModels.serviceStatus.empty}
                          </span>
                        )}
                        {svc.status === "error" && (
                          <span className="inline-flex shrink-0 items-center rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                            {t.settings.model.localModels.serviceStatus.error}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {svc.status === "ok" &&
                          t.settings.model.localModels.modelsCount(
                            svc.models.length,
                          )}
                        {svc.status === "empty" &&
                          t.settings.model.localModels.serviceStatus.empty}
                        {svc.error &&
                          `${t.settings.model.localModels.serviceStatus.error}: ${svc.error}`}
                      </div>
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleImport(svc)}
                      disabled={!canImport}
                    >
                      {busy
                        ? t.settings.model.localModels.importingButton
                        : t.settings.model.localModels.importButton}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
