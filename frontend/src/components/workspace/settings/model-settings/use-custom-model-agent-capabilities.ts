import { useEffect, type Dispatch, type SetStateAction } from "react";

import { authHeaders, jsonAuthHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { registerPageAgentCapability } from "@/core/page-agent-bridge";
import { getLocalSettings, saveLocalSettings } from "@/core/settings/local";

import {
  countCompatRetries,
  type CompatDiagnosticState,
  type CompatProfileCatalogState,
} from "./compat-diagnostics";
import {
  customModelEntryId,
  customModelMatchesIdentity,
  customModelMatchesSelection,
  customModelPreferredSelection,
  type ModelConfig,
} from "./custom-models";

/** Registers the custom-model capabilities the page agent can call while
 *  the model settings page is mounted. */
export function useCustomModelAgentCapabilities({
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
}: {
  gatewayStatus: "connected" | "disconnected" | "checking";
  defaultModelName: string | undefined;
  models: ModelConfig[];
  compatDiagnostics: CompatDiagnosticState;
  compatProfileCatalog: CompatProfileCatalogState;
  setEditingModel: Dispatch<SetStateAction<string | null>>;
  setShowAdd: Dispatch<SetStateAction<boolean>>;
  checkGateway: () => Promise<void>;
  fetchModels: () => Promise<void>;
  reconcileDeletedModel: (modelId: string) => string | null;
}) {
  useEffect(() => {
    const unregisters = [
      registerPageAgentCapability({
        id: "models.custom.list",
        label: "List custom models",
        description:
          "Return current custom model summaries and gateway status.",
        risk: "low",
        riskReasons: [],
        requiresConfirmation: false,
        run: () => ({
          gatewayStatus,
          defaultModelName,
          models: models.map((model) => ({
            id: customModelEntryId(model),
            name: model.name,
            display_name: model.display_name,
            provider: model.provider,
            base_url: model.base_url,
            models: model.models,
            supports_thinking: model.supports_thinking,
            supports_vision: model.supports_vision,
            isDefault: customModelMatchesSelection(model, defaultModelName),
            compat_diagnostic:
              compatDiagnostics.byId[customModelEntryId(model)] ?? null,
          })),
          builtInCompatProfiles: compatProfileCatalog.items.map((item) => ({
            id: item.id,
            profile: item.upstreams?.[0]?.profile,
            score: item.upstreams?.[0]?.compat_score,
            model: item.upstreams?.[0]?.model,
            fallbackCount: countCompatRetries(item),
          })),
        }),
      }),
      registerPageAgentCapability({
        id: "models.custom.openAdd",
        label: "Open add custom model form",
        description: "Open the custom model creation form.",
        risk: "low",
        riskReasons: [],
        requiresConfirmation: false,
        run: () => {
          setEditingModel(null);
          setShowAdd(true);
          return { opened: true };
        },
      }),
      registerPageAgentCapability({
        id: "models.custom.diagnoseGateway",
        label: "Diagnose custom model gateway",
        description: "Check whether the custom model backend API is reachable.",
        risk: "low",
        riskReasons: [],
        requiresConfirmation: false,
        run: async () => {
          await checkGateway();
          return { requested: true };
        },
      }),
      registerPageAgentCapability({
        id: "models.custom.testExisting",
        label: "Test existing custom model",
        description: "Run the backend diagnostic for an existing custom model.",
        risk: "low",
        riskReasons: [],
        requiresConfirmation: false,
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
        run: async (input) => {
          const name = String(input?.name || "").trim();
          if (!name) throw new Error("name is required");
          const model = models.find((candidate) =>
            customModelMatchesIdentity(candidate, name),
          );
          if (!model) {
            throw new Error(`custom model not found: ${name}`);
          }
          const started = performance.now();
          const res = await fetch(
            `${getBackendBaseURL()}/api/config/custom-models/test`,
            {
              method: "POST",
              headers: jsonAuthHeaders(),
              body: JSON.stringify({ id: customModelEntryId(model) }),
              // Test runs a text ping + a vision canary; give both probes
              // room even on slow reasoning models.
              signal: AbortSignal.timeout(20000),
            },
          );
          const data = await res.json().catch(() => ({}));
          return {
            ok: res.ok && data.ok !== false,
            status: res.status,
            latencyMs: Math.round(performance.now() - started),
            ...data,
          };
        },
      }),
      registerPageAgentCapability({
        id: "models.custom.setDefault",
        label: "Set default custom model",
        description: "Set the local default model by custom model name.",
        risk: "medium",
        riskReasons: ["save"],
        requiresConfirmation: false,
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
        run: async (input) => {
          const name = String(input?.name || "").trim();
          if (!name) throw new Error("name is required");
          const model = models.find((candidate) =>
            customModelMatchesIdentity(candidate, name),
          );
          if (!model) {
            throw new Error(`custom model not found: ${name}`);
          }
          const selection = customModelPreferredSelection(model);
          const settings = getLocalSettings();
          saveLocalSettings({
            ...settings,
            context: {
              ...settings.context,
              model_name: selection,
            },
          });
          await fetchModels();
          return { defaultModelName: selection };
        },
      }),
      registerPageAgentCapability({
        id: "models.custom.delete",
        label: "Delete custom model",
        description: "Delete a custom model configuration by name.",
        risk: "high",
        riskReasons: ["delete"],
        requiresConfirmation: true,
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
        run: async (input) => {
          const name = String(input?.name || "").trim();
          if (!name) throw new Error("name is required");
          const model = models.find((candidate) =>
            customModelMatchesIdentity(candidate, name),
          );
          if (!model) {
            throw new Error(`custom model not found: ${name}`);
          }
          const modelId = customModelEntryId(model);
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
          await fetchModels();
          return {
            deleted: modelId,
            defaultModelName:
              replacement === null ? defaultModelName : replacement,
          };
        },
      }),
    ];
    return () => {
      unregisters.forEach((unregister) => unregister());
    };
  }, [
    checkGateway,
    compatDiagnostics.byId,
    compatProfileCatalog.items,
    defaultModelName,
    fetchModels,
    gatewayStatus,
    models,
    reconcileDeletedModel,
    // State setters keep their identity; listed because they arrive as
    // arguments here.
    setEditingModel,
    setShowAdd,
  ]);
}
