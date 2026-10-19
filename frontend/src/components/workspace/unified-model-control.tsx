import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { apiGet } from "@/core/api/request";
import { parseCodeBuddyModels } from "@/core/agents/codebuddy-status";
import {
  coderQueryKeys,
  getCoderAccount,
  getCoderModels,
  getCoderModelProfile,
  updateCoderModelProfile,
} from "@/core/coder/api";
import { useI18n } from "@/core/i18n/hooks";
import { modelSourceCopy } from "@/core/i18n/locales/model-sources";
import {
  isReasoningEffort,
  parseReasoningEffort,
} from "@/core/threads/reasoning-effort";
import type { ReasoningEffort } from "@/core/threads";
import { rememberDefaultModelRoute } from "@/core/realtime/default-model-route";
import { useAuth } from "@/providers/AuthProvider";
import {
  CodeBuddyIcon,
  CodexIcon,
  OpenCodeIcon,
} from "./execution-engine-picker";
import { ModelPicker, type PickerModel } from "./model-picker";
import { modelMatchesValue } from "./model-picker-selection";
import {
  routedModel,
  routeNativeModels,
  type ModelEngine,
} from "./unified-model-catalog";

export function UnifiedModelControl({
  models,
  engine,
  value,
  disabled,
  onEngineChange,
  onChange,
  reasoningEffort,
  onReasoningEffortChange,
  lazy = false,
  renderTrigger,
  showManageLink = true,
}: {
  models: PickerModel[];
  engine: ModelEngine;
  value?: string;
  disabled?: boolean;
  onEngineChange: (engine: ModelEngine) => void;
  onChange?: (model: string) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  lazy?: boolean;
  renderTrigger?: (label: string, disabled: boolean) => ReactNode;
  showManageLink?: boolean;
}) {
  const { locale, t } = useI18n();
  const copy = modelSourceCopy(locale);
  const { user, isLoading: authLoading } = useAuth();
  const keys = coderQueryKeys(user?.actor_id || user?.user_id || "local");
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<ModelEngine>(engine);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const account = useQuery({
    queryKey: keys.account,
    queryFn: ({ signal }) => getCoderAccount(signal),
    enabled: !authLoading && (!lazy || open || engine === "codex"),
    staleTime: 30_000,
  });
  const profile = useQuery({
    queryKey: keys.profile,
    queryFn: ({ signal }) => getCoderModelProfile(signal),
    enabled: !authLoading && (!lazy || open || engine === "codex"),
    staleTime: 30_000,
  });
  const codex = useQuery({
    queryKey: keys.models,
    queryFn: ({ signal }) => getCoderModels(signal),
    enabled: Boolean(account.data?.account) && (!lazy || open),
    staleTime: 60_000,
  });
  const codebuddy = useQuery({
    enabled: !lazy || open,
    queryKey: ["codebuddy-models"],
    queryFn: async ({ signal }) =>
      parseCodeBuddyModels(
        await apiGet("/api/config/codebuddy/models", { signal }),
      ),
    staleTime: 60_000,
  });
  const catalog = [
    ...routeNativeModels(models),
    ...(codebuddy.data?.models ?? []).map((id) =>
      routedModel(
        "codebuddy",
        `codebuddy/${id}`,
        { name: id, display_name: id, supports_reasoning_effort: false },
        copy.official,
      ),
    ),
    ...(account.data?.account ? (codex.data?.models ?? []) : []).map((model) =>
      routedModel(
        "codex",
        model.id,
        {
          name: model.id,
          display_name: model.display_name || model.id,
          reasoning_efforts: model.reasoning_efforts.filter(isReasoningEffort),
        },
        account.data?.account?.type === "apiKey" ? copy.api : copy.subscription,
      ),
    ),
  ];
  if (models.length)
    catalog.unshift(
      routedModel(
        "echo",
        "auto",
        {
          name: "echo-auto",
          display_name: t.modelPicker.autoModelLabel,
          supports_reasoning_effort: false,
        },
        "Echo",
      ),
    );
  if (codebuddy.data?.models.length)
    catalog.push(
      routedModel(
        "codebuddy",
        "auto",
        {
          name: "codebuddy-auto",
          display_name: copy.default,
          supports_reasoning_effort: false,
        },
        copy.official,
      ),
    );
  const wireValue =
    engine === "codex"
      ? profile.data?.selected_model || profile.data?.effective_model || value
      : value;
  const selected =
    catalog.find(
      (model) =>
        model.executionEngine === engine &&
        model.wireModel === (wireValue || "auto"),
    ) ??
    catalog.find(
      (model) =>
        model.executionEngine === engine && modelMatchesValue(model, wireValue),
    );
  const selectedValue =
    selected?.selection_id || JSON.stringify([engine, wireValue || "auto"]);
  const save = useMutation({
    scope: {
      id: `coder-model-profile:${user?.actor_id || user?.user_id || "local"}`,
    },
    mutationFn: async (selection: string) => {
      const model = catalog.find((row) => row.selection_id === selection);
      if (!model) throw new Error(copy.failed);
      // Confirm the server-owned Codex profile before publishing the engine
      // switch. A failed save must leave both current engine and model intact.
      if (model.executionEngine === "codex") {
        const next = await updateCoderModelProfile({
          source: "codex_account",
          model: model.wireModel,
        });
        if (
          next.source !== "codex_account" ||
          (next.selected_model || next.effective_model) !== model.wireModel
        ) {
          throw new Error(copy.failed);
        }
        client.setQueryData(keys.profile, next);
      }
      if (!mounted.current) return;
      rememberDefaultModelRoute(
        user?.actor_id || user?.user_id || "local",
        model.wireModel,
        model.executionEngine,
      );
      onEngineChange(model.executionEngine);
      onChange?.(model.wireModel);
      setOpen(false);
    },
  });
  const effort = useMutation({
    scope: {
      id: `coder-model-profile:${user?.actor_id || user?.user_id || "local"}`,
    },
    mutationFn: async (nextEffort: ReasoningEffort) => {
      if (engine !== "codex" || !selected) return;
      const next = await updateCoderModelProfile({
        source: "codex_account",
        model: selected.wireModel,
        reasoning_effort: nextEffort,
      });
      client.setQueryData(keys.profile, next);
    },
  });
  const Icon =
    engine === "codebuddy"
      ? CodeBuddyIcon
      : engine === "codex"
        ? CodexIcon
        : engine === "opencode"
          ? OpenCodeIcon
          : SparklesIcon;
  const label =
    selected?.display_name ||
    (wireValue && wireValue !== "auto"
      ? wireValue.replace(/^codebuddy\//, "")
      : copy.default);
  const pending = disabled || save.isPending || effort.isPending;
  return (
    <ModelPicker
      models={catalog.filter((model) => model.executionEngine === sourceFilter)}
      value={selectedValue}
      onChange={(selection) => save.mutate(selection)}
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setSourceFilter(engine);
        setOpen(nextOpen);
      }}
      showSources
      showAutoOption={false}
      showSettingsLink={false}
      emptyMessage={
        sourceFilter === "codebuddy"
          ? codebuddy.isFetching
            ? copy.loading
            : copy.codebuddyEmpty
          : copy.noModels
      }
      disabled={pending}
      header={
        <div
          aria-label={copy.modelSourceLabel}
          className="mb-1 flex items-center justify-between gap-2 border-b border-border-subtle px-1"
        >
          {(["codebuddy", "codex", "opencode", "echo"] as const).map(
            (source) => (
              <button
                key={source}
                type="button"
                aria-pressed={sourceFilter === source}
                onClick={() => setSourceFilter(source)}
                className={`-mb-px h-8 shrink-0 whitespace-nowrap border-b-2 px-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${sourceFilter === source ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {source === "echo"
                  ? "Echo"
                  : source === "codebuddy"
                    ? "CodeBuddy"
                    : source === "codex"
                      ? "Codex"
                      : "OpenCode"}
              </button>
            ),
          )}
        </div>
      }
      reasoningEffort={
        engine === "codex"
          ? parseReasoningEffort(profile.data?.reasoning_effort)
          : reasoningEffort
      }
      reasoningEffortDisabled={pending}
      onReasoningEffortChange={
        engine === "echo"
          ? onReasoningEffortChange
          : engine === "codex"
            ? (next) => effort.mutate(next)
            : undefined
      }
      renderTrigger={() =>
        renderTrigger ? (
          renderTrigger(label, Boolean(pending))
        ) : (
          <button
            type="button"
            data-testid="unified-model-trigger"
            aria-label={`${engine} · ${label}`}
            title={selected?.source_display_name || engine}
            disabled={pending}
            className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-ui text-muted-foreground hover:bg-muted/60"
          >
            <Icon className="size-4 shrink-0" />
            <span className="max-w-40 truncate">{label}</span>
            <ChevronDownIcon className="size-3 opacity-60" />
          </button>
        )
      }
      footer={
        <div className="mt-1 border-t border-border-subtle pt-1">
          {(save.isError || effort.isError) && (
            <p role="alert" className="px-2 py-1 text-xs text-destructive">
              {copy.failed}
            </p>
          )}
          {codebuddy.isFetching && !codebuddy.data && (
            <p
              role="status"
              className="px-2 py-1 text-xs text-muted-foreground"
            >
              {copy.loading}
            </p>
          )}
          {(codebuddy.isError || codex.isError) && (
            <p
              role="status"
              className="px-2 py-1 text-xs text-muted-foreground"
            >
              {copy.unavailable}
            </p>
          )}
          {showManageLink && (
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-ui text-muted-foreground hover:bg-accent"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(
                  new CustomEvent("echo:open-settings", {
                    detail: { tab: "models" },
                  }),
                );
              }}
            >
              {copy.manage}
            </button>
          )}
        </div>
      }
    />
  );
}
